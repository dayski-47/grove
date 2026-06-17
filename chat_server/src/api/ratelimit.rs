use axum::http::StatusCode;
use redis::aio::ConnectionManager;

pub async fn check_rate_limit(
    redis: &ConnectionManager,
    key: &str,
    limit: u32,
    window_secs: u64,
) -> Result<(), StatusCode> {
    let mut con = redis.clone();

    let bucket = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        / window_secs;

    let redis_key = format!("rl:{}:{}", key, bucket);

    // Atomic INCR + conditional EXPIRE via Lua — prevents immortal keys on crash.
    let count: u32 = redis::Script::new(
        "local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return n",
    )
    .key(&redis_key)
    .arg(window_secs)
    .invoke_async(&mut con)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if count > limit {
        Err(StatusCode::TOO_MANY_REQUESTS)
    } else {
        Ok(())
    }
}
