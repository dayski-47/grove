#![allow(dead_code)]
use redis::{aio::ConnectionManager, pipe};

pub async fn batch_update_presence(
    conn: &ConnectionManager,
    user_ids: &[u64],
) -> Result<(), redis::RedisError> {
    let mut con = conn.clone();
    let mut pipeline = pipe();
    for &user_id in user_ids {
        pipeline.set_ex(format!("presence:{}", user_id), "online", 30u64);
    }
    let _: () = pipeline.query_async(&mut con).await?;
    Ok(())
}
