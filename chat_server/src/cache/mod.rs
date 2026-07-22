pub mod batch;
pub mod presence;
pub mod roles;

use redis::{Client, RedisError, aio::ConnectionManager};

// Returns a ready ConnectionManager — callers clone it cheaply (Arc bump, not a new socket).
pub async fn connect_redis(redis_url: &str) -> Result<ConnectionManager, RedisError> {
    use redis::AsyncCommands;
    let client = Client::open(redis_url)?;
    let mut conn = client.get_connection_manager().await?;
    let _: () = conn.ping().await?;
    Ok(conn)
}
