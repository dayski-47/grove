use crate::signaling::types::SignalingMessage;
use std::collections::HashMap;
use std::sync::RwLock;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub struct SignalingServer {
    connections: RwLock<HashMap<u64, mpsc::UnboundedSender<WsMessage>>>,
}

impl SignalingServer {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    pub fn register(&self, user_id: u64, tx: mpsc::UnboundedSender<WsMessage>) {
        self.connections.write().unwrap().insert(user_id, tx);
    }

    pub fn unregister(&self, user_id: u64) {
        self.connections.write().unwrap().remove(&user_id);
    }

    pub async fn handle_message(
        &self,
        msg: SignalingMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let to = match &msg {
            SignalingMessage::CallOffer { to, .. } => *to,
            SignalingMessage::CallAnswer { to, .. } => *to,
            SignalingMessage::IceCandidate { to, .. } => *to,
            SignalingMessage::CallHangup { to, .. } => *to,
        };
        self.send_to_user(to, msg).await
    }

    async fn send_to_user(
        &self,
        user_id: u64,
        msg: SignalingMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let json = serde_json::to_string(&msg)?;
        let connections = self.connections.read().unwrap();
        if let Some(tx) = connections.get(&user_id) {
            let _ = tx.send(WsMessage::Text(json.into()));
        }
        Ok(())
    }
}
