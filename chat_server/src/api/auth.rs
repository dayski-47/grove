use crate::api::AppState;
use crate::api::ratelimit::check_rate_limit;
use crate::api::validation::{validate_email, validate_password, validate_username};
use axum::extract::ConnectInfo;
use axum::http::HeaderMap;
use axum::{Json, extract::State, http::StatusCode};
use bcrypt::{DEFAULT_COST, hash, verify};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use redis::AsyncCommands;
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

fn jwt_expiry() -> usize {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 86400 // 24h
}

fn mint_token(user_id: i64, secret: &str) -> Result<String, (StatusCode, String)> {
    encode(
        &Header::default(),
        &Claims {
            sub: user_id,
            exp: jwt_expiry(),
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })
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
        "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
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

    // Auto-join the "general" channel so every new user has somewhere to start.
    let _ = sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id)
         SELECT id, $1 FROM channels WHERE name = 'general' AND NOT is_dm LIMIT 1
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(&state.db)
    .await;

    Ok(Json(AuthResponse {
        token: mint_token(user_id, &state.jwt_secret)?,
        user_id,
    }))
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
            .bind(req.email.trim().to_lowercase())
            .fetch_one(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::UNAUTHORIZED,
                    "Invalid email or password".to_string(),
                )
            })?;

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

    let _ = sqlx::query("UPDATE users SET last_seen = NOW() WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await;

    Ok(Json(AuthResponse {
        token: mint_token(user.id, &state.jwt_secret)?,
        user_id: user.id,
    }))
}

/// Invalidates the caller's current JWT by adding it to a Redis blocklist.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let claims = token_data.claims;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;

    let ttl = claims.exp.saturating_sub(now);
    if ttl > 0 {
        let key = format!("blocklist:{}:{}", claims.sub, claims.exp);
        let mut con = state.redis.clone();
        let _: () = con
            .set_ex(&key, 1i64, ttl as u64)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(StatusCode::OK)
}

/// Scrubs the caller's PII and logs them out everywhere. Anonymizes rather
/// than hard-deletes the row — messages/DMs/friendships reference users
/// without ON DELETE CASCADE, and other people's channel history shouldn't
/// break because one member left.
pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let claims = token_data.claims;

    // Unusable but well-formed hash — belt and suspenders alongside the
    // email change below, which already takes the account off the login
    // lookup path entirely.
    let dead_hash = hash(
        crate::api::invite_code::generate_invite_code(),
        DEFAULT_COST,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        "UPDATE users SET username = $1, email = $2, password_hash = $3, about = ''
         WHERE id = $4",
    )
    .bind(format!("deleted_user_{}", claims.sub))
    .bind(format!("deleted_{}@grove.invalid", claims.sub))
    .bind(dead_hash)
    .bind(claims.sub)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;
    let ttl = claims.exp.saturating_sub(now);
    if ttl > 0 {
        let key = format!("blocklist:{}:{}", claims.sub, claims.exp);
        let mut con = state.redis.clone();
        let _: () = con
            .set_ex(&key, 1i64, ttl as u64)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    async fn make_app_state(pool: sqlx::PgPool) -> Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::new(redis),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
        })
    }

    #[sqlx::test]
    async fn delete_account_scrubs_pii_and_blocks_future_login(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        let password_hash = hash("correct horse battery staple", DEFAULT_COST).unwrap();
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'alice@x.com', $1) RETURNING id",
        )
        .bind(&password_hash)
        .fetch_one(&state.db)
        .await?;

        let token = mint_token(user_id, &state.jwt_secret).unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
        );

        let result = delete_account(State(state.clone()), headers).await;
        assert_eq!(result, Ok(StatusCode::OK));

        let (username, email, stored_hash): (String, String, String) =
            sqlx::query_as("SELECT username, email, password_hash FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_one(&state.db)
                .await?;
        assert_eq!(username, format!("deleted_user_{}", user_id));
        assert_eq!(email, format!("deleted_{}@grove.invalid", user_id));
        assert_ne!(stored_hash, password_hash);

        // old email no longer resolves to any account, so the old password is moot
        let unique_ip = std::net::Ipv4Addr::new(127, 0, 0, (rand::random::<u8>()).max(1));
        let login_result = login(
            ConnectInfo(SocketAddr::from((unique_ip, 0))),
            State(state.clone()),
            Json(LoginRequest {
                email: "alice@x.com".to_string(),
                password: "correct horse battery staple".to_string(),
            }),
        )
        .await;
        assert!(login_result.is_err());

        Ok(())
    }
}
