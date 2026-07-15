pub mod auth;
pub mod messages;
pub mod ratelimit;
pub mod server;
pub mod validation;

use crate::api::auth::Claims;
use crate::cache::presence::PresenceTracker;
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
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

        let claims = &token_data.claims;
        let blocklist_key = format!("blocklist:{}:{}", claims.sub, claims.exp);
        let mut con = state.redis.clone();
        let blocked: bool = con.exists(&blocklist_key).await.unwrap_or(false);
        if blocked {
            return Err(StatusCode::UNAUTHORIZED);
        }

        Ok(AuthenticatedUser {
            user_id: claims.sub,
        })
    }
}
