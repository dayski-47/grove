// src/api/ratelimit.rs
use axum::http::StatusCode;
use redis::AsyncCommands;

pub async fn check_rate_limit(
    redis: &redis::Client,
    key: &str,
    limit: u32,
    window_secs: u64,
) -> Result<(), StatusCode> {
    let mut con = redis
        .get_connection_manager()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let redis_key = format!(
        "ratelimit:{}:{}",
        key,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            / window_secs
    );

    let count: u32 = con
        .incr(&redis_key, 1)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if count == 1 {
        let _: () = con
            .expire(&redis_key, window_secs as i64)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    if count > limit {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    Ok(())
}
