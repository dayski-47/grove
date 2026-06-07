// src/api/server.rs

use axum::{routing::{get, post}, Router};
use std::sync::Arc;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use crate::api::AppState;
use super::messages::{get_history, join_channel, create_channel, get_user};
use super::auth::{register, login};

pub async fn run_rest_server(addr: &str, state: AppState) -> Result<(), Box<dyn std::error::Error + Send + Sync>>{
    let app = Router::new()
    .route("/api/auth/register", post(register))
    .route("/api/auth/login", post(login))
    .route("/api/messages/history", get(get_history))
    .route("/api/channels/join", post(join_channel))
    .route("/api/channels/create", post(create_channel))
    .route("/api/users/{id}", get(get_user))
    .layer(RequestBodyLimitLayer::new(1024 * 1024))
    .layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers([AUTHORIZATION, CONTENT_TYPE]),
    )
    .with_state(Arc::new(state));


    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("REST API listening on {}", addr);


    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())

}
