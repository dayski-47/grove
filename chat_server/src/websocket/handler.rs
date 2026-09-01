use crate::api::AppState;
use crate::api::ratelimit::check_rate_limit;
use crate::api::validation::validate_message_text;
use crate::memory::message_pool::MAX_MESSAGE_SIZE;
use crate::memory::user_pool::{User, UserFlags};
use crate::protocol::message::{Message, MessageHeader, MessageType};
use crate::signaling::types::SignalingMessage;
use crate::websocket::state::ServerState;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use std::sync::Arc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    state: Arc<ServerState>,
    app_state: Arc<AppState>,
    user_id: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    state.add_connection(user_id, tx);

    let username = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(user_id as i64)
        .fetch_optional(&app_state.db)
        .await?;
    if let Some(name) = username {
        state.user_pool.insert(User::new(user_id, &name));
    }

    let _ = sqlx::query("UPDATE users SET last_seen = NOW() WHERE id = $1")
        .bind(user_id as i64)
        .execute(&app_state.db)
        .await;

    if let Err(e) = seed_redis_membership(
        user_id,
        &app_state.db,
        &app_state.redis,
        &app_state.roles,
        &app_state.subscribers,
    )
    .await
    {
        eprintln!("warn: redis membership seed failed for {user_id}: {e}");
    }
    app_state.presence.mark_online(user_id).await?;
    send_online_roster(user_id, &state);
    broadcast_presence(user_id, "online", &state);

    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let presence = app_state.presence.clone();
    let presence_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
            if presence.mark_online(user_id).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = read.next().await {
        let Ok(msg) = msg else { break };
        if msg.is_binary() {
            let data = msg.into_data();
            if let Err(e) = handle_binary_message(&data, &state, &app_state, user_id).await {
                eprintln!("bad frame from {user_id}, closing connection: {e}");
                break;
            }
        }
    }

    presence_task.abort();
    state.remove_connection(user_id);
    app_state.subscribers.remove_user(user_id);
    let _ = app_state.presence.mark_offline(user_id).await; // don't let Redis errors skip the broadcast
    broadcast_presence(user_id, "offline", &state);
    Ok(())
}

fn now_unix() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32
}

// Rewrites user_id (bytes 1-4) and timestamp (bytes 9-12) to prevent spoofing.
fn sanitize_frame(data: &[u8], user_id: u64, timestamp: u32) -> Vec<u8> {
    let mut frame = data.to_vec();
    if frame.len() >= MessageHeader::SIZE {
        frame[1..5].copy_from_slice(&(user_id as u32).to_le_bytes());
        frame[9..13].copy_from_slice(&timestamp.to_le_bytes());
    }
    frame
}

fn make_typed_text_frame(
    msg_type: u8,
    user_id: u64,
    channel_id: u32,
    timestamp: u32,
    text: &str,
) -> Option<Vec<u8>> {
    let text_bytes = text.as_bytes();
    let mut buf = vec![0u8; MessageHeader::SIZE + text_bytes.len()];
    let header = MessageHeader {
        msg_type,
        user_id: user_id as u32,
        channel_id,
        timestamp,
        text_len: text_bytes.len() as u16,
    };
    header.to_bytes(&mut buf).ok()?;
    buf[MessageHeader::SIZE..].copy_from_slice(text_bytes);
    Some(buf)
}

// Payload format: "status" or "status:name" — clients learn usernames from presence frames.
fn make_presence_frame(user_id: u64, status: &str, name: Option<&str>) -> Option<WsMessage> {
    let payload = match name {
        Some(n) if !n.is_empty() => format!("{}:{}", status, n),
        _ => status.to_string(),
    };
    let text_bytes = payload.as_bytes();
    let mut buf = vec![0u8; MessageHeader::SIZE + text_bytes.len()];
    let header = MessageHeader {
        msg_type: MessageType::PRESENCE,
        user_id: user_id as u32,
        channel_id: 0,
        timestamp: now_unix(),
        text_len: text_bytes.len() as u16,
    };
    header.to_bytes(&mut buf).ok()?;
    buf[MessageHeader::SIZE..].copy_from_slice(text_bytes);
    Some(WsMessage::Binary(buf.into()))
}

async fn seed_redis_membership(
    user_id: u64,
    db: &sqlx::PgPool,
    redis: &ConnectionManager,
    roles: &crate::cache::roles::RoleCache,
    subscribers: &crate::memory::subscribers::ChannelSubscribers,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut con = redis.clone();

    // Regular channels the user has joined, with their role.
    let memberships: Vec<(i64, String)> =
        sqlx::query_as("SELECT channel_id, role FROM channel_members WHERE user_id = $1")
            .bind(user_id as i64)
            .fetch_all(db)
            .await?;
    for (cid, role) in memberships {
        let key = format!("channel:{}:members", cid);
        let _: () = con.sadd(&key, user_id as i64).await?;
        roles.set_role(cid, user_id as i64, &role).await?;
        subscribers.subscribe(cid as u64, user_id);
    }

    // DM channels — both parties must be in the Redis set
    let dm_rows: Vec<(i64, i64, i64)> = sqlx::query_as(
        "SELECT channel_id, user_a, user_b FROM direct_messages WHERE user_a = $1 OR user_b = $1",
    )
    .bind(user_id as i64)
    .fetch_all(db)
    .await?;
    for (cid, a, b) in dm_rows {
        let key = format!("channel:{}:members", cid);
        let _: (i64, i64) = redis::pipe()
            .sadd(&key, a)
            .sadd(&key, b)
            .query_async(&mut con)
            .await?;
        // Subscribing the other party too is harmless — broadcast just
        // won't find a live sender for them until they connect.
        subscribers.subscribe(cid as u64, a as u64);
        subscribers.subscribe(cid as u64, b as u64);
    }

    Ok(())
}

fn broadcast_presence(user_id: u64, status: &str, state: &ServerState) {
    let name = state.user_pool.get_name(user_id);
    let Some(frame) = make_presence_frame(user_id, status, name.as_deref()) else {
        return;
    };
    let connections = state.connections.read().unwrap();
    for tx in connections.values() {
        let _ = tx.send(frame.clone());
    }
}

fn send_online_roster(new_user_id: u64, state: &ServerState) {
    let connections = state.connections.read().unwrap();
    let Some(new_tx) = connections.get(&new_user_id) else {
        return;
    };
    for &other_id in connections.keys() {
        if other_id == new_user_id {
            continue;
        }
        let name = state.user_pool.get_name(other_id);
        if let Some(frame) = make_presence_frame(other_id, "online", name.as_deref()) {
            let _ = new_tx.send(frame);
        }
    }
}

pub async fn handle_binary_message(
    data: &[u8],
    state: &ServerState,
    app_state: &AppState,
    user_id: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if data.len() > MAX_MESSAGE_SIZE {
        return Ok(());
    }

    // free_old must run even when parsing fails below — otherwise a bad
    // frame permanently strands its slot, and enough of those exhaust the
    // pool for everyone.
    let slot = match state.msg_pool.alloc(data.len()) {
        Some(s) => s,
        None => return Ok(()),
    };
    slot.copy_from_slice(data);
    let parsed = Message::parse(slot as &[u8]).and_then(|msg| {
        let text = msg.text()?.to_owned();
        Ok((msg.header.msg_type, msg.header.channel_id as u64, text))
    });
    state.msg_pool.free_old(1);
    let (msg_type, channel_id, text) = parsed?;

    let ts = now_unix();

    match msg_type {
        MessageType::TEXT => {
            if validate_message_text(&text).is_err() {
                return Ok(());
            }
            // 20 messages / 10s per user — the REST rate limiter only ever
            // covered per-IP login/register/join, nothing gated actual send volume.
            if check_rate_limit(&app_state.redis, &format!("msg:{}", user_id), 20, 10)
                .await
                .is_err()
            {
                return Ok(());
            }
            if !is_channel_member(user_id, channel_id, &app_state.redis).await {
                return Ok(());
            }
            let msg_id = crate::database::messages::insert_message(
                &app_state.db,
                channel_id,
                user_id,
                &text,
                ts,
            )
            .await?;
            // Broadcast frame: header + [8-byte msg_id u64 LE] + text bytes.
            // The msg_id prefix lets clients link live messages to their DB row
            // (needed for reactions, edits, and deletes).
            let text_bytes = text.as_bytes();
            let payload_len = 8 + text_bytes.len();
            let mut frame = vec![0u8; MessageHeader::SIZE + payload_len];
            MessageHeader {
                msg_type: MessageType::TEXT,
                user_id: user_id as u32,
                channel_id: channel_id as u32,
                timestamp: ts,
                text_len: payload_len as u16,
            }
            .to_bytes(&mut frame)?;
            frame[MessageHeader::SIZE..MessageHeader::SIZE + 8]
                .copy_from_slice(&msg_id.to_le_bytes());
            frame[MessageHeader::SIZE + 8..].copy_from_slice(text_bytes);
            broadcast_to_channel(&frame, channel_id, state, &app_state.subscribers);
        }

        MessageType::TYPING => {
            // Only broadcast typing to channels the user has joined.
            if !is_channel_member(user_id, channel_id, &app_state.redis).await {
                return Ok(());
            }
            let frame = sanitize_frame(data, user_id, ts);
            broadcast_to_channel(&frame, channel_id, state, &app_state.subscribers);
        }

        MessageType::CALL_SIGNAL => {
            if let Ok(sig_msg) = serde_json::from_str::<SignalingMessage>(&text) {
                match &sig_msg {
                    SignalingMessage::CallOffer { .. } | SignalingMessage::CallAnswer { .. } => {
                        state.user_pool.set_flag(user_id, UserFlags::IN_CALL);
                    }
                    SignalingMessage::CallHangup { .. } => {
                        state.user_pool.clear_flag(user_id, UserFlags::IN_CALL);
                    }
                    _ => {}
                }
                state
                    .signaling
                    .handle_message(sig_msg.with_from(user_id))
                    .await?;
            }
        }

        // Client sends PRESENCE to update their activity status / custom status text.
        // Format: "online" | "away" | "busy" | "do_not_disturb" | "availability|custom text"
        MessageType::PRESENCE => {
            let status = text.trim();
            if !status.is_empty() && status.len() <= 80 {
                broadcast_presence(user_id, status, state);
            }
        }

        MessageType::REACTION => {
            if !is_channel_member(user_id, channel_id, &app_state.redis).await {
                return Ok(());
            }
            #[derive(serde::Deserialize)]
            struct ReactionPayload {
                message_id: i64,
                emoji: String,
            }
            let Ok(payload) = serde_json::from_str::<ReactionPayload>(&text) else {
                return Ok(());
            };
            let Some((msg_id, action, count)) = crate::database::messages::toggle_reaction(
                &app_state.db,
                payload.message_id,
                channel_id as i64,
                user_id as i64,
                &payload.emoji,
            )
            .await?
            else {
                return Ok(());
            };
            let broadcast_text = serde_json::json!({
                "message_id": msg_id,
                "emoji":      payload.emoji,
                "action":     action,
                "user_id":    user_id,
                "count":      count,
            })
            .to_string();
            if let Some(frame) = make_typed_text_frame(
                MessageType::REACTION,
                user_id,
                channel_id as u32,
                ts,
                &broadcast_text,
            ) {
                broadcast_to_channel(&frame, channel_id, state, &app_state.subscribers);
            }
        }

        MessageType::EDIT => {
            #[derive(serde::Deserialize)]
            struct EditPayload {
                message_id: i64,
                text: String,
            }
            let Ok(payload) = serde_json::from_str::<EditPayload>(&text) else {
                return Ok(());
            };
            if validate_message_text(&payload.text).is_err() {
                return Ok(());
            }
            let Some(_) = crate::database::messages::edit_message(
                &app_state.db,
                payload.message_id,
                channel_id as i64,
                user_id as i64,
                &payload.text,
            )
            .await?
            else {
                return Ok(());
            };
            let broadcast_text = serde_json::json!({
                "message_id": payload.message_id,
                "text":       payload.text,
            })
            .to_string();
            if let Some(frame) = make_typed_text_frame(
                MessageType::EDIT,
                user_id,
                channel_id as u32,
                ts,
                &broadcast_text,
            ) {
                broadcast_to_channel(&frame, channel_id, state, &app_state.subscribers);
            }
        }

        MessageType::DELETE => {
            #[derive(serde::Deserialize)]
            struct DeletePayload {
                message_id: i64,
            }
            let Ok(payload) = serde_json::from_str::<DeletePayload>(&text) else {
                return Ok(());
            };
            let role = app_state
                .roles
                .get_role(channel_id as i64, user_id as i64)
                .await;
            let deleted = if role == "owner" || role == "moderator" {
                crate::database::messages::delete_message_as_moderator(
                    &app_state.db,
                    payload.message_id,
                    channel_id as i64,
                )
                .await?
            } else {
                crate::database::messages::delete_message(
                    &app_state.db,
                    payload.message_id,
                    channel_id as i64,
                    user_id as i64,
                )
                .await?
            };
            let Some(_) = deleted else {
                return Ok(());
            };
            let broadcast_text =
                serde_json::json!({ "message_id": payload.message_id }).to_string();
            if let Some(frame) = make_typed_text_frame(
                MessageType::DELETE,
                user_id,
                channel_id as u32,
                ts,
                &broadcast_text,
            ) {
                broadcast_to_channel(&frame, channel_id, state, &app_state.subscribers);
            }
        }

        _ => {}
    }

    Ok(())
}

async fn is_channel_member(user_id: u64, channel_id: u64, redis: &ConnectionManager) -> bool {
    let mut con = redis.clone();
    let key = format!("channel:{}:members", channel_id);
    con.sismember::<_, _, bool>(&key, user_id as i64)
        .await
        .unwrap_or(false)
}

// No more Redis round-trip per frame — Bytes::clone() is O(1) too, so no
// copy per recipient either.
fn broadcast_to_channel(
    data: &[u8],
    channel_id: u64,
    state: &ServerState,
    subscribers: &crate::memory::subscribers::ChannelSubscribers,
) {
    let member_ids = subscribers.members_of(channel_id);

    let shared = Bytes::copy_from_slice(data);
    let connections = state.connections.read().unwrap();
    for member_id in member_ids {
        if let Some(tx) = connections.get(&member_id) {
            let _ = tx.send(WsMessage::Binary(shared.clone()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::AppState;
    use crate::cache::presence::PresenceTracker;
    use crate::cache::roles::RoleCache;
    use crate::memory::message_pool::POOL_SIZE;
    use crate::protocol::message::MessageHeader;

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
            presence: PresenceTracker::new(redis.clone()),
            roles: RoleCache::new(redis),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
            http_client: crate::net::ssrf::build_http_client(),
        })
    }

    fn text_frame(user_id: u64, channel_id: u64, text: &str) -> Vec<u8> {
        let text_bytes = text.as_bytes();
        let mut buf = vec![0u8; MessageHeader::SIZE + text_bytes.len()];
        MessageHeader {
            msg_type: MessageType::TEXT,
            user_id: user_id as u32,
            channel_id: channel_id as u32,
            timestamp: 0,
            text_len: text_bytes.len() as u16,
        }
        .to_bytes(&mut buf)
        .unwrap();
        buf[MessageHeader::SIZE..].copy_from_slice(text_bytes);
        buf
    }

    /// A bad frame used to leak its pool slot forever. Enough of them and
    /// the pool's exhausted for everyone — a later good message would
    /// silently never get inserted.
    #[sqlx::test]
    async fn malformed_frames_dont_permanently_leak_the_message_pool(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let app_state = make_app_state(pool).await;
        let server_state = ServerState::new();
        let user_id: u64 = 1;

        sqlx::query(
            "INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')",
        )
        .execute(&app_state.db)
        .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&app_state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, 1)")
            .bind(channel_id)
            .execute(&app_state.db)
            .await?;
        let mut con = app_state.redis.clone();
        let _: () = redis::AsyncCommands::sadd(
            &mut con,
            format!("channel:{}:members", channel_id),
            user_id as i64,
        )
        .await
        .unwrap();

        // Too short to even contain a header — parse() fails every time.
        let too_short = vec![0u8; 3];
        for _ in 0..(POOL_SIZE + 100) {
            let _ = handle_binary_message(&too_short, &server_state, &app_state, user_id).await;
        }

        let frame = text_frame(user_id, channel_id as u64, "still works");
        handle_binary_message(&frame, &server_state, &app_state, user_id)
            .await
            .expect("a well-formed message must still be processed after pool pressure");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_one(&app_state.db)
            .await?;
        assert_eq!(
            count, 1,
            "the message must have actually been inserted, not silently dropped"
        );
        Ok(())
    }

    /// Fan-out went from a Redis SMEMBERS call to the in-memory index —
    /// confirm messages still actually reach other connected members.
    #[sqlx::test]
    async fn text_message_is_broadcast_to_other_subscribed_members(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let app_state = make_app_state(pool).await;
        let server_state = ServerState::new();
        let sender_id: u64 = 1;
        let recipient_id: u64 = 2;

        sqlx::query(
            "INSERT INTO users (id, username, email, password_hash) VALUES
             (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')",
        )
        .execute(&app_state.db)
        .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&app_state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, 1), ($1, 2)")
            .bind(channel_id)
            .execute(&app_state.db)
            .await?;

        let mut con = app_state.redis.clone();
        let key = format!("channel:{}:members", channel_id);
        let _: () = redis::AsyncCommands::sadd(&mut con, &key, sender_id as i64)
            .await
            .unwrap();
        let _: () = redis::AsyncCommands::sadd(&mut con, &key, recipient_id as i64)
            .await
            .unwrap();

        // Mirrors what seed_redis_membership does on WS connect for each party.
        app_state
            .subscribers
            .subscribe(channel_id as u64, sender_id);
        app_state
            .subscribers
            .subscribe(channel_id as u64, recipient_id);

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        server_state.add_connection(recipient_id, tx);

        let frame = text_frame(sender_id, channel_id as u64, "hello");
        handle_binary_message(&frame, &server_state, &app_state, sender_id)
            .await
            .expect("valid message should be processed");

        let received = rx
            .try_recv()
            .expect("recipient should have received the broadcast frame");
        assert!(matches!(received, WsMessage::Binary(_)));
        Ok(())
    }
}
