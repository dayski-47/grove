// src/api/auth.rs

use crate::api::AppState;
use crate::api::ratelimit::check_rate_limit;
use crate::api::validation::{validate_email, validate_password, validate_username};
use axum::extract::ConnectInfo;
use axum::{Json, extract::State, http::StatusCode};
use bcrypt::{DEFAULT_COST, hash, verify};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
#[derive(Deserialize)]

pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: i64,
}

#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub sub: i64,
    pub exp: usize,
}

pub async fn register(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    check_rate_limit(&state.redis, &format!("register:{}", addr.ip()), 5, 3600)
        .await
        .map_err(|s| (s, "Too many registration attempts".to_string()))?;

    validate_username(&req.username)?;
    validate_email(&req.email)?;
    validate_password(&req.password)?;

    let password_hash = hash(req.password.as_bytes(), DEFAULT_COST).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    let user_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, email, password_hash)
    VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&req.username)
    .bind(req.email.trim().to_lowercase())
    .bind(&password_hash)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::CONFLICT,
            "Username or email already taken".to_string(),
        )
    })?;

    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 86400; // 24 hours

    let claims = Claims {
        sub: user_id,
        exp: expiry,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    Ok(Json(AuthResponse { token, user_id }))
}

#[derive(sqlx::FromRow)]
pub struct UserRecord {
    pub id: i64,
    pub password_hash: String,
}

pub async fn login(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    check_rate_limit(&state.redis, &format!("login:{}", addr.ip()), 10, 60)
        .await
        .map_err(|s| (s, "Too many login attempts. Try again later".to_string()))?;

    validate_email(&req.email)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid email".to_string()))?;

    let user =
        sqlx::query_as::<_, UserRecord>("SELECT id, password_hash FROM users WHERE email = $1")
            .bind(&req.email)
            .fetch_one(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::UNAUTHORIZED,
                    "Invalid email or password".to_string(),
                )
            })?;

    println!("Attempting verify for user_id: {}", user.id);
    println!("Password bytes len: {}", req.password.len());
    println!("Hash: {}", &user.password_hash);
    let valid = verify(req.password.as_bytes(), &user.password_hash).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    if !valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid email or password".to_string(),
        ));
    }
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 86400; // 24 hours

    let claims = Claims {
        sub: user.id,
        exp: expiry,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    Ok(Json(AuthResponse {
        token,
        user_id: user.id,
    }))
}
