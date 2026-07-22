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
/// All three operations run inside a single transaction to prevent races between concurrent toggles.
pub async fn toggle_reaction(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
    user_id: i64,
    emoji: &str,
) -> Result<Option<(i64, &'static str, i64)>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&mut *tx)
    .await?;

    if exists.is_none() {
        return Ok(None);
    }

    let removed =
        sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3")
            .bind(message_id)
            .bind(user_id)
            .bind(emoji)
            .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await?;
        "add"
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM reactions WHERE message_id = $1 AND emoji = $2",
    )
    .bind(message_id)
    .bind(emoji)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

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

/// Soft-deletes a message regardless of author — for owner/moderator use only;
/// the caller is responsible for verifying the role before calling this.
/// Returns Some(channel_id) on success, None if the message doesn't exist
/// in this channel or is already deleted.
pub async fn delete_message_as_moderator(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let rows = sqlx::query(
        "UPDATE messages SET deleted_at = NOW(), text = ''
         WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(channel_id)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(if rows == 0 { None } else { Some(channel_id) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn inserts_and_reads_back_a_message(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;

        let msg_id = insert_message(&pool, channel_id as u64, user_id as u64, "hello", 1000)
            .await
            .expect("insert_message should succeed");

        let text: String = sqlx::query_scalar("SELECT text FROM messages WHERE id = $1")
            .bind(msg_id as i64)
            .fetch_one(&pool)
            .await?;
        assert_eq!(text, "hello");
        Ok(())
    }

    #[sqlx::test]
    async fn delete_message_as_moderator_removes_any_authors_message(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let author_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let msg_id = insert_message(&pool, channel_id as u64, author_id as u64, "hi", 1000)
            .await
            .unwrap();

        // A different user (the moderator) deletes it — delete_message (author-only)
        // would reject this; delete_message_as_moderator does not check authorship.
        let result = delete_message_as_moderator(&pool, msg_id as i64, channel_id).await?;
        assert!(result.is_some());

        let deleted: bool =
            sqlx::query_scalar("SELECT deleted_at IS NOT NULL FROM messages WHERE id = $1")
                .bind(msg_id as i64)
                .fetch_one(&pool)
                .await?;
        assert!(deleted);
        Ok(())
    }

    #[sqlx::test]
    async fn regular_delete_message_still_requires_authorship(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let author_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let other_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('bob', 'b@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let msg_id = insert_message(&pool, channel_id as u64, author_id as u64, "hi", 1000)
            .await
            .unwrap();

        let result = delete_message(&pool, msg_id as i64, channel_id, other_id).await?;
        assert!(
            result.is_none(),
            "non-author delete_message call must be rejected"
        );
        Ok(())
    }
}
