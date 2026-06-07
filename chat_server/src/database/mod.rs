// src/database/mod.rs

pub mod messages;

use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn connect_db(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await?;

    println!("Running migrations...");
    sqlx::migrate!("./migrations").run(&pool).await?;
    println!("Migrations Complete");

    Ok(pool)
}
