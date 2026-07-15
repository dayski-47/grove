use crate::api::AppState;
use crate::api::auth::Claims;
use crate::api::ratelimit::check_rate_limit;
use crate::websocket::handler::handle_connection;
use crate::websocket::state::ServerState;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use redis::AsyncCommands;
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
            // 20 WS upgrades per IP per minute
            if check_rate_limit(&app_state.redis, &format!("ws:{}", peer_addr.ip()), 20, 60)
                .await
                .is_err()
            {
                return;
            }

            let user_id = Arc::new(std::sync::Mutex::new(None::<i64>));
            let user_exp = Arc::new(std::sync::Mutex::new(0usize));
            let uid_clone = Arc::clone(&user_id);
            let exp_clone = Arc::clone(&user_exp);
            let secret = app_state.jwt_secret.clone();

            #[allow(clippy::collapsible_if, clippy::result_large_err)]
            let ws_result = tokio_tungstenite::accept_hdr_async(
                stream,
                move |req: &Request, response: Response| {
                    let query = req.uri().query().unwrap_or("");
                    let token = query
                        .split('&')
                        .find(|p| p.starts_with("token="))
                        .and_then(|p| p.strip_prefix("token="));

                    if let Some(token) = token {
                        if let Ok(data) = decode::<Claims>(
                            token,
                            &DecodingKey::from_secret(secret.as_bytes()),
                            &Validation::new(Algorithm::HS256),
                        ) {
                            *uid_clone.lock().unwrap() = Some(data.claims.sub);
                            *exp_clone.lock().unwrap() = data.claims.exp;
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
                    let uid = match *user_id.lock().unwrap() {
                        Some(id) if id > 0 => id as u64,
                        _ => return,
                    };
                    let exp = *user_exp.lock().unwrap();

                    // Reject connections whose token has been logged out (blocklist).
                    let blocklist_key = format!("blocklist:{}:{}", uid, exp);
                    let blocked: bool = {
                        let mut con = app_state.redis.clone();
                        con.exists(&blocklist_key).await.unwrap_or(false)
                    };
                    if blocked {
                        drop(ws_stream);
                        return;
                    }

                    if let Err(e) =
                        handle_connection(ws_stream, server_state, Arc::clone(&app_state), uid)
                            .await
                    {
                        eprintln!("Connection error {}: {}", peer_addr, e);
                    }
                }
                Err(e) => eprintln!("WS handshake failed {}: {}", peer_addr, e),
            }
        });
    }
}
