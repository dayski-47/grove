// src/cache/batch

use redis::{Client, pipe, AsyncCommands};

pub async fn batch_update_presence(client: &Client, user_ids: &[u64]) -> Result<(), redis::RedisError> {
    let mut con = client.get_connection_manager().await?;
    let mut pipeline = pipe();
    for &user_id in user_ids {
        let key = format!("presence:{}", user_id);
        pipeline.set_ex(&key, "online", 30);
    }
    let _: () = pipeline.query_async(&mut con).await?;
    Ok(())
}