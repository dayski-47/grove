mod api;
mod cache;
mod database;
mod memory;
mod protocol;
mod signaling;
mod websocket;

use mimalloc::MiMalloc;
use std::sync::Arc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL must be set");
    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");

    if jwt_secret.len() < 32 {
        eprintln!(
            "FATAL: JWT_SECRET must be at least 32 bytes (got {})",
            jwt_secret.len()
        );
        std::process::exit(1);
    }

    let db_pool = database::connect_db(&database_url).await?;
    // Single ConnectionManager shared across all subsystems — each clone is an Arc bump.
    let redis_conn = cache::connect_redis(&redis_url).await?;
    let presence = cache::presence::PresenceTracker::new(redis_conn.clone());
    let roles = cache::roles::RoleCache::new(redis_conn.clone());
    let subscribers = memory::subscribers::ChannelSubscribers::new();

    let app_state = api::AppState {
        db: db_pool,
        redis: redis_conn,
        jwt_secret,
        presence,
        roles,
        subscribers,
    };
    let app_state_ws = Arc::new(app_state.clone());

    let rest_handle =
        tokio::spawn(async move { api::server::run_rest_server("0.0.0.0:8080", app_state).await });

    let ws_handle = tokio::spawn(async move {
        websocket::server::run_websocket_server("0.0.0.0:8081", app_state_ws).await
    });

    println!("REST API:  http://0.0.0.0:8080");
    println!("WebSocket: ws://0.0.0.0:8081");

    match tokio::try_join!(rest_handle, ws_handle) {
        Ok(_) => {}
        Err(e) => eprintln!("Server error: {}", e),
    }

    Ok(())
}
