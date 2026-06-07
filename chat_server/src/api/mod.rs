// src/api/mod.rs

pub mod server;
pub mod auth;
pub mod messages;
pub mod validation;
pub mod ratelimit;

use sqlx::PgPool;
use redis::Client;
use jsonwebtoken::{decode, DecodingKey, Validation};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use std::sync::Arc;
use crate::api::auth::Claims;


#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: Client,
    pub jwt_secret: String,
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
            &Validation::default(),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

        Ok(AuthenticatedUser {
            user_id: token_data.claims.sub,
        })
        
    }
}


