use crate::memory::message_pool::MessagePool;
use crate::memory::user_pool::{UserPool, UserStatus};
use crate::signaling::handler::SignalingServer;
use rustc_hash::FxHashMap;
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub type UserId = u64;

pub struct ServerState {
    pub connections: RwLock<FxHashMap<UserId, mpsc::UnboundedSender<WsMessage>>>,
    pub signaling: SignalingServer,
    pub user_pool: UserPool,
    pub msg_pool: Arc<MessagePool>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(FxHashMap::default()),
            signaling: SignalingServer::new(),
            user_pool: UserPool::new(),
            msg_pool: Arc::new(MessagePool::new()),
        }
    }

    pub fn add_connection(&self, user_id: UserId, tx: mpsc::UnboundedSender<WsMessage>) {
        self.signaling.register(user_id, tx.clone());
        self.connections.write().unwrap().insert(user_id, tx);
    }

    pub fn remove_connection(&self, user_id: UserId) {
        self.signaling.unregister(user_id);
        self.connections.write().unwrap().remove(&user_id);
        self.user_pool.set_status(user_id, UserStatus::OFFLINE);
        self.user_pool.remove(user_id);
    }
}
