// src/cache/presence.rs

use redis::{AsyncCommands, Client};

pub struct PresenceTracker {
    client: Client,
}

impl PresenceTracker {
    pub async fn mark_online(&self, user_id: u64) -> Result<(), redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let key = format!("presence:{}", user_id);
        let _: () = con.set_ex(&key, "online", 30).await?;
        Ok(())
    }
    pub async fn is_online(&self, user_id: u64) -> Result<bool, redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let key = format!("presence:{}", user_id);
        let exists = con.exists(&key).await?;
        Ok(exists)
    }
    pub async fn get_online_users(&self, channel_id: u64) -> Result<Vec<u64>, redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let key = format!("channel:{}:members", channel_id);
        let member_ids: Vec<u64> = con.smembers(&key).await?;
        let mut online = Vec::new();
        for user_id in member_ids {
            if self.is_online(user_id).await? {
                online.push(user_id);
            }
        }

        Ok(online)
    }
}
