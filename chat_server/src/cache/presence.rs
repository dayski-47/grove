use redis::{AsyncCommands, aio::ConnectionManager, pipe};

#[derive(Clone)]
pub struct PresenceTracker {
    conn: ConnectionManager,
}

impl PresenceTracker {
    pub fn new(conn: ConnectionManager) -> Self {
        Self { conn }
    }

    pub async fn mark_online(&self, user_id: u64) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        con.set_ex(format!("presence:{}", user_id), "online", 30u64)
            .await
    }

    pub async fn mark_offline(&self, user_id: u64) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        let _: () = con.del(format!("presence:{}", user_id)).await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn is_online(&self, user_id: u64) -> Result<bool, redis::RedisError> {
        let mut con = self.conn.clone();
        con.exists(format!("presence:{}", user_id)).await
    }

    // Replaces N+1 roundtrips with 2: one SMEMBERS + one pipelined EXISTS batch.
    pub async fn get_online_users(&self, channel_id: u64) -> Result<Vec<u64>, redis::RedisError> {
        let mut con = self.conn.clone();
        let member_ids: Vec<u64> = con
            .smembers(format!("channel:{}:members", channel_id))
            .await?;
        if member_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut p = pipe();
        for id in &member_ids {
            p.exists(format!("presence:{}", id));
        }
        let alive: Vec<bool> = p.query_async(&mut con).await?;
        Ok(member_ids
            .into_iter()
            .zip(alive)
            .filter_map(|(id, online)| online.then_some(id))
            .collect())
    }
}
