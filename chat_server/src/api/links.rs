use crate::api::AppState;
use crate::api::AuthenticatedUser;
use crate::api::ImageProxyAuth;
use crate::api::ratelimit::check_rate_limit;
use crate::database::link_previews;
use crate::links::preview::{self, ParsedPreview};
use crate::net::fetch::{self, MAX_FETCH_BYTES};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::{Json, extract::State, http::StatusCode};
use bytes::Bytes;
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
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

/// Short-TTL cache window for proxied image bytes, keyed by `url_hash`. A
/// held-open, never-read connection could otherwise force one full origin
/// fetch per request with no dedup at all — measured at ~5,400x bandwidth
/// amplification — and a message viewed by N channel members cost N
/// independent fetches of the same image. This collapses concurrent and
/// repeated requests for the same image into ~one origin fetch per window.
/// Short enough that a source image changing takes at most a minute to show
/// up — self-evidently fine for a link-preview thumbnail.
const IMAGE_CACHE_TTL_SECS: u64 = 60;

fn image_cache_key(url_hash: &str) -> String {
    format!("imgcache:{url_hash}")
}

/// Looks up a cached `(content_type, body)` pair for `url_hash`. Doesn't
/// distinguish "never cached" from "expired" — Redis's own TTL eviction
/// makes both look like a plain miss to the caller, same as any other cache.
async fn cache_get_image(redis: &ConnectionManager, url_hash: &str) -> Option<(String, Bytes)> {
    let mut con = redis.clone();
    let key = image_cache_key(url_hash);
    let (content_type, body): (Option<String>, Option<Vec<u8>>) =
        con.hmget(&key, &["content_type", "body"]).await.ok()?;
    match (content_type, body) {
        (Some(ct), Some(b)) => Some((ct, Bytes::from(b))),
        _ => None,
    }
}

/// Writes `content_type` + `body` and sets the TTL atomically via a Lua
/// script — the same INCR+EXPIRE-via-Lua shape `ratelimit::check_rate_limit`
/// already uses, so a crash between the write and the expiry call can never
/// leave an immortal key behind. Best-effort: a cache write failure must
/// never fail the image response already computed for the client.
async fn cache_put_image(
    redis: &ConnectionManager,
    url_hash: &str,
    content_type: &str,
    body: &[u8],
) {
    let mut con = redis.clone();
    let key = image_cache_key(url_hash);
    let result: Result<(), redis::RedisError> = redis::Script::new(
        "redis.call('HSET', KEYS[1], 'content_type', ARGV[1], 'body', ARGV[2])
         redis.call('EXPIRE', KEYS[1], ARGV[3])
         return 1",
    )
    .key(&key)
    .arg(content_type)
    .arg(body)
    .arg(IMAGE_CACHE_TTL_SECS)
    .invoke_async(&mut con)
    .await;

    if let Err(err) = result {
        eprintln!("warn: failed to populate image proxy cache for {url_hash}: {err}");
    }
}

pub async fn image_proxy(
    auth: ImageProxyAuth,
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<ImageProxyParams>,
) -> Result<Response, StatusCode> {
    check_rate_limit(&state.redis, &format!("imgproxy:{}", auth.user_id), 60, 60).await?;

    if let Some((content_type, body)) = cache_get_image(&state.redis, &params.url_hash).await {
        return Ok(build_image_response(content_type, body));
    }

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
    // this case, keeping the anti-oracle response pattern consistent. A
    // rejected response is never cached — only content that actually passed
    // the allowlist is worth serving again on the next request.
    if !is_allowed_image_content_type(capped.content_type.as_deref()) {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let content_type = capped.content_type.expect("checked Some above");

    cache_put_image(&state.redis, &params.url_hash, &content_type, &capped.body).await;

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
            ImageProxyAuth { user_id: 1 },
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
            ImageProxyAuth { user_id: 1 },
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
            ImageProxyAuth { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert!(result.is_err());
        Ok(())
    }

    // --- Fix 1: Redis-backed image proxy cache ---

    #[sqlx::test]
    async fn image_proxy_serves_from_cache_without_fetching_on_a_cache_hit(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/cache-hit-image");

        // Points at an address nothing listens on, so get_checked's own
        // SSRF-block test elsewhere proves this would fail as BAD_GATEWAY if
        // the handler ever actually tried to fetch it. Serving 200 with the
        // pre-seeded cached bytes below is only possible if the cache-hit
        // path returned before reaching fetch_capped at all — that's what
        // makes "no fetch happened" observable without a live mock server,
        // mirroring how the existing SSRF tests in this file work.
        link_previews::upsert(
            &state.db,
            &hash,
            "https://example.com/cache-hit-image",
            None,
            None,
            Some("http://127.0.0.1:1/nope"),
        )
        .await
        .unwrap();
        cache_put_image(&state.redis, &hash, "image/png", b"cached-bytes").await;

        let result = image_proxy(
            ImageProxyAuth { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await
        .unwrap();

        assert_eq!(result.status(), StatusCode::OK);
        let body = axum::body::to_bytes(result.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), b"cached-bytes");
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_populates_the_cache_on_a_miss(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let png_bytes: &[u8] = b"fresh-bytes-from-origin";
        let app = axum::Router::new().route(
            "/fresh.png",
            axum::routing::get(move || async move { ([("content-type", "image/png")], png_bytes) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let state = make_state(pool).await;
        // Unique per run — the image cache lives in a real, shared Redis
        // instance (unlike #[sqlx::test]'s per-test isolated database), so a
        // fixed URL here would collide with a previous run's still-live
        // 60s-TTL cache entry and defeat the "must start as a miss" check.
        let source_url = format!(
            "https://example.com/fresh-image-{}",
            crate::api::invite_code::generate_invite_code()
        );
        let hash = url_hash(&source_url);
        let target = format!(
            "http://{}:{}/fresh.png",
            crate::net::ssrf::TEST_LOOPBACK_HOST,
            addr.port()
        );
        link_previews::upsert(&state.db, &hash, &source_url, None, None, Some(&target))
            .await
            .unwrap();

        assert!(
            cache_get_image(&state.redis, &hash).await.is_none(),
            "must start as a genuine cache miss"
        );

        let result = image_proxy(
            ImageProxyAuth { user_id: 1 },
            State(state.clone()),
            axum::extract::Query(ImageProxyParams {
                url_hash: hash.clone(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.status(), StatusCode::OK);

        let (cached_content_type, cached_body) = cache_get_image(&state.redis, &hash)
            .await
            .expect("a cache miss must populate the cache before returning");
        assert_eq!(cached_content_type, "image/png");
        assert_eq!(cached_body.as_ref(), png_bytes);
        Ok(())
    }

    // --- Fix 3: real handler-wiring tests against a real mock HTTP server ---
    //
    // These drive requests through the reserved #[cfg(test)]-only loopback
    // hostname (net::ssrf::TEST_LOOPBACK_HOST) so the *real* get_checked /
    // fetch_capped path is exercised, not a raw client bypassing SSRF
    // checks — closing the gap where the content-type allowlist and the
    // unfurl text/html gate were only ever mutation-tested against pure
    // predicate functions, never the actual handler wiring.

    #[sqlx::test]
    async fn image_proxy_rejects_a_real_text_html_response_from_the_real_handler(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
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

        let state = make_state(pool).await;
        // Unique per run — a rejected response must never be cached (see
        // image_proxy's own comment on that), but this guards against ever
        // reading a stale cache entry left over from a run where that
        // invariant was temporarily broken (e.g. during mutation testing).
        let source_url = format!(
            "https://example.com/real-evil-image-{}",
            crate::api::invite_code::generate_invite_code()
        );
        let hash = url_hash(&source_url);
        let target = format!(
            "http://{}:{}/evil",
            crate::net::ssrf::TEST_LOOPBACK_HOST,
            addr.port()
        );
        link_previews::upsert(&state.db, &hash, &source_url, None, None, Some(&target))
            .await
            .unwrap();

        let result = image_proxy(
            ImageProxyAuth { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert_eq!(
            result.unwrap_err(),
            StatusCode::BAD_GATEWAY,
            "a real fetched text/html response must be rejected by the real handler, not streamed through"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_streams_a_real_successful_image_fetch_end_to_end(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let png_bytes: &[u8] = b"\x89PNG\r\n\x1a\nreal-image-bytes-from-mock-server";
        let app = axum::Router::new().route(
            "/img.png",
            axum::routing::get(move || async move { ([("content-type", "image/png")], png_bytes) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let state = make_state(pool).await;
        // Unique per run — otherwise a still-live cache entry from a
        // previous run within the 60s TTL would serve this successfully
        // without ever exercising the real fetch this test means to prove.
        let source_url = format!(
            "https://example.com/real-good-image-{}",
            crate::api::invite_code::generate_invite_code()
        );
        let hash = url_hash(&source_url);
        let target = format!(
            "http://{}:{}/img.png",
            crate::net::ssrf::TEST_LOOPBACK_HOST,
            addr.port()
        );
        link_previews::upsert(&state.db, &hash, &source_url, None, None, Some(&target))
            .await
            .unwrap();

        let result = image_proxy(
            ImageProxyAuth { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await
        .unwrap();

        assert_eq!(result.status(), StatusCode::OK);
        let body = axum::body::to_bytes(result.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), png_bytes);
        Ok(())
    }

    #[sqlx::test]
    async fn unfurl_rejects_a_real_non_html_response_from_the_real_handler(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        // The body is deliberately valid, parseable HTML with a real <title>
        // — if the content-type gate were ever removed, parse_preview_html
        // would happily extract it and this test would start seeing
        // available: true. A body with nothing extractable (plain JSON,
        // say) would pass this test whether or not the gate exists at all,
        // since an empty ParsedPreview also collapses to unavailable —
        // exactly the kind of test that only exercises the pure predicate
        // and not the real wiring, which is the gap this test exists to close.
        let app = axum::Router::new().route(
            "/data.json",
            axum::routing::get(|| async {
                (
                    [("content-type", "application/json")],
                    "<html><head><title>should never be parsed</title></head></html>",
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let state = make_state(pool).await;
        let target = format!(
            "http://{}:{}/data.json",
            crate::net::ssrf::TEST_LOOPBACK_HOST,
            addr.port()
        );

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: target }),
        )
        .await
        .unwrap();

        assert!(
            !result.0.available,
            "a real fetched non-text/html response must be rejected by the real unfurl handler"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn unfurl_succeeds_end_to_end_against_a_real_html_page(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let app = axum::Router::new().route(
            "/page",
            axum::routing::get(|| async {
                (
                    [("content-type", "text/html")],
                    r#"<html><head><title>Real Page</title><meta property="og:description" content="a real description"></head></html>"#,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let state = make_state(pool).await;
        let target = format!(
            "http://{}:{}/page",
            crate::net::ssrf::TEST_LOOPBACK_HOST,
            addr.port()
        );

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: target }),
        )
        .await
        .unwrap();

        assert!(result.0.available);
        assert_eq!(result.0.title, Some("Real Page".to_string()));
        assert_eq!(result.0.description, Some("a real description".to_string()));
        Ok(())
    }
}
