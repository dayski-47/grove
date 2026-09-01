use sqlx::PgPool;

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
pub struct LinkPreviewRow {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
}

#[allow(dead_code)]
pub async fn get_fresh(
    pool: &PgPool,
    url_hash: &str,
) -> Result<Option<LinkPreviewRow>, sqlx::Error> {
    sqlx::query_as::<_, LinkPreviewRow>(
        "SELECT title, description, image_url FROM link_previews
         WHERE url_hash = $1 AND fetched_at > NOW() - INTERVAL '24 hours'",
    )
    .bind(url_hash)
    .fetch_optional(pool)
    .await
}

#[allow(dead_code)]
pub async fn upsert(
    pool: &PgPool,
    url_hash: &str,
    url: &str,
    title: Option<&str>,
    description: Option<&str>,
    image_url: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO link_previews (url_hash, url, title, description, image_url, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (url_hash) DO UPDATE SET
             url = EXCLUDED.url,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             image_url = EXCLUDED.image_url,
             fetched_at = EXCLUDED.fetched_at",
    )
    .bind(url_hash)
    .bind(url)
    .bind(title)
    .bind(description)
    .bind(image_url)
    .execute(pool)
    .await?;
    Ok(())
}

/// Unlike `get_fresh`, this doesn't gate on the 24h TTL — the image proxy
/// trusts any `image_url` that was ever legitimately unfurled, regardless
/// of whether the metadata itself has since gone stale.
#[allow(dead_code)]
pub async fn get_image_url(pool: &PgPool, url_hash: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT image_url FROM link_previews WHERE url_hash = $1")
        .bind(url_hash)
        .fetch_optional(pool)
        .await
        .map(|opt| opt.flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn upsert_then_get_fresh_round_trips(pool: sqlx::PgPool) -> sqlx::Result<()> {
        upsert(
            &pool,
            "hash1",
            "https://example.com",
            Some("Title"),
            Some("Desc"),
            Some("https://example.com/img.png"),
        )
        .await?;

        let row = get_fresh(&pool, "hash1")
            .await?
            .expect("row should exist and be fresh");
        assert_eq!(row.title, Some("Title".to_string()));
        assert_eq!(row.description, Some("Desc".to_string()));
        assert_eq!(
            row.image_url,
            Some("https://example.com/img.png".to_string())
        );
        Ok(())
    }

    #[sqlx::test]
    async fn get_fresh_returns_none_for_an_unknown_hash(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let row = get_fresh(&pool, "does-not-exist").await?;
        assert!(row.is_none());
        Ok(())
    }

    #[sqlx::test]
    async fn get_fresh_returns_none_for_a_stale_row(pool: sqlx::PgPool) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO link_previews (url_hash, url, title, fetched_at)
             VALUES ($1, $2, $3, NOW() - INTERVAL '25 hours')",
        )
        .bind("stale-hash")
        .bind("https://example.com")
        .bind("Old Title")
        .execute(&pool)
        .await?;

        let row = get_fresh(&pool, "stale-hash").await?;
        assert!(
            row.is_none(),
            "a row older than 24h must not be treated as fresh"
        );
        Ok(())
    }

    #[sqlx::test]
    async fn upsert_overwrites_an_existing_row(pool: sqlx::PgPool) -> sqlx::Result<()> {
        upsert(
            &pool,
            "hash1",
            "https://example.com",
            Some("Old"),
            None,
            None,
        )
        .await?;
        upsert(
            &pool,
            "hash1",
            "https://example.com",
            Some("New"),
            None,
            None,
        )
        .await?;

        let row = get_fresh(&pool, "hash1").await?.unwrap();
        assert_eq!(row.title, Some("New".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn get_image_url_ignores_staleness(pool: sqlx::PgPool) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO link_previews (url_hash, url, image_url, fetched_at)
             VALUES ($1, $2, $3, NOW() - INTERVAL '25 hours')",
        )
        .bind("stale-hash")
        .bind("https://example.com")
        .bind("https://example.com/img.png")
        .execute(&pool)
        .await?;

        // The image proxy trusts an already-vetted image_url regardless of
        // the metadata TTL — only get_fresh gates on staleness.
        let image_url = get_image_url(&pool, "stale-hash").await?;
        assert_eq!(image_url, Some("https://example.com/img.png".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn get_image_url_returns_none_for_an_unknown_hash(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let image_url = get_image_url(&pool, "does-not-exist").await?;
        assert!(image_url.is_none());
        Ok(())
    }
}
