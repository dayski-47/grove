// src/main.rs
mod api;
mod cache;
mod database;
mod memory;
mod protocol;
mod signaling;
mod websocket;

use std::sync::Arc;
// use api::server::create_router;
// use database::connect_db;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env file in development
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL must be set");

    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");

    let db_pool = database::connect_db(&database_url).await?;
    println!("Connected to PostgreSQL");

    let redis_client = cache::connect_redis(&redis_url).await?;
    println!("Connected to Redis");

    let app_state = api::AppState {
        db: db_pool,
        redis: redis_client,
        jwt_secret,
    };

    let app_state_ws = Arc::new(app_state.clone());

    let rest_handle =
        tokio::spawn(async move { api::server::run_rest_server("0.0.0.0:8080", app_state).await });

    let ws_handle = tokio::spawn(async move {
        websocket::server::run_websocket_server("0.0.0.0:8081", app_state_ws).await
    });

    println!("Grove is running!");
    println!("REST API:  http://0.0.0.0:8080");
    println!("WebSocket: ws://0.0.0.0:8081");

    match tokio::try_join!(rest_handle, ws_handle) {
        Ok(_) => {}
        Err(e) => eprintln!("Server error: {}", e),
    }

    Ok(())
}
