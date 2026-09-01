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

    let content_type = capped
        .content_type
        .unwrap_or_else(|| "application/octet-stream".to_string());

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
        ],
        capped.body,
    )
        .into_response())
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
