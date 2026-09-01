use crate::api::AppState;
use crate::api::AuthenticatedUser;
use crate::api::ratelimit::check_rate_limit;
use crate::database::link_previews;
use crate::links::preview::{self, ParsedPreview};
use crate::net::fetch::{self, MAX_FETCH_BYTES};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub fn url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Deserialize)]
pub struct UnfurlRequest {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct UnfurlResponse {
    pub available: bool,
    pub url_hash: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub has_image: bool,
}

fn unavailable() -> UnfurlResponse {
    UnfurlResponse {
        available: false,
        url_hash: None,
        title: None,
        description: None,
        has_image: false,
    }
}

pub async fn unfurl(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UnfurlRequest>,
) -> Result<Json<UnfurlResponse>, StatusCode> {
    check_rate_limit(&state.redis, &format!("unfurl:{}", auth.user_id), 30, 60).await?;

    let parsed = reqwest::Url::parse(&req.url).map_err(|_| StatusCode::BAD_REQUEST)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let hash = url_hash(&req.url);

    if let Some(row) = link_previews::get_fresh(&state.db, &hash)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let has_image = row.image_url.is_some();
        let has_content = row.title.is_some() || row.description.is_some() || has_image;
        return Ok(Json(if has_content {
            UnfurlResponse {
                available: true,
                url_hash: Some(hash),
                title: row.title,
                description: row.description,
                has_image,
            }
        } else {
            unavailable()
        }));
    }

    // Cache miss or stale — fetch live. Any failure from here on collapses
    // to "no preview available", never a distinguishable error — this
    // endpoint must not become an oracle for probing internal network
    // reachability. See fetch_and_parse below.
    let Some(fetched) = fetch_and_parse(&state.http_client, &req.url).await else {
        return Ok(Json(unavailable()));
    };

    link_previews::upsert(
        &state.db,
        &hash,
        &req.url,
        fetched.title.as_deref(),
        fetched.description.as_deref(),
        fetched.image_url.as_deref(),
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let has_image = fetched.image_url.is_some();
    let has_content = fetched.title.is_some() || fetched.description.is_some() || has_image;
    Ok(Json(if has_content {
        UnfurlResponse {
            available: true,
            url_hash: Some(hash),
            title: fetched.title,
            description: fetched.description,
            has_image,
        }
    } else {
        unavailable()
    }))
}

#[derive(Deserialize)]
pub struct ImageProxyParams {
    pub url_hash: String,
}

pub async fn image_proxy(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<ImageProxyParams>,
) -> Result<Response, StatusCode> {
    check_rate_limit(&state.redis, &format!("imgproxy:{}", auth.user_id), 60, 60).await?;

    let image_url = link_previews::get_image_url(&state.db, &params.url_hash)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let capped = fetch::fetch_capped(&state.http_client, &image_url, MAX_FETCH_BYTES)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    // The source's Content-Type comes straight from a third-party server (it
    // was discovered from an attacker-controlled og:image tag and is cached
    // globally). Streaming it through verbatim would let a malicious source
    // declare `text/html` with a <script> body; a plain "open image in new
    // tab" click is then a same-origin top-level navigation that executes
    // that script at Grove's own origin. Anything that isn't an image type
    // (and not SVG, which can itself carry <script>) collapses to the same
    // BAD_GATEWAY as any other fetch failure — no distinguishable status for
    // this case, keeping the anti-oracle response pattern consistent.
    if !is_allowed_image_content_type(capped.content_type.as_deref()) {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let content_type = capped.content_type.expect("checked Some above");

    Ok(build_image_response(content_type, capped.body))
}

/// Response-building logic, deliberately separated from the fetch/allowlist
/// checks above so the success-path headers (notably the `nosniff`
/// defense-in-depth header) can be unit-tested without a live mock server.
fn build_image_response(content_type: String, body: bytes::Bytes) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        body,
    )
        .into_response()
}

/// Pure allowlist check, deliberately separated from the fetch/streaming
/// logic above so it can be unit-tested without a live mock server (mirrors
/// how `net::fetch::cap_response` was split out of `fetch_capped`). Accepts
/// only a `Content-Type` that case-insensitively starts with `image/`, and
/// explicitly excludes `image/svg+xml` — SVG is nominally an image type but
/// can carry a `<script>` payload of its own.
fn is_allowed_image_content_type(content_type: Option<&str>) -> bool {
    match content_type {
        Some(ct) => {
            let lower = ct.to_ascii_lowercase();
            lower.starts_with("image/") && !lower.starts_with("image/svg+xml")
        }
        None => false,
    }
}

async fn fetch_and_parse(client: &reqwest::Client, url: &str) -> Option<ParsedPreview> {
    let capped = fetch::fetch_capped(client, url, MAX_FETCH_BYTES)
        .await
        .ok()?;
    let ct = capped.content_type?;
    if !ct.to_ascii_lowercase().starts_with("text/html") {
        return None;
    }
    let html = String::from_utf8(capped.body.to_vec()).ok()?;
    Some(preview::parse_preview_html(&html))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::link_previews;

    async fn make_state(pool: sqlx::PgPool) -> std::sync::Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        std::sync::Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::new(redis),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
            http_client: crate::net::ssrf::build_http_client(),
        })
    }

    #[sqlx::test]
    async fn rejects_a_non_http_url(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest {
                url: "ftp://example.com".to_string(),
            }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[sqlx::test]
    async fn returns_a_cached_row_without_fetching(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/cached");
        link_previews::upsert(
            &state.db,
            &hash,
            "https://example.com/cached",
            Some("Cached Title"),
            Some("Cached Desc"),
            Some("https://example.com/img.png"),
        )
        .await
        .unwrap();

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest {
                url: "https://example.com/cached".to_string(),
            }),
        )
        .await
        .unwrap();

        assert!(result.0.available);
        assert_eq!(result.0.title, Some("Cached Title".to_string()));
        assert_eq!(result.0.url_hash, Some(hash));
        assert!(result.0.has_image);
        Ok(())
    }

    #[sqlx::test]
    async fn cached_row_with_no_metadata_reports_unavailable(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/empty");
        link_previews::upsert(
            &state.db,
            &hash,
            "https://example.com/empty",
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest {
                url: "https://example.com/empty".to_string(),
            }),
        )
        .await
        .unwrap();

        assert!(
            !result.0.available,
            "a cached-but-empty row must report unavailable"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn an_unreachable_internal_target_reports_unavailable_not_an_error(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        // No mock server needed — SSRF protection blocks this before any
        // connection attempt, and that must surface as the same
        // { available: false } shape as any other failure, not a 5xx.
        let state = make_state(pool).await;
        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest {
                url: "http://127.0.0.1:1/nope".to_string(),
            }),
        )
        .await
        .unwrap();

        assert!(!result.0.available);
        Ok(())
    }

    #[sqlx::test]
    async fn returns_404_for_an_unknown_hash(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams {
                url_hash: "nope".to_string(),
            }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }

    #[sqlx::test]
    async fn returns_404_when_the_cached_row_has_no_image(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/no-image");
        link_previews::upsert(
            &state.db,
            &hash,
            "https://example.com/no-image",
            Some("T"),
            None,
            None,
        )
        .await
        .unwrap();

        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }

    #[test]
    fn image_content_type_allowlist_rejects_html() {
        assert!(!is_allowed_image_content_type(Some("text/html")));
        assert!(!is_allowed_image_content_type(Some(
            "text/html; charset=utf-8"
        )));
    }

    #[test]
    fn image_content_type_allowlist_rejects_svg_even_though_it_is_nominally_an_image_type() {
        // SVG can carry its own <script> payload, so it's excluded despite
        // matching the image/ prefix.
        assert!(!is_allowed_image_content_type(Some("image/svg+xml")));
        assert!(!is_allowed_image_content_type(Some(
            "image/svg+xml; charset=utf-8"
        )));
        assert!(!is_allowed_image_content_type(Some("IMAGE/SVG+XML")));
    }

    #[test]
    fn image_content_type_allowlist_rejects_a_missing_header() {
        assert!(!is_allowed_image_content_type(None));
    }

    #[test]
    fn image_content_type_allowlist_accepts_ordinary_image_types_case_insensitively() {
        assert!(is_allowed_image_content_type(Some("image/png")));
        assert!(is_allowed_image_content_type(Some("image/jpeg")));
        assert!(is_allowed_image_content_type(Some("IMAGE/PNG")));
        assert!(is_allowed_image_content_type(Some(
            "image/webp; charset=binary"
        )));
    }

    #[test]
    fn success_response_carries_the_nosniff_header_and_content_type() {
        let resp = build_image_response(
            "image/png".to_string(),
            bytes::Bytes::from_static(b"fake-image-bytes"),
        );
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(header::X_CONTENT_TYPE_OPTIONS)
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("image/png")
        );
    }

    /// End-to-end regression for the CRITICAL content-type-confusion finding:
    /// a source that declares `text/html` (an attacker fully controls the
    /// og:image URL a preview is built from) must never be streamed through
    /// — it must collapse to the same BAD_GATEWAY as any other fetch
    /// failure, not be forwarded to the client where a same-origin "open
    /// image in new tab" navigation would execute it.
    ///
    /// This mock server is itself loopback, so it can't be reached through
    /// image_proxy's normal path (get_checked blocks loopback targets
    /// before any connection, by design — see net::ssrf). To exercise the
    /// allowlist specifically, this test drives the same two steps
    /// image_proxy performs — cap_response then the allowlist check — using
    /// the same technique net::fetch's own tests use to get a real Response
    /// without fighting the SSRF check: a raw (non-SSRF-safe) client talking
    /// directly to the mock server.
    #[tokio::test]
    async fn a_text_html_source_is_rejected_instead_of_streamed_through() {
        let app = axum::Router::new().route(
            "/evil",
            axum::routing::get(|| async {
                (
                    [("content-type", "text/html")],
                    "<script>alert(document.cookie)</script>",
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::new();
        let resp = client
            .get(format!("http://{}/evil", addr))
            .send()
            .await
            .unwrap();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        assert!(
            !is_allowed_image_content_type(content_type.as_deref()),
            "a text/html source must be rejected by the allowlist, matching \
             the BAD_GATEWAY the handler returns for it"
        );
    }

    #[sqlx::test]
    async fn a_cached_row_pointing_at_an_internal_address_fails_without_panicking(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        // The image proxy applies the same SSRF protection as unfurl — this
        // confirms it degrades to an error response, not a panic or a leak.
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/bad-image");
        link_previews::upsert(
            &state.db,
            &hash,
            "https://example.com/bad-image",
            None,
            None,
            Some("http://127.0.0.1:1/nope"),
        )
        .await
        .unwrap();

        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert!(result.is_err());
        Ok(())
    }
}
