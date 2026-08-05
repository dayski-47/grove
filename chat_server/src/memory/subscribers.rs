use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

/// In-memory index of which connected/known users belong to which channels,
/// kept in sync with Redis's `channel:{id}:members` sets at every place that
/// mutates them. This exists purely so `broadcast_to_channel` can fan a
/// message out to its recipients without a Redis round-trip on every single
/// WS frame (previously a `SMEMBERS` call per TEXT/TYPING/REACTION/EDIT/
/// DELETE frame). It is not the authorization boundary — `is_channel_member`
/// still gates message processing straight against Redis — so a brief lag
/// here (a newly-kicked user's very last in-flight broadcast) only affects
/// fan-out, never who is allowed to read or send.
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
