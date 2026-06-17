#![allow(dead_code)]
use redis::{Client, pipe};

pub async fn batch_update_presence(
    client: &Client,
    user_ids: &[u64],
) -> Result<(), redis::RedisError> {
    let mut con = client.get_connection_manager().await?;
    let mut pipeline = pipe();
    for &user_id in user_ids {
        pipeline.set_ex(format!("presence:{}", user_id), "online", 30);
    }
    let _: () = pipeline.query_async(&mut con).await?;
    Ok(())
}
