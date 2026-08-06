use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

/// In-memory mirror of Redis's `channel:{id}:members` sets, so
/// `broadcast_to_channel` can fan out a message without a Redis round-trip
/// per frame. Fan-out only — `is_channel_member` still gates against Redis
/// directly, so staleness here never affects who can read or send.
#[derive(Clone)]
pub struct ChannelSubscribers {
    inner: Arc<RwLock<HashMap<u64, HashSet<u64>>>>,
}

impl ChannelSubscribers {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn subscribe(&self, channel_id: u64, user_id: u64) {
        self.inner
            .write()
            .unwrap()
            .entry(channel_id)
            .or_default()
            .insert(user_id);
    }

    pub fn unsubscribe(&self, channel_id: u64, user_id: u64) {
        let mut map = self.inner.write().unwrap();
        if let Some(set) = map.get_mut(&channel_id) {
            set.remove(&user_id);
            if set.is_empty() {
                map.remove(&channel_id);
            }
        }
    }

    /// Removes `user_id` from every channel — called on WS disconnect so a
    /// closed connection never lingers as a broadcast target.
    pub fn remove_user(&self, user_id: u64) {
        let mut map = self.inner.write().unwrap();
        map.retain(|_, set| {
            set.remove(&user_id);
            !set.is_empty()
        });
    }

    pub fn members_of(&self, channel_id: u64) -> Vec<u64> {
        self.inner
            .read()
            .unwrap()
            .get(&channel_id)
            .map(|set| set.iter().copied().collect())
            .unwrap_or_default()
    }
}
