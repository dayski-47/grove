// src/signaling/handler.rs

use std::collections::HashMap;
use std::sync::RwLock;
use tokio::sync::mpsc;
use crate::signaling::types::SignalingMessage;

pub struct SignalingServer {
    connections: RwLock<HashMap<u64, mpsc::UnboundedSender<String>>>,
}

impl SignalingServer {
    pub async fn handle_message(&self, msg: SignalingMessage) -> Result<(), Box<dyn std::error::Error>> {

        match msg {
            SignalingMessage::CallOffer{ from, to, sdp } => {
                self.send_to_user(to, SignalingMessage::CallOffer { from, to, sdp }).await?;
            }
            SignalingMessage::CallAnswer { from, to, sdp } => {
                self.send_to_user(to, SignalingMessage::CallAnswer { from, to, sdp }).await?;
            }
            SignalingMessage::IceCandidate { from, to, candidate } => {
                self.send_to_user(to, SignalingMessage::IceCandidate { from, to, candidate }).await?;
            }
            SignalingMessage::CallHangup { from, to } => {
                self.send_to_user(to, SignalingMessage::CallHangup { from, to }).await?;
            }
        }

        Ok(())
    }

    async fn send_to_user(&self, user_id: u64, msg:SignalingMessage) -> Result<(), Box<dyn std::error::Error>> {
        let json = serde_json::to_string(&msg)?;
        let connections = self.connections.read().unwrap();
        if let Some(tx) = connections.get(&user_id) {
            tx.send(json)?;
        }


        Ok(())
    }
}