// src/websocket/state.rs

use std::collections::HashMap;
use std::sync::RwLock;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub type UserId = u64;
pub type ChannelId = u64;

pub struct ServerState {
    pub connections: RwLock<HashMap<UserId, mpsc::UnboundedSender<WsMessage>>>,
    pub channels: RwLock<HashMap<ChannelId, Vec<UserId>>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            channels: RwLock::new(HashMap::new()), 
        }
    }

    pub fn add_connection(&self, user_id: UserId, tx: mpsc::UnboundedSender<WsMessage>) {
        self.connections.write().unwrap().insert(user_id, tx); 
    }

    pub fn get_channel_members(&self, channel_id: ChannelId) -> Vec<UserId> {
        self.channels.read().unwrap().get(&channel_id).cloned().unwrap_or_default()

        
    }

}