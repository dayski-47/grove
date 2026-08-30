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
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub is_private: bool,
}

#[derive(Serialize)]
pub struct CreateChannelResponse {
    pub channel_id: i64,
    pub invite_code: Option<String>,
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
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_private: bool,
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
    let description = req
        .description
        .map(|d| d.chars().take(500).collect::<String>());
    let category = req
        .category
        .map(|c| c.chars().take(100).collect::<String>());
    let invite_code = if req.is_private {
        Some(crate::api::invite_code::generate_invite_code())
    } else {
        None
    };

    let mut tx = state.db.begin().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    let channel_id: i64 = sqlx::query_scalar(
        "INSERT INTO channels (name, description, category, is_private, invite_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(req.name.trim())
    .bind(&description)
    .bind(&category)
    .bind(req.is_private)
    .bind(&invite_code)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
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

    // Seed Redis membership + role after successful commit.
    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con.sadd(&key, auth.user_id).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;
    state
        .roles
        .set_role(channel_id, auth.user_id, "owner")
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Server error".to_string(),
            )
        })?;
    state
        .subscribers
        .subscribe(channel_id as u64, auth.user_id as u64);

    Ok(Json(CreateChannelResponse {
        channel_id,
        invite_code,
    }))
}

#[derive(Deserialize)]
pub struct UpdateChannelRequest {
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_private: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UpdateChannelResponse {
    pub invite_code: Option<String>,
}

pub async fn update_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
    Json(req): Json<UpdateChannelRequest>,
) -> Result<Json<UpdateChannelResponse>, StatusCode> {
    let role = state.roles.get_role(channel_id, auth.user_id).await;
    if role != "owner" && role != "moderator" {
        return Err(StatusCode::FORBIDDEN);
    }
    if req.is_private.is_some() && role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    let current_private: bool = sqlx::query_scalar("SELECT is_private FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let next_private = req.is_private.unwrap_or(current_private);
    let invite_code = if next_private && !current_private {
        Some(crate::api::invite_code::generate_invite_code())
    } else if !next_private {
        None
    } else {
        // Staying private and no explicit toggle — leave the existing code alone.
        sqlx::query_scalar("SELECT invite_code FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };

    let description = req
        .description
        .map(|d| d.chars().take(500).collect::<String>());
    let category = req
        .category
        .map(|c| c.chars().take(100).collect::<String>());

    sqlx::query(
        "UPDATE channels SET
            description = COALESCE($1, description),
            category    = COALESCE($2, category),
            is_private  = $3,
            invite_code = $4
         WHERE id = $5",
    )
    .bind(&description)
    .bind(&category)
    .bind(next_private)
    .bind(&invite_code)
    .bind(channel_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(UpdateChannelResponse { invite_code }))
}

#[derive(Debug, Serialize)]
pub struct RegenerateInviteCodeResponse {
    pub invite_code: String,
}

pub async fn regenerate_invite_code(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
) -> Result<Json<RegenerateInviteCodeResponse>, StatusCode> {
    let role = state.roles.get_role(channel_id, auth.user_id).await;
    if role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    let is_private: bool = sqlx::query_scalar("SELECT is_private FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !is_private {
        return Err(StatusCode::BAD_REQUEST);
    }

    let new_code = crate::api::invite_code::generate_invite_code();
    sqlx::query("UPDATE channels SET invite_code = $1 WHERE id = $2")
        .bind(&new_code)
        .bind(channel_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(RegenerateInviteCodeResponse {
        invite_code: new_code,
    }))
}

#[derive(Deserialize)]
pub struct JoinByCodeRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct JoinByCodeResponse {
    pub channel_id: i64,
    pub name: String,
}

pub async fn join_by_code(
    auth: AuthenticatedUser,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<JoinByCodeRequest>,
) -> Result<Json<JoinByCodeResponse>, StatusCode> {
    check_rate_limit(&state.redis, &format!("join_by_code:{}", addr.ip()), 10, 60).await?;

    let code = req.code.trim();
    if code.is_empty() || code.len() > 12 {
        return Err(StatusCode::NOT_FOUND);
    }

    let channel: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM channels WHERE invite_code = $1 AND is_private = TRUE",
    )
    .bind(code)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Generic 404 either way — never reveal whether a code format was ever valid.
    let (channel_id, name) = channel.ok_or(StatusCode::NOT_FOUND)?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con
        .sadd(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .roles
        .set_role(channel_id, auth.user_id, "member")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .subscribers
        .subscribe(channel_id as u64, auth.user_id as u64);

    Ok(Json(JoinByCodeResponse { channel_id, name }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MemberInfo {
    pub user_id: i64,
    pub username: String,
    pub role: String,
}

pub async fn get_channel_members(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
) -> Result<Json<Vec<MemberInfo>>, StatusCode> {
    assert_channel_member(&state.redis, channel_id, auth.user_id).await?;

    let members = sqlx::query_as::<_, MemberInfo>(
        "SELECT u.id AS user_id, u.username, cm.role
         FROM channel_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.channel_id = $1
         ORDER BY
             CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
             u.username ASC",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(members))
}

#[derive(Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

pub async fn update_member_role(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path((channel_id, target_user_id)): axum::extract::Path<(i64, i64)>,
    Json(req): Json<UpdateMemberRoleRequest>,
) -> Result<StatusCode, StatusCode> {
    if req.role != "moderator" && req.role != "member" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let caller_role = state.roles.get_role(channel_id, auth.user_id).await;
    if caller_role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_user_id == auth.user_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let rows = sqlx::query(
        "UPDATE channel_members SET role = $1 WHERE channel_id = $2 AND user_id = $3 AND role != 'owner'",
    )
    .bind(&req.role)
    .bind(channel_id)
    .bind(target_user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .rows_affected();

    if rows == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    state
        .roles
        .set_role(channel_id, target_user_id, &req.role)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

pub async fn kick_member(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path((channel_id, target_user_id)): axum::extract::Path<(i64, i64)>,
) -> Result<StatusCode, StatusCode> {
    let caller_role = state.roles.get_role(channel_id, auth.user_id).await;
    if caller_role != "owner" && caller_role != "moderator" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_user_id == auth.user_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let target_role = state.roles.get_role(channel_id, target_user_id).await;
    // A moderator may only kick plain members — never the owner or another
    // moderator. Only the owner can remove peers.
    if caller_role == "moderator" && target_role != "member" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_role == "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    // The DB is the actual enforcement boundary here, not the cache reads above —
    // those are only a cheap pre-filter. A stale/missing Redis role entry for the
    // target must never let a moderator delete the real owner, so the DELETE
    // itself is scoped to the caller's permission level against the DB's current
    // role, mirroring update_member_role's atomic `role != 'owner'` guard.
    let rows = if caller_role == "owner" {
        sqlx::query(
            "DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND role != 'owner'",
        )
        .bind(channel_id)
        .bind(target_user_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected()
    } else {
        sqlx::query(
            "DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND role = 'member'",
        )
        .bind(channel_id)
        .bind(target_user_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected()
    };

    if rows == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con
        .srem(&key, target_user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .roles
        .remove_role(channel_id, target_user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .subscribers
        .unsubscribe(channel_id as u64, target_user_id as u64);

    Ok(StatusCode::OK)
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
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT id FROM channels WHERE id = $1 AND is_private = FALSE")
            .bind(req.channel_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    // Postgres is the membership source of truth — commit it first. Seeding
    // Redis before this could grant a channel-membership check (which now
    // reads Redis, not Postgres) to a user whose Postgres write never lands.
    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(req.channel_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", req.channel_id);
    let _: () = con
        .sadd(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .subscribers
        .subscribe(req.channel_id as u64, auth.user_id as u64);

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
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ChannelInfo>>, StatusCode> {
    let channels = sqlx::query_as::<_, ChannelInfo>(
        "SELECT c.id, c.name, c.description, c.category, c.is_private
         FROM channels c
         WHERE NOT c.is_dm
           AND (NOT c.is_private OR EXISTS (
               SELECT 1 FROM channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $1
           ))
         ORDER BY c.id ASC",
    )
    .bind(auth.user_id)
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
        seed_dm_membership(channel_id, me, them, &state.redis, &state.subscribers).await?;
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

    seed_dm_membership(channel_id, me, them, &state.redis, &state.subscribers).await?;

    Ok(Json(OpenDmResponse { channel_id }))
}

async fn seed_dm_membership(
    channel_id: i64,
    user_a: i64,
    user_b: i64,
    redis: &redis::aio::ConnectionManager,
    subscribers: &crate::memory::subscribers::ChannelSubscribers,
) -> Result<(), (StatusCode, String)> {
    let mut con = redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: (i64, i64) = redis::pipe()
        .sadd(&key, user_a)
        .sadd(&key, user_b)
        .query_async(&mut con)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "redis error".into()))?;
    subscribers.subscribe(channel_id as u64, user_a as u64);
    subscribers.subscribe(channel_id as u64, user_b as u64);
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

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_app_state(pool: sqlx::PgPool) -> Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        // Every test shares this same Redis instance (unlike `#[sqlx::test]`'s
        // per-test isolated Postgres database, whose sequences all restart at
        // 1), so give each call its own key namespace to prevent concurrently
        // running tests from colliding on `channel:<id>:roles`.
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

    #[sqlx::test]
    async fn creates_a_public_channel_with_no_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        let auth = AuthenticatedUser { user_id: 1 };
        // Seed a user row so the FK on channel_members is satisfiable.
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;

        let req = CreateChannelRequest {
            name: "general".to_string(),
            description: Some("General chat".to_string()),
            category: Some("Community".to_string()),
            is_private: false,
        };
        let result = create_channel(auth, State(state.clone()), Json(req)).await;
        let Ok(Json(resp)) = result else {
            panic!("create_channel should succeed");
        };
        assert!(resp.invite_code.is_none());

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 1",
        )
        .bind(resp.channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "owner");
        Ok(())
    }

    #[sqlx::test]
    async fn creates_a_private_channel_with_an_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        let auth = AuthenticatedUser { user_id: 1 };
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;

        let req = CreateChannelRequest {
            name: "secret-plans".to_string(),
            description: None,
            category: None,
            is_private: true,
        };
        let result = create_channel(auth, State(state), Json(req)).await;
        let Ok(Json(resp)) = result else {
            panic!("create_channel should succeed");
        };
        assert!(resp.invite_code.is_some());
        assert_eq!(resp.invite_code.unwrap().len(), 10);
        Ok(())
    }

    #[sqlx::test]
    async fn owner_can_update_description_and_category(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let req = UpdateChannelRequest {
            description: Some("Updated description".to_string()),
            category: Some("Ops".to_string()),
            is_private: None,
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        assert!(result.is_ok());

        let (description, category): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT description, category FROM channels WHERE id = $1")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        assert_eq!(description.as_deref(), Some("Updated description"));
        assert_eq!(category.as_deref(), Some("Ops"));
        Ok(())
    }

    #[sqlx::test]
    async fn non_owner_cannot_update_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'member')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        // No role cached — RoleCache::get_role defaults to "member", correctly denying access.

        let req = UpdateChannelRequest {
            description: Some("Hijacked".to_string()),
            category: None,
            is_private: None,
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
        Ok(())
    }

    /// Regression test for the IMPORTANT finding: the frontend's Settings
    /// modal intentionally lets moderators edit description/category
    /// (`canEdit = owner || moderator`), so the backend must accept those
    /// edits from a moderator rather than silently 403ing them — while still
    /// rejecting a moderator's attempt to flip `is_private`, which stays
    /// strictly owner-only.
    #[sqlx::test]
    async fn moderator_can_update_description_but_not_privacy(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'moderator')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        state
            .roles
            .set_role(channel_id, 2, "moderator")
            .await
            .unwrap();

        // Description/category edits succeed for a moderator.
        let req = UpdateChannelRequest {
            description: Some("Moderator-updated description".to_string()),
            category: Some("Ops".to_string()),
            is_private: None,
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        assert!(result.is_ok());

        let (description, category): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT description, category FROM channels WHERE id = $1")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        assert_eq!(
            description.as_deref(),
            Some("Moderator-updated description")
        );
        assert_eq!(category.as_deref(), Some("Ops"));

        // But touching `is_private` is still rejected for a moderator.
        let privacy_req = UpdateChannelRequest {
            description: None,
            category: None,
            is_private: Some(true),
        };
        let privacy_result = update_channel(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path(channel_id),
            Json(privacy_req),
        )
        .await;
        assert_eq!(privacy_result.unwrap_err(), StatusCode::FORBIDDEN);

        let still_public: bool =
            sqlx::query_scalar("SELECT is_private FROM channels WHERE id = $1")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        assert!(!still_public, "is_private must not have been changed");
        Ok(())
    }

    #[sqlx::test]
    async fn toggling_to_private_generates_an_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let req = UpdateChannelRequest {
            description: None,
            category: None,
            is_private: Some(true),
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("update_channel should succeed");
        };
        assert!(resp.invite_code.is_some());
        Ok(())
    }

    #[sqlx::test]
    async fn owner_can_regenerate_invite_code_for_private_channel(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'oldcode123') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = regenerate_invite_code(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path(channel_id),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("regenerate_invite_code should succeed");
        };
        assert_ne!(resp.invite_code, "oldcode123");

        let stored: Option<String> =
            sqlx::query_scalar("SELECT invite_code FROM channels WHERE id = $1")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        assert_eq!(stored, Some(resp.invite_code));
        Ok(())
    }

    #[sqlx::test]
    async fn cannot_regenerate_invite_code_for_public_channel(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = regenerate_invite_code(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[sqlx::test]
    async fn non_owner_cannot_regenerate_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'oldcode123') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'member')",
        )
        .bind(channel_id)
        .execute(&state.db)
        .await?;
        // No role cached — RoleCache::get_role defaults to "member", correctly denying access.

        let result = regenerate_invite_code(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path(channel_id),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);

        let stored: Option<String> =
            sqlx::query_scalar("SELECT invite_code FROM channels WHERE id = $1")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        assert_eq!(stored, Some("oldcode123".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn valid_code_joins_the_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'joincode12') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;

        // Distinct, randomized loopback address so this test's rate-limit
        // bucket (keyed on the caller's IP) never collides with the other
        // `join_by_code` test — or with re-runs of this same test within the
        // same 60-second rate-limit window.
        let unique_ip = std::net::Ipv4Addr::new(127, 0, 0, (rand::random::<u8>()).max(1));
        let result = join_by_code(
            AuthenticatedUser { user_id: 2 },
            ConnectInfo(SocketAddr::from((unique_ip, 0))),
            State(state.clone()),
            Json(JoinByCodeRequest {
                code: "joincode12".to_string(),
            }),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("join_by_code should succeed");
        };
        assert_eq!(resp.channel_id, channel_id);

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 2",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "member");
        Ok(())
    }

    #[sqlx::test]
    async fn invalid_code_returns_generic_not_found(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;

        // Distinct, randomized loopback address — see comment in
        // `valid_code_joins_the_channel` for why this can't be a fixed IP.
        let unique_ip = std::net::Ipv4Addr::new(127, 0, 0, (rand::random::<u8>()).max(1));
        let result = join_by_code(
            AuthenticatedUser { user_id: 2 },
            ConnectInfo(SocketAddr::from((unique_ip, 0))),
            State(state),
            Json(JoinByCodeRequest {
                code: "doesnotexist".to_string(),
            }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }

    /// Regression test for the CRITICAL finding: `join_channel` (the plain
    /// join-by-id endpoint that `openChannel()` calls on every channel open)
    /// must never let a user into a private channel just by knowing/guessing
    /// its numeric id — that would completely bypass the invite-code system.
    #[sqlx::test]
    async fn non_member_cannot_join_private_channel_by_id(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'joincode12') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;

        let result = join_channel(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            Json(JoinChannelRequest { channel_id }),
        )
        .await;
        assert_eq!(result, Err(StatusCode::NOT_FOUND));

        let member_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id = $1 AND user_id = 2",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(
            member_count, 0,
            "no membership row should have been created"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn list_channels_hides_private_channels_from_non_members(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        sqlx::query("INSERT INTO channels (name, is_private) VALUES ('public-chan', FALSE)")
            .execute(&state.db)
            .await?;
        let private_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret-chan', TRUE, 'abc1234567') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')",
        )
        .bind(private_id)
        .execute(&state.db)
        .await?;

        let as_member = list_channels(AuthenticatedUser { user_id: 1 }, State(state.clone())).await;
        let Ok(Json(member_view)) = as_member else {
            panic!("should succeed")
        };
        // The `002_seed.sql` migration always inserts a public "general" channel into every
        // fresh test database, so we assert on membership rather than exact counts.
        assert!(
            member_view.iter().any(|c| c.name == "public-chan"),
            "owner sees the public channel"
        );
        assert!(
            member_view.iter().any(|c| c.name == "secret-chan"),
            "owner sees the private channel they belong to"
        );

        let as_outsider = list_channels(AuthenticatedUser { user_id: 2 }, State(state)).await;
        let Ok(Json(outsider_view)) = as_outsider else {
            panic!("should succeed")
        };
        assert!(
            outsider_view.iter().any(|c| c.name == "public-chan"),
            "non-member sees the public channel"
        );
        assert!(
            !outsider_view.iter().any(|c| c.name == "secret-chan"),
            "non-member does not see the private channel"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn returns_members_ordered_owner_first(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'member'), ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        let key = format!("channel:{}:members", channel_id);
        let mut con = state.redis.clone();
        let _: () = redis::AsyncCommands::sadd(&mut con, &key, vec![1i64, 2i64])
            .await
            .unwrap();

        let result = get_channel_members(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        let Ok(Json(members)) = result else {
            panic!("should succeed")
        };
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].username, "alice");
        assert_eq!(members[0].role, "owner");
        Ok(())
    }

    #[sqlx::test]
    async fn non_member_cannot_list_members(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;

        let result = get_channel_members(
            AuthenticatedUser { user_id: 3 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
        Ok(())
    }

    #[sqlx::test]
    async fn owner_can_promote_member_to_moderator(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = update_member_role(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path((channel_id, 2)),
            Json(UpdateMemberRoleRequest {
                role: "moderator".to_string(),
            }),
        )
        .await;
        assert_eq!(result, Ok(StatusCode::OK));

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 2",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "moderator");
        assert_eq!(state.roles.get_role(channel_id, 2).await, "moderator");
        Ok(())
    }

    #[sqlx::test]
    async fn moderator_cannot_promote_anyone(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h'), (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'moderator'), ($1, 3, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state
            .roles
            .set_role(channel_id, 2, "moderator")
            .await
            .unwrap();

        let result = update_member_role(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path((channel_id, 3)),
            Json(UpdateMemberRoleRequest {
                role: "moderator".to_string(),
            }),
        )
        .await;
        assert_eq!(result, Err(StatusCode::FORBIDDEN));
        Ok(())
    }

    #[sqlx::test]
    async fn moderator_can_kick_a_plain_member(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h'), (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'moderator'), ($1, 3, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state
            .roles
            .set_role(channel_id, 2, "moderator")
            .await
            .unwrap();
        state.roles.set_role(channel_id, 3, "member").await.unwrap();

        let result = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path((channel_id, 3)),
        )
        .await;
        assert_eq!(result, Ok(StatusCode::OK));

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id = $1 AND user_id = 3",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(remaining, 0);
        Ok(())
    }

    #[sqlx::test]
    async fn moderator_cannot_kick_the_owner_or_another_moderator(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h'), (4, 'dan', 'd@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'moderator'), ($1, 4, 'moderator')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();
        state
            .roles
            .set_role(channel_id, 2, "moderator")
            .await
            .unwrap();
        state
            .roles
            .set_role(channel_id, 4, "moderator")
            .await
            .unwrap();

        let kick_owner = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path((channel_id, 1)),
        )
        .await;
        assert_eq!(kick_owner, Err(StatusCode::FORBIDDEN));

        let kick_peer_mod = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path((channel_id, 4)),
        )
        .await;
        assert_eq!(kick_peer_mod, Err(StatusCode::FORBIDDEN));
        Ok(())
    }

    /// Regression test for the HIGH finding: `get_role` fails closed to "member"
    /// on a cache miss, so a moderator kicking a target whose Redis role entry
    /// is stale/missing must still be blocked by the DB's actual current role —
    /// not just the cache-based pre-checks, which would incorrectly pass here.
    #[sqlx::test]
    async fn kick_member_is_blocked_by_db_role_even_with_stale_owner_cache(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'moderator')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state
            .roles
            .set_role(channel_id, 2, "moderator")
            .await
            .unwrap();
        // Deliberately ensure there is no cache entry for user 1 (the real DB
        // owner) — simulating a stale/missing Redis role entry. Redis is shared
        // across test runs (unlike the per-test Postgres database), so an
        // explicit remove_role is needed to guarantee the miss rather than
        // relying on the key never having been set. `get_role` fails closed to
        // "member" on a miss, so the cache-based pre-checks alone would
        // incorrectly allow this kick to proceed.
        state.roles.remove_role(channel_id, 1).await.unwrap();
        assert_eq!(state.roles.get_role(channel_id, 1).await, "member");

        let result = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path((channel_id, 1)),
        )
        .await;
        assert_eq!(result, Err(StatusCode::NOT_FOUND));

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id = $1 AND user_id = 1",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(remaining, 1, "the real owner must not have been removed");
        Ok(())
    }

    #[sqlx::test]
    async fn plain_member_cannot_kick_anyone(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (3, 'carol', 'c@x.com', 'h'), (5, 'eve', 'e@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 3, 'member'), ($1, 5, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;

        let result = kick_member(
            AuthenticatedUser { user_id: 3 },
            State(state),
            axum::extract::Path((channel_id, 5)),
        )
        .await;
        assert_eq!(result, Err(StatusCode::FORBIDDEN));
        Ok(())
    }
}
