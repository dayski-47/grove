use super::auth::{login, register};
use super::messages::{
    add_friend, create_channel, get_channel_online, get_history, get_user, join_channel,
    list_channels, list_dms, list_friends, open_dm, remove_friend,
};
use crate::api::AppState;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::{
    Router,
    routing::{get, post},
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

pub async fn run_rest_server(
    addr: &str,
    state: AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/messages/history", get(get_history))
        .route("/api/channels/join", post(join_channel))
        .route("/api/channels/create", post(create_channel))
        .route("/api/users/{id}", get(get_user))
        .route("/api/channels", get(list_channels))
        .route("/api/channels/online", get(get_channel_online))
        .route("/api/dm/open", post(open_dm))
        .route("/api/dm/list", get(list_dms))
        .route("/api/friends", get(list_friends))
        .route("/api/friends/add", post(add_friend))
        .route("/api/friends/remove", post(remove_friend))
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
