use crate::api::ratelimit::check_rate_limit;
use crate::api::validation::validate_channel_name;
use crate::api::{AppState, AuthenticatedUser};
use axum::{
    Json,
    extract::{ConnectInfo, Query, State},
    http::StatusCode,
};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
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
    pub edited: bool,
    pub deleted: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReactionSummary {
    pub message_id: i64,
    pub emoji: String,
    pub count: i64,
    pub by_me: bool,
}

#[derive(Deserialize)]
pub struct ReactionsQuery {
    pub channel_id: i64,
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
    pub about: String,
    pub last_seen: i64,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Deserialize)]
pub struct UpdateProfileBody {
    pub about: String,
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

#[derive(Serialize, sqlx::FromRow)]
pub struct PinnedMessage {
    pub message_id: i64,
    pub channel_id: i64,
    pub text: String,
    pub user_id: i64,
    pub username: String,
    pub pinned_by: i64,
    pub pinned_at: i64,
}

#[derive(Deserialize)]
pub struct PinMessageRequest {
    pub message_id: i64,
}

pub async fn get_user(
    _auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(user_id): axum::extract::Path<i64>,
) -> Result<Json<UserProfile>, StatusCode> {
    let user = sqlx::query_as::<_, UserProfile>(
        "SELECT id, username, about,
                FLOOR(EXTRACT(EPOCH FROM last_seen))::BIGINT AS last_seen
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Json(user))
}

pub async fn search_users(
    _auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Vec<UserProfile>>, StatusCode> {
    let q = params.q.trim().to_lowercase();
    if q.is_empty() || q.len() > 50 {
        return Ok(Json(vec![]));
    }
    let pattern = format!("%{}%", q);
    let users = sqlx::query_as::<_, UserProfile>(
        "SELECT id, username, about,
                FLOOR(EXTRACT(EPOCH FROM last_seen))::BIGINT AS last_seen
         FROM users
         WHERE LOWER(username) LIKE $1
         ORDER BY username ASC
         LIMIT 20",
    )
    .bind(&pattern)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(users))
}

pub async fn update_my_profile(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateProfileBody>,
) -> Result<StatusCode, StatusCode> {
    let about = body.about.chars().take(280).collect::<String>();
    sqlx::query("UPDATE users SET about = $1 WHERE id = $2")
        .bind(&about)
        .bind(auth.user_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn create_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<Json<CreateChannelResponse>, (StatusCode, String)> {
    validate_channel_name(&req.name)?;

    // Both DB writes in one transaction: if either fails the channel doesn't exist.
    let mut tx = state.db.begin().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    let channel_id: i64 =
        sqlx::query_scalar("INSERT INTO channels (name) VALUES ($1) RETURNING id")
            .bind(req.name.trim())
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Server error".to_string(),
                )
            })?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    tx.commit().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    // Seed Redis membership after successful commit.
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
        "SELECT id, user_id,
                CASE WHEN deleted_at IS NOT NULL THEN '' ELSE text END AS text,
                timestamp,
                edited_at  IS NOT NULL AS edited,
                deleted_at IS NOT NULL AS deleted
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

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(req.channel_id)
    .bind(auth.user_id)
    .execute(&state.db)
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
    let channels = sqlx::query_as::<_, ChannelInfo>(
        "SELECT id, name FROM channels WHERE NOT is_dm ORDER BY id ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(channels))
}

pub async fn get_channel_reactions(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ReactionsQuery>,
) -> Result<Json<Vec<ReactionSummary>>, StatusCode> {
    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", params.channel_id);
    let is_member: bool = con
        .sismember(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !is_member {
        return Err(StatusCode::FORBIDDEN);
    }

    let reactions = sqlx::query_as::<_, ReactionSummary>(
        "SELECT r.message_id, r.emoji,
                COUNT(*)::BIGINT            AS count,
                bool_or(r.user_id = $2)    AS by_me
         FROM reactions r
         JOIN messages m ON m.id = r.message_id
         WHERE m.channel_id = $1
         GROUP BY r.message_id, r.emoji",
    )
    .bind(params.channel_id)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(reactions))
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
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<OpenDmRequest>,
) -> Result<Json<OpenDmResponse>, (StatusCode, String)> {
    check_rate_limit(&state.redis, &format!("dm_open:{}", addr.ip()), 20, 60)
        .await
        .map_err(|s| (s, "Too many requests".into()))?;

    let me = auth.user_id;
    let them = req.with_user;

    if me == them {
        return Err((StatusCode::BAD_REQUEST, "cannot DM yourself".into()));
    }

    // Ensure target user actually exists.
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM users WHERE id = $1")
        .bind(them)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;
    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "user not found".into()));
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
        sqlx::query_scalar("INSERT INTO channels (name, is_dm) VALUES ('dm', TRUE) RETURNING id")
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

// ── Friends ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct FriendRequest {
    pub user_id: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FriendInfo {
    pub user_id: i64,
    pub username: String,
    pub online: bool,
}

pub async fn add_friend(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<FriendRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let me = auth.user_id;
    let them = req.user_id;

    if me == them {
        return Err((StatusCode::BAD_REQUEST, "cannot friend yourself".into()));
    }

    // Verify target exists.
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM users WHERE id = $1")
        .bind(them)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;
    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "user not found".into()));
    }

    let (a, b) = if me < them { (me, them) } else { (them, me) };

    sqlx::query("INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(a)
        .bind(b)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    Ok(StatusCode::OK)
}

pub async fn remove_friend(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<FriendRequest>,
) -> Result<StatusCode, StatusCode> {
    let me = auth.user_id;
    let them = req.user_id;
    let (a, b) = if me < them { (me, them) } else { (them, me) };

    sqlx::query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2")
        .bind(a)
        .bind(b)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

pub async fn list_friends(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<FriendInfo>>, StatusCode> {
    let me = auth.user_id;

    // Fetch friend user_ids + usernames in one query.
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT u.id, u.username
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
         WHERE f.user_a = $1 OR f.user_b = $1
         ORDER BY u.username ASC",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if rows.is_empty() {
        return Ok(Json(vec![]));
    }

    // Batch presence check.
    let mut con = state.redis.clone();
    let mut pipe = redis::pipe();
    for (id, _) in &rows {
        pipe.exists(format!("presence:{}", id));
    }
    let online_flags: Vec<bool> = pipe
        .query_async(&mut con)
        .await
        .unwrap_or_else(|_| vec![false; rows.len()]);

    let friends = rows
        .into_iter()
        .zip(online_flags)
        .map(|((user_id, username), online)| FriendInfo {
            user_id,
            username,
            online,
        })
        .collect();

    Ok(Json(friends))
}

// ── Pinned messages ───────────────────────────────────────────────────────────

async fn assert_channel_member(
    redis: &ConnectionManager,
    channel_id: i64,
    user_id: i64,
) -> Result<(), StatusCode> {
    let mut con = redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let ok: bool = con.sismember(&key, user_id).await.unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

pub async fn get_channel_pins(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ReactionsQuery>,
) -> Result<Json<Vec<PinnedMessage>>, StatusCode> {
    assert_channel_member(&state.redis, params.channel_id, auth.user_id).await?;

    let pins = sqlx::query_as::<_, PinnedMessage>(
        "SELECT pm.message_id, pm.channel_id,
                CASE WHEN m.deleted_at IS NOT NULL THEN '' ELSE m.text END AS text,
                m.user_id, u.username, pm.pinned_by,
                FLOOR(EXTRACT(EPOCH FROM pm.pinned_at))::BIGINT AS pinned_at
         FROM pinned_messages pm
         JOIN messages m ON m.id = pm.message_id
         JOIN users u ON u.id = m.user_id
         WHERE pm.channel_id = $1
         ORDER BY pm.pinned_at DESC",
    )
    .bind(params.channel_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(pins))
}

pub async fn pin_message(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<PinMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    // Verify the message exists and get its channel_id
    let channel_id = sqlx::query_scalar::<_, i64>(
        "SELECT channel_id FROM messages WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(body.message_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    assert_channel_member(&state.redis, channel_id, auth.user_id).await?;

    sqlx::query(
        "INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(channel_id)
    .bind(body.message_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

pub async fn unpin_message(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<PinMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let channel_id = sqlx::query_scalar::<_, i64>("SELECT channel_id FROM messages WHERE id = $1")
        .bind(body.message_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    assert_channel_member(&state.redis, channel_id, auth.user_id).await?;

    sqlx::query("DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2")
        .bind(channel_id)
        .bind(body.message_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}
