use crate::api::AppState;
use crate::api::validation::validate_message_text;
use crate::memory::message_pool::MAX_MESSAGE_SIZE;
use crate::memory::user_pool::User;
use crate::protocol::message::{Message, MessageHeader, MessageType};
use crate::signaling::types::SignalingMessage;
use crate::websocket::state::ServerState;
use futures_util::{SinkExt, StreamExt};
use redis::AsyncCommands;
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
        let msg = msg?;
        if msg.is_binary() {
            let data = msg.into_data();
            handle_binary_message(&data, &state, &app_state, user_id).await?;
        }
    }

    presence_task.abort();
    state.remove_connection(user_id);
    app_state.presence.mark_offline(user_id).await?;
    broadcast_presence(user_id, "offline", &state);
    Ok(())
}

fn now_unix() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32
}

// rewrite user_id (bytes 1-4) and timestamp (bytes 9-12) to prevent spoofing
fn sanitize_frame(data: &[u8], user_id: u64, timestamp: u32) -> Vec<u8> {
    let mut frame = data.to_vec();
    if frame.len() >= MessageHeader::SIZE {
        frame[1..5].copy_from_slice(&(user_id as u32).to_le_bytes());
        frame[9..13].copy_from_slice(&timestamp.to_le_bytes());
    }
    frame
}

fn make_presence_frame(user_id: u64, status: &str) -> Option<WsMessage> {
    let text_bytes = status.as_bytes();
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

fn broadcast_presence(user_id: u64, status: &str, state: &ServerState) {
    let Some(frame) = make_presence_frame(user_id, status) else {
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
        if let Some(frame) = make_presence_frame(other_id, "online") {
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

    let (msg_type, channel_id, text) = {
        let slot = match state.msg_pool.alloc(data.len()) {
            Some(s) => s,
            None => return Ok(()),
        };
        slot.copy_from_slice(data);
        let msg = Message::parse(slot as &[u8])?;
        (
            msg.header.msg_type,
            msg.header.channel_id as u64,
            msg.text()?.to_owned(),
        )
    };
    state.msg_pool.free_old(1);

    let ts = now_unix();

    match msg_type {
        MessageType::TEXT => {
            if validate_message_text(&text).is_err() {
                return Ok(());
            }
            let frame = sanitize_frame(data, user_id, ts);
            crate::database::messages::insert_message(
                &app_state.db,
                channel_id,
                user_id,
                &text,
                ts,
            )
            .await?;
            broadcast_to_channel(&frame, channel_id, state, &app_state.redis).await?;
        }

        MessageType::TYPING => {
            let frame = sanitize_frame(data, user_id, ts);
            broadcast_to_channel(&frame, channel_id, state, &app_state.redis).await?;
        }

        MessageType::CALL_SIGNAL => {
            if let Ok(sig_msg) = serde_json::from_str::<SignalingMessage>(&text) {
                // enforce from == authenticated user; ignore client-supplied from field
                state
                    .signaling
                    .handle_message(sig_msg.with_from(user_id))
                    .await?;
            }
        }

        _ => {}
    }

    Ok(())
}

async fn broadcast_to_channel(
    data: &[u8],
    channel_id: u64,
    state: &ServerState,
    redis: &redis::Client,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut con = redis.get_connection_manager().await?;
    let key = format!("channel:{}:members", channel_id);
    let member_ids: Vec<i64> = con.smembers(&key).await?;

    let shared = Arc::new(data.to_vec());
    let connections = state.connections.read().unwrap();
    for member_id in member_ids {
        if let Some(tx) = connections.get(&(member_id as u64)) {
            let _ = tx.send(WsMessage::Binary((*shared).clone().into()));
        }
    }
    Ok(())
}
