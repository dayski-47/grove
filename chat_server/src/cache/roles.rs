use redis::{AsyncCommands, aio::ConnectionManager};

#[derive(Clone)]
pub struct RoleCache {
    #[allow(dead_code)]
    conn: ConnectionManager,
}

#[allow(dead_code)]
impl RoleCache {
    pub fn new(conn: ConnectionManager) -> Self {
        Self { conn }
    }

    pub async fn set_role(
        &self,
        channel_id: i64,
        user_id: i64,
        role: &str,
    ) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        con.hset(format!("channel:{}:roles", channel_id), user_id, role)
            .await
    }

    /// Defaults to "member" on cache miss or Redis error — least-privilege
    /// fallback, matching this project's existing fail-closed security posture
    /// (see the JWT blocklist check in `api/mod.rs`).
    pub async fn get_role(&self, channel_id: i64, user_id: i64) -> String {
        let mut con = self.conn.clone();
        con.hget::<_, _, Option<String>>(format!("channel:{}:roles", channel_id), user_id)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "member".to_string())
    }

    pub async fn remove_role(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        let _: () = con
            .hdel(format!("channel:{}:roles", channel_id), user_id)
            .await?;
        Ok(())
    }
}
