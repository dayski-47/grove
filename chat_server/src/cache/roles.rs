use redis::{AsyncCommands, aio::ConnectionManager};

#[derive(Clone)]
pub struct RoleCache {
    conn: ConnectionManager,
    prefix: String,
}

impl RoleCache {
    pub fn new(conn: ConnectionManager) -> Self {
        Self {
            conn,
            prefix: String::new(),
        }
    }

    /// Gives this instance's Redis keys a unique namespace. Only meant for
    /// tests: every test connects to the same shared Redis instance (unlike
    /// `#[sqlx::test]`'s per-test isolated Postgres database), so without a
    /// per-test prefix, concurrently-running tests whose independent Postgres
    /// databases both happen to assign the same small `BIGSERIAL` channel id
    /// collide on the same `channel:<id>:roles` key.
    #[cfg(test)]
    pub fn with_prefix(conn: ConnectionManager, prefix: impl Into<String>) -> Self {
        Self {
            conn,
            prefix: prefix.into(),
        }
    }

    fn key(&self, channel_id: i64) -> String {
        format!("{}channel:{}:roles", self.prefix, channel_id)
    }

    pub async fn set_role(
        &self,
        channel_id: i64,
        user_id: i64,
        role: &str,
    ) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        con.hset(self.key(channel_id), user_id, role).await
    }

    /// Defaults to "member" on cache miss or Redis error — least-privilege
    /// fallback, matching this project's existing fail-closed security posture
    /// (see the JWT blocklist check in `api/mod.rs`).
    pub async fn get_role(&self, channel_id: i64, user_id: i64) -> String {
        let mut con = self.conn.clone();
        con.hget::<_, _, Option<String>>(self.key(channel_id), user_id)
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
        let _: () = con.hdel(self.key(channel_id), user_id).await?;
        Ok(())
    }
}
