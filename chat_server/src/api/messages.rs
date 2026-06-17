use crate::api::validation::validate_channel_name;
use crate::api::{AppState, AuthenticatedUser};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub channel_id: i64,
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct HistoricMessage {
    pub id: i64,
    pub user_id: i64,
    pub text: String,
    pub timestamp: i32,
}

#[derive(Deserialize)]
pub struct JoinChannelRequest {
    pub channel_id: i64,
}

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateChannelResponse {
    pub channel_id: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UserProfile {
    pub id: i64,
    pub username: String,
}

#[derive(Deserialize)]
pub struct ChannelOnlineQuery {
    pub channel_id: i64,
}

#[derive(Serialize)]
pub struct OnlineUsersResponse {
    pub user_ids: Vec<u64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ChannelInfo {
    pub id: i64,
    pub name: String,
}

pub async fn get_user(
    _auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(user_id): axum::extract::Path<i64>,
) -> Result<Json<UserProfile>, StatusCode> {
    let user = sqlx::query_as::<_, UserProfile>("SELECT id, username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Json(user))
}

pub async fn create_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<Json<CreateChannelResponse>, (StatusCode, String)> {
    validate_channel_name(&req.name)?;

    let channel_id: i64 =
        sqlx::query_scalar("INSERT INTO channels (name) VALUES ($1) RETURNING id")
            .bind(req.name.trim())
            .fetch_one(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Server error".to_string(),
                )
            })?;

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con.sadd(&key, auth.user_id).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    Ok(Json(CreateChannelResponse { channel_id }))
}

pub async fn get_history(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<HistoryQuery>,
) -> Result<Json<Vec<HistoricMessage>>, StatusCode> {
    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", params.channel_id);
    let is_member: bool = con
        .sismember(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !is_member {
        return Err(StatusCode::FORBIDDEN);
    }

    let limit = params.limit.unwrap_or(50).min(100);
    let messages = sqlx::query_as::<_, HistoricMessage>(
        "SELECT id, user_id, text, timestamp
         FROM messages
         WHERE channel_id = $1 AND id < $2
         ORDER BY id DESC
         LIMIT $3",
    )
    .bind(params.channel_id)
    .bind(params.before.unwrap_or(i64::MAX))
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(messages))
}

pub async fn join_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<JoinChannelRequest>,
) -> Result<StatusCode, StatusCode> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM channels WHERE id = $1")
        .bind(req.channel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", req.channel_id);
    let _: () = con
        .sadd(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

pub async fn get_channel_online(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ChannelOnlineQuery>,
) -> Result<Json<OnlineUsersResponse>, StatusCode> {
    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", params.channel_id);
    let is_member: bool = con
        .sismember(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !is_member {
        return Err(StatusCode::FORBIDDEN);
    }

    let user_ids = state
        .presence
        .get_online_users(params.channel_id as u64)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(OnlineUsersResponse { user_ids }))
}

pub async fn list_channels(
    _auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ChannelInfo>>, StatusCode> {
    let channels =
        sqlx::query_as::<_, ChannelInfo>("SELECT id, name FROM channels ORDER BY id ASC")
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(channels))
}

// ── Direct messages ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct OpenDmRequest {
    pub with_user: i64,
}

#[derive(Serialize)]
pub struct OpenDmResponse {
    pub channel_id: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct DmInfo {
    pub channel_id: i64,
    pub partner_id: i64,
    pub partner_name: String,
}

/// Opens (or returns existing) DM channel between the caller and `with_user`.
/// Idempotent: calling twice for the same pair returns the same channel_id.
pub async fn open_dm(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<OpenDmRequest>,
) -> Result<Json<OpenDmResponse>, (StatusCode, String)> {
    let me = auth.user_id;
    let them = req.with_user;

    if me == them {
        return Err((StatusCode::BAD_REQUEST, "cannot DM yourself".into()));
    }

    // Canonical order: smaller id first.
    let (a, b) = if me < them { (me, them) } else { (them, me) };

    // Check for existing DM channel.
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT channel_id FROM direct_messages WHERE user_a = $1 AND user_b = $2",
    )
    .bind(a)
    .bind(b)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    if let Some(channel_id) = existing {
        // Ensure both are in the Redis membership set (handles reconnect/Redis flush).
        seed_dm_membership(channel_id, me, them, &state.redis).await?;
        return Ok(Json(OpenDmResponse { channel_id }));
    }

    // Create a backing channel row and the DM record atomically.
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    let channel_id: i64 =
        sqlx::query_scalar("INSERT INTO channels (name) VALUES ('dm') RETURNING id")
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    sqlx::query("INSERT INTO direct_messages (user_a, user_b, channel_id) VALUES ($1, $2, $3)")
        .bind(a)
        .bind(b)
        .bind(channel_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    tx.commit()
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    seed_dm_membership(channel_id, me, them, &state.redis).await?;

    Ok(Json(OpenDmResponse { channel_id }))
}

async fn seed_dm_membership(
    channel_id: i64,
    user_a: i64,
    user_b: i64,
    redis: &redis::aio::ConnectionManager,
) -> Result<(), (StatusCode, String)> {
    let mut con = redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: (i64, i64) = redis::pipe()
        .sadd(&key, user_a)
        .sadd(&key, user_b)
        .query_async(&mut con)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "redis error".into()))?;
    Ok(())
}

/// Lists all DM conversations the caller is part of.
pub async fn list_dms(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<DmInfo>>, StatusCode> {
    let me = auth.user_id;
    let dms = sqlx::query_as::<_, DmInfo>(
        "SELECT
             dm.channel_id,
             CASE WHEN dm.user_a = $1 THEN dm.user_b ELSE dm.user_a END AS partner_id,
             u.username AS partner_name
         FROM direct_messages dm
         JOIN users u ON u.id = CASE WHEN dm.user_a = $1 THEN dm.user_b ELSE dm.user_a END
         WHERE dm.user_a = $1 OR dm.user_b = $1
         ORDER BY dm.id DESC",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(dms))
}
