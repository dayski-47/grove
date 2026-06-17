// src/websocket/handler.rs

use crate::api::AppState;
use crate::api::validation::validate_message_text;
use crate::memory::message_pool::MAX_MESSAGE_SIZE;
use crate::memory::user_pool::User;
use crate::protocol::message::{Message, MessageType};
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

    // 1c: cache user profile in memory pool on connect
    let username = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(user_id as i64)
        .fetch_optional(&app_state.db)
        .await?;
    if let Some(name) = username {
        state.user_pool.insert(User::new(user_id, &name));
    }

    app_state.presence.mark_online(user_id).await?;
    println!("User {} connected", user_id);

    // Forward outbound messages to WebSocket
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Read incoming messages
    while let Some(msg) = read.next().await {
        let msg = msg?;
        if msg.is_binary() {
            let data = msg.into_data();
            handle_binary_message(&data, &state, &app_state, user_id).await?;
        }
    }

    // 1c: evict from user pool and signaling on disconnect
    state.remove_connection(user_id);
    app_state.presence.mark_offline(user_id).await?;
    println!("User {} disconnected", user_id);
    Ok(())
}

pub async fn handle_binary_message(
    data: &[u8],
    state: &ServerState,
    app_state: &AppState,
    user_id: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 1b: drop oversized frames before touching the pool
    if data.len() > MAX_MESSAGE_SIZE {
        return Ok(());
    }

    // Stage incoming bytes through message pool; extract owned values before any await
    let (msg_type, channel_id, timestamp, text) = {
        let slot = match state.msg_pool.alloc(data.len()) {
            Some(s) => s,
            None => return Ok(()), // pool full under load — drop
        };
        slot.copy_from_slice(data);
        let msg = Message::parse(slot as &[u8])?;
        (
            msg.header.msg_type,
            msg.header.channel_id as u64,
            msg.header.timestamp,
            msg.text()?.to_owned(),
        )
        // slot borrow ends here
    };
    state.msg_pool.free_old(1);

    // 1a: dispatch on the binary protocol msg_type byte
    match msg_type {
        MessageType::TEXT => {
            if validate_message_text(&text).is_err() {
                return Ok(());
            }
            crate::database::messages::insert_message(
                &app_state.db,
                channel_id,
                user_id,
                &text,
                timestamp,
            )
            .await?;
            broadcast_to_channel(data, channel_id, state, &app_state.redis).await?;
        }

        MessageType::TYPING => {
            broadcast_to_channel(data, channel_id, state, &app_state.redis).await?;
        }

        MessageType::CALL_SIGNAL => {
            // 1d: route through signaling for WebRTC call setup
            let sig_msg: SignalingMessage = serde_json::from_str(&text)?;
            state.signaling.handle_message(sig_msg).await?;
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
