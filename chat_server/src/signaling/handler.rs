// src/signaling/handler.rs
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
        match msg {
            SignalingMessage::CallOffer { from, to, sdp } => {
                self.send_to_user(to, SignalingMessage::CallOffer { from, to, sdp })
                    .await?;
            }
            SignalingMessage::CallAnswer { from, to, sdp } => {
                self.send_to_user(to, SignalingMessage::CallAnswer { from, to, sdp })
                    .await?;
            }
            SignalingMessage::IceCandidate {
                from,
                to,
                candidate,
            } => {
                self.send_to_user(
                    to,
                    SignalingMessage::IceCandidate {
                        from,
                        to,
                        candidate,
                    },
                )
                .await?;
            }
            SignalingMessage::CallHangup { from, to } => {
                self.send_to_user(to, SignalingMessage::CallHangup { from, to })
                    .await?;
            }
        }

        Ok(())
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
