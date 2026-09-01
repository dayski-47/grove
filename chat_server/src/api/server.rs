use super::auth::{delete_account, login, logout, register};
use super::links::unfurl;
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, kick_member,
    list_channels, list_dms, list_friends, open_dm, pin_message, regenerate_invite_code,
    remove_friend, search_users, unpin_message, update_channel, update_member_role,
    update_my_profile,
};
use crate::api::AppState;
use axum::http::HeaderValue;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::{
    Router,
    routing::{get, post},
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

pub async fn run_rest_server(
    addr: &str,
    state: AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cors_origins: Vec<HeaderValue> = state
        .allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    let app = Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/account", axum::routing::delete(delete_account))
        .route("/api/messages/history", get(get_history))
        .route("/api/messages/reactions", get(get_channel_reactions))
        .route("/api/channels/join", post(join_channel))
        .route("/api/channels/join-by-code", post(join_by_code))
        .route("/api/channels/create", post(create_channel))
        .route("/api/channels/{id}", axum::routing::patch(update_channel))
        .route(
            "/api/channels/{id}/invite-code/regenerate",
            post(regenerate_invite_code),
        )
        .route("/api/channels/{id}/members", get(get_channel_members))
        .route(
            "/api/channels/{id}/members/{user_id}/role",
            post(update_member_role),
        )
        .route(
            "/api/channels/{id}/members/{user_id}",
            axum::routing::delete(kick_member),
        )
        .route("/api/users/{id}", get(get_user))
        .route("/api/users/search", get(search_users))
        .route("/api/users/me", axum::routing::put(update_my_profile))
        .route("/api/channels", get(list_channels))
        .route("/api/channels/online", get(get_channel_online))
        .route("/api/dm/open", post(open_dm))
        .route("/api/dm/list", get(list_dms))
        .route("/api/friends", get(list_friends))
        .route("/api/friends/add", post(add_friend))
        .route("/api/friends/remove", post(remove_friend))
        .route("/api/messages/pins", get(get_channel_pins))
        .route("/api/messages/pin", post(pin_message))
        .route("/api/messages/unpin", post(unpin_message))
        .route("/api/links/unfurl", post(unfurl))
        .layer(CompressionLayer::new())
        .layer(RequestBodyLimitLayer::new(1024 * 1024))
        .layer(
            CorsLayer::new()
                .allow_origin(cors_origins)
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
