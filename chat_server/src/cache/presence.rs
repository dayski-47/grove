use redis::{AsyncCommands, Client};

#[derive(Clone)]
pub struct PresenceTracker {
    client: Client,
}

impl PresenceTracker {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn mark_online(&self, user_id: u64) -> Result<(), redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let _: () = con
            .set_ex(format!("presence:{}", user_id), "online", 30u64)
            .await?;
        Ok(())
    }

    pub async fn mark_offline(&self, user_id: u64) -> Result<(), redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let _: () = con.del(format!("presence:{}", user_id)).await?;
        Ok(())
    }

    pub async fn is_online(&self, user_id: u64) -> Result<bool, redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        con.exists(format!("presence:{}", user_id)).await
    }

    pub async fn get_online_users(&self, channel_id: u64) -> Result<Vec<u64>, redis::RedisError> {
        let mut con = self.client.get_connection_manager().await?;
        let member_ids: Vec<u64> = con
            .smembers(format!("channel:{}:members", channel_id))
            .await?;
        let mut online = Vec::new();
        for uid in member_ids {
            if self.is_online(uid).await? {
                online.push(uid);
            }
        }
        Ok(online)
    }
}
