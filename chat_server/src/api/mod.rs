pub mod auth;
pub mod invite_code;
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
}

pub struct AuthenticatedUser {
    pub user_id: i64,
}

impl FromRequestParts<Arc<AppState>> for AuthenticatedUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header_token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());

        // Some requests can't carry a custom header at all — an <img> tag
        // driven fetch is one, the same constraint the WS upgrade handshake
        // already works around with a query-string token.
        let query_token = header_token
            .is_none()
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

        Ok(AuthenticatedUser {
            user_id: claims.sub,
        })
    }
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
    async fn query_token_works_when_no_header_is_present(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(7, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?url_hash=abc&token={token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(user.user_id, 7);
        Ok(())
    }

    #[sqlx::test]
    async fn header_wins_when_both_are_present(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let header_token = mint(1, &state.jwt_secret);
        let query_token = mint(2, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?token={query_token}"))
            .header("Authorization", format!("Bearer {header_token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(
            user.user_id, 1,
            "header must take precedence over a query token"
        );
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
}
