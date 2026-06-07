// src/databse/messages.rs

use sqlx::PgPool;

pub async fn insert_message(
    pool: &PgPool,
    channel_id: u64,
    user_id: u64,
    text: &str,
    timestamp: u32,
) -> Result<u64, sqlx::Error> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO messages (channel_id, user_id, text, timestamp)
        VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(channel_id as i64)
    .bind(user_id as i64)
    .bind(text)
    .bind(timestamp as i32)
    .fetch_one(pool)
    .await?;

    Ok(id as u64)
}

// Ok(sqlx::query_scalar!("INSERT INTO messages (channel_id, user_id, text, timestamp)
//     VALUES ($1, $2, $3, $4) RETURNING id", channel_id as i64, user_id as i64, text, timestamp as i32)
//     .fetch_one(pool)
//     .await?)
