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

/// Toggles a reaction (add if absent, remove if present).
/// Returns `(message_id, action, new_count)` or None if the message doesn't exist in this channel.
pub async fn toggle_reaction(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
    user_id: i64,
    emoji: &str,
) -> Result<Option<(i64, &'static str, i64)>, sqlx::Error> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        return Ok(None);
    }

    let removed =
        sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3")
            .bind(message_id)
            .bind(user_id)
            .bind(emoji)
            .execute(pool)
            .await?
            .rows_affected();

    let action: &'static str = if removed > 0 {
        "remove"
    } else {
        sqlx::query(
            "INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(message_id)
        .bind(user_id)
        .bind(emoji)
        .execute(pool)
        .await?;
        "add"
    };

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM reactions WHERE message_id = $1 AND emoji = $2")
            .bind(message_id)
            .bind(emoji)
            .fetch_one(pool)
            .await?;

    Ok(Some((message_id, action, count)))
}

/// Edits a message's text. Returns Some(channel_id) on success, None if not found or not owner.
pub async fn edit_message(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
    user_id: i64,
    new_text: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let rows = sqlx::query(
        "UPDATE messages SET text = $1, edited_at = NOW()
         WHERE id = $2 AND channel_id = $3 AND user_id = $4 AND deleted_at IS NULL",
    )
    .bind(new_text)
    .bind(message_id)
    .bind(channel_id)
    .bind(user_id)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(if rows == 0 { None } else { Some(channel_id) })
}

/// Soft-deletes a message. Returns Some(channel_id) on success, None if not found or not owner.
pub async fn delete_message(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
    user_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let rows = sqlx::query(
        "UPDATE messages SET deleted_at = NOW(), text = ''
         WHERE id = $1 AND channel_id = $2 AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(user_id)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(if rows == 0 { None } else { Some(channel_id) })
}
