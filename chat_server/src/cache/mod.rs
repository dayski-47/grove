pub mod batch;
pub mod presence;

use redis::{AsyncCommands, Client, RedisError};

pub async fn connect_redis(redis_url: &str) -> Result<Client, RedisError> {
    let client = Client::open(redis_url)?;
    let mut con = client.get_connection_manager().await?;
    let _: () = con.ping().await?;
    Ok(client)
}
