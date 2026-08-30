/// Browser origins allowed to hit the REST API or open a WS connection.
/// Comma-separated via `ALLOWED_ORIGINS`; falls back to the local Vite/Docker
/// dev origins when unset so `cargo run` keeps working with no extra setup.
pub fn allowed_origins() -> Vec<String> {
    match std::env::var("ALLOWED_ORIGINS") {
        Ok(val) => val
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Err(_) => vec![
            "http://localhost:5173".to_string(),
            "http://localhost".to_string(),
        ],
    }
}
