// src/websocket/server.rs

use crate::api::AppState;
use crate::api::auth::Claims;
use crate::websocket::handler::handle_connection;
use crate::websocket::state::ServerState;
use jsonwebtoken::{DecodingKey, Validation, decode};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

pub async fn run_websocket_server(
    addr: &str,
    app_state: Arc<AppState>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(addr).await?;
    let server_state = Arc::new(ServerState::new());

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let server_state = Arc::clone(&server_state);
        let app_state = Arc::clone(&app_state);

        tokio::spawn(async move {
            let user_id = Arc::new(std::sync::Mutex::new(None::<i64>));
            let user_id_clone = Arc::clone(&user_id);
            let secret = app_state.jwt_secret.clone();

            #[allow(clippy::collapsible_if, clippy::result_large_err)]
            let ws_result = tokio_tungstenite::accept_hdr_async(
                stream,
                move |req: &Request, response: Response| {
                    println!("WS handshake URI: {}", req.uri());
                    println!("WS query: {:?}", req.uri().query());

                    let query = req.uri().query().unwrap_or("");
                    let token = query
                        .split('&')
                        .find(|p| p.starts_with("token="))
                        .and_then(|p| p.strip_prefix("token="));

                    if let Some(token) = token {
                        if let Ok(data) = decode::<Claims>(
                            token,
                            &DecodingKey::from_secret(secret.as_bytes()),
                            &Validation::default(),
                        ) {
                            *user_id_clone.lock().unwrap() = Some(data.claims.sub);
                            return Ok(response);
                        }
                    }

                    Err(tokio_tungstenite::tungstenite::http::Response::builder()
                        .status(401)
                        .body(Some("Unauthorized".to_string()))
                        .unwrap())
                },
            )
            .await;

            match ws_result {
                Ok(ws_stream) => {
                    let uid = user_id.lock().unwrap().unwrap_or(0) as u64;
                    #[allow(clippy::collapsible_if)]
                    if uid > 0 {
                        if let Err(e) =
                            handle_connection(ws_stream, server_state, Arc::clone(&app_state), uid)
                                .await
                        {
                            eprintln!("Connection error {}: {}", peer_addr, e);
                        }
                    }
                }
                Err(e) => eprintln!("WebSocket handshake failed {}: {}", peer_addr, e),
            }
        });
    }
}
