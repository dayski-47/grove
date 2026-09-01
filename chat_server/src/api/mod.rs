pub mod auth;
pub mod invite_code;
pub mod links;
pub mod messages;
pub mod ratelimit;
pub mod server;
pub mod validation;

use crate::api::auth::Claims;
use crate::cache::presence::PresenceTracker;
use crate::cache::roles::RoleCache;
use crate::memory::subscribers::ChannelSubscribers;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub jwt_secret: String,
    pub presence: PresenceTracker,
    pub roles: RoleCache,
    pub subscribers: ChannelSubscribers,
    pub allowed_origins: Vec<String>,
    pub http_client: reqwest::Client,
}

/// Header-only auth — the extractor every ordinary REST route uses. No
/// query-string fallback: a JWT sitting in a query string is a bearer
/// capability URL, and this app's `nginx.conf` has no custom `log_format`
/// override, so the default `combined` format records the full query string
/// on every request. Widening that to the whole API surface (~29 routes)
/// would meaningfully expand the token-leakage blast radius (access logs,
/// proxies, browser history, screenshots) — see `ImageProxyAuth` below for
/// the one route that actually needs the fallback.
pub struct AuthenticatedUser {
    pub user_id: i64,
}

impl FromRequestParts<Arc<AppState>> for AuthenticatedUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let user_id = authenticate(parts, state, false).await?;
        Ok(AuthenticatedUser { user_id })
    }
}

/// Auth extractor for `image_proxy` only — the sole route loaded from an
/// `<img src>` rather than a JS `fetch`, so it can't attach a custom
/// `Authorization` header (the same constraint the WS upgrade handshake
/// already works around with its own `?token=` query parameter). Everywhere
/// else in the API keeps using the header-only `AuthenticatedUser` above.
pub struct ImageProxyAuth {
    pub user_id: i64,
}

impl FromRequestParts<Arc<AppState>> for ImageProxyAuth {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let user_id = authenticate(parts, state, true).await?;
        Ok(ImageProxyAuth { user_id })
    }
}

/// Shared body for both extractors above, so the JWT-decode/blocklist-check
/// logic isn't duplicated between them. `allow_query_fallback` is the only
/// difference in behavior between `AuthenticatedUser` and `ImageProxyAuth`.
async fn authenticate(
    parts: &mut Parts,
    state: &Arc<AppState>,
    allow_query_fallback: bool,
) -> Result<i64, StatusCode> {
    let header_present = parts.headers.contains_key("Authorization");

    let header_token = parts
        .headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // Gate on whether the header is *present*, not on whether it parsed — a
    // header that's present but malformed/wrong-scheme must hard-fail 401
    // rather than silently falling through to a query token. Also gated on
    // `allow_query_fallback` — only ImageProxyAuth ever consults the query
    // string at all.
    let query_token = (allow_query_fallback && !header_present)
        .then(|| {
            parts.uri.query().and_then(|q| {
                q.split('&')
                    .find(|p| p.starts_with("token="))
                    .and_then(|p| p.strip_prefix("token="))
                    .map(|s| s.to_string())
            })
        })
        .flatten();

    let token = header_token
        .or(query_token)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_data = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let claims = &token_data.claims;
    let blocklist_key = format!("blocklist:{}:{}", claims.sub, claims.exp);
    let mut con = state.redis.clone();
    // Fail closed: if Redis is unreachable we can't confirm the token
    // hasn't been revoked, so treat it as blocked rather than admit it.
    let blocked: bool = con.exists(&blocklist_key).await.unwrap_or(true);
    if blocked {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(claims.sub)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::FromRequestParts;
    use axum::http::Request;
    use jsonwebtoken::{EncodingKey, Header, encode};

    async fn make_state(pool: sqlx::PgPool) -> Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        // Every test shares this same Redis instance (unlike `#[sqlx::test]`'s
        // per-test isolated Postgres database, whose sequences all restart at
        // 1), so give each call its own key namespace to prevent concurrently
        // running tests from colliding — mirrors `make_app_state` in
        // `api/messages.rs`.
        let test_prefix = format!("test-{}-", crate::api::invite_code::generate_invite_code());
        Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::with_prefix(redis, test_prefix),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
            http_client: crate::net::ssrf::build_http_client(),
        })
    }

    fn mint(user_id: i64, secret: &str) -> String {
        encode(
            &Header::default(),
            &Claims {
                sub: user_id,
                exp: 9_999_999_999,
            },
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    #[sqlx::test]
    async fn authorization_header_still_works_unchanged(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(42, &state.jwt_secret);

        let req = Request::builder()
            .uri("/whatever")
            .header("Authorization", format!("Bearer {token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(user.user_id, 42);
        Ok(())
    }

    #[sqlx::test]
    async fn rejects_when_neither_source_has_a_token(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let req = Request::builder().uri("/whatever").body(()).unwrap();
        let (mut parts, _) = req.into_parts();

        let result = AuthenticatedUser::from_request_parts(&mut parts, &state).await;
        // `AuthenticatedUser` intentionally doesn't derive `Debug` (it's the
        // auth boundary's success type), so `unwrap_err` isn't available —
        // match on the rejection directly instead.
        assert!(matches!(result, Err(StatusCode::UNAUTHORIZED)));
        Ok(())
    }

    /// Regression for the blast-radius fix: `AuthenticatedUser` (used by
    /// every route except `image_proxy`) must reject a query-only token
    /// outright now, proving the query-token fallback no longer applies to
    /// the ~28 other routes that share this extractor.
    #[sqlx::test]
    async fn authenticated_user_rejects_a_query_only_token_with_no_header(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(7, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?token={token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let result = AuthenticatedUser::from_request_parts(&mut parts, &state).await;
        assert!(matches!(result, Err(StatusCode::UNAUTHORIZED)));
        Ok(())
    }

    // --- ImageProxyAuth: the only extractor that still allows a ?token= fallback ---

    #[sqlx::test]
    async fn image_proxy_auth_header_still_works_unchanged(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(42, &state.jwt_secret);

        let req = Request::builder()
            .uri("/whatever")
            .header("Authorization", format!("Bearer {token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = ImageProxyAuth::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(user.user_id, 42);
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_auth_query_token_works_when_no_header_is_present(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(7, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?url_hash=abc&token={token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = ImageProxyAuth::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(user.user_id, 7);
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_auth_header_wins_when_both_are_present(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let header_token = mint(1, &state.jwt_secret);
        let query_token = mint(2, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?token={query_token}"))
            .header("Authorization", format!("Bearer {header_token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = ImageProxyAuth::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(
            user.user_id, 1,
            "header must take precedence over a query token"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_auth_rejects_when_neither_source_has_a_token(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let req = Request::builder().uri("/whatever").body(()).unwrap();
        let (mut parts, _) = req.into_parts();

        let result = ImageProxyAuth::from_request_parts(&mut parts, &state).await;
        assert!(matches!(result, Err(StatusCode::UNAUTHORIZED)));
        Ok(())
    }

    #[sqlx::test]
    async fn image_proxy_auth_malformed_header_is_not_silently_replaced_by_a_valid_query_token(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let query_token = mint(2, &state.jwt_secret);

        // A well-formed but wrong-scheme Authorization header, paired with a
        // valid query token. The header is *present*, so it must never fall
        // through to the query string — this must hard-fail 401, not
        // authenticate as the query token's identity.
        let req = Request::builder()
            .uri(format!("/whatever?token={query_token}"))
            .header("Authorization", "Basic dXNlcjpwYXNz")
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let result = ImageProxyAuth::from_request_parts(&mut parts, &state).await;
        assert!(matches!(result, Err(StatusCode::UNAUTHORIZED)));
        Ok(())
    }
}
