// src/websocket/handler.rs

use crate::api::AppState;
use crate::api::validation::validate_message_text;
use crate::protocol::message::Message;
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

    // Mark user online in Redis
    // let mut con = app_state.redis.get_connection_manager().await?;
    // let presence_key = format!("presence:{}", user_id);
    // let _: () = con.set_ex(&presence_key, "online", 30).await?;
    app_state.presence.mark_online(user_id).await?;
    println!("User {} connected", user_id);

    // Forward messages from mpsc channel to WebSocket
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

    // Cleanup on disconnect
    state.connections.write().unwrap().remove(&user_id);
    // let mut cleanup_con = app_state.redis.get_connection_manager().await?;
    // let _: () = cleanup_con.del(&presence_key).await?;
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
    let msg = Message::parse(data)?;
    let text = msg.text()?;

    if validate_message_text(text).is_err() {
        return Ok(());
    }

    // Save to database
    crate::database::messages::insert_message(
        &app_state.db,
        msg.header.channel_id as u64,
        user_id,
        text,
        msg.header.timestamp,
    )
    .await?;

    // Get channel members from Redis
    let mut con = app_state.redis.get_connection_manager().await?;
    let key = format!("channel:{}:members", msg.header.channel_id);
    let member_ids: Vec<i64> = con.smembers(&key).await?;

    // Route to all connected recipients
    let shared_msg = Arc::new(data.to_vec());
    for member_id in member_ids {
        let connections = state.connections.read().unwrap();
        if let Some(tx) = connections.get(&(member_id as u64)) {
            let _ = tx.send(WsMessage::Binary((*shared_msg).clone().into()));
        }
    }
    Ok(())
}
