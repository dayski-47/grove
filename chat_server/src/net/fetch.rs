use crate::net::ssrf::{GetCheckedError, get_checked};
use bytes::Bytes;
use futures_util::StreamExt;

#[allow(dead_code)]
pub const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;

#[allow(dead_code)]
pub struct CappedFetch {
    pub body: Bytes,
    pub content_type: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub enum FetchError {
    Request(reqwest::Error),
    TooLarge,
    Blocked,
}

/// The only entry point production code should call. Gets the response via
/// Task 1's get_checked (the actual SSRF enforcement — see net::ssrf's
/// docs on why the raw client alone isn't safe to use here), then caps it.
#[allow(dead_code)]
pub async fn fetch_capped(
    client: &reqwest::Client,
    url: &str,
    max_bytes: usize,
) -> Result<CappedFetch, FetchError> {
    let resp = get_checked(client, url).await.map_err(|e| match e {
        GetCheckedError::InvalidUrl | GetCheckedError::Blocked => FetchError::Blocked,
        GetCheckedError::Request(err) => FetchError::Request(err),
    })?;
    cap_response(resp, max_bytes).await
}

/// The actual streaming/capping logic, operating on an already-obtained
/// Response — has no URL or safety check of its own, so tests can exercise
/// it directly against a loopback mock server's response without fighting
/// the SSRF check that fetch_capped always applies first.
#[allow(dead_code)]
async fn cap_response(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<CappedFetch, FetchError> {
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(FetchError::Request)?;
        buf.extend_from_slice(&chunk);
        if buf.len() > max_bytes {
            return Err(FetchError::TooLarge);
        }
    }

    Ok(CappedFetch {
        body: Bytes::from(buf),
        content_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_a_body_over_the_cap() {
        let app = axum::Router::new().route(
            "/huge",
            axum::routing::get(|| async {
                (
                    [("content-type", "text/html")],
                    vec![b'a'; 10 * 1024 * 1024],
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        // Gets a real Response directly (bypassing get_checked, which would
        // refuse a loopback target) — this test is purely about the
        // capping logic. SSRF policy is Task 1's job, already covered
        // there; fetch_capped's own test below covers the wiring.
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("http://{}/huge", addr))
            .send()
            .await
            .unwrap();
        let result = cap_response(resp, 2 * 1024 * 1024).await;
        assert!(matches!(result, Err(FetchError::TooLarge)));
    }

    #[tokio::test]
    async fn returns_body_and_content_type_for_a_small_response() {
        let app = axum::Router::new().route(
            "/small",
            axum::routing::get(|| async {
                ([("content-type", "text/html")], "<title>tiny</title>")
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::new();
        let resp = client
            .get(format!("http://{}/small", addr))
            .send()
            .await
            .unwrap();
        let result = cap_response(resp, 2 * 1024 * 1024).await.unwrap();
        assert_eq!(result.body.as_ref(), b"<title>tiny</title>");
        assert_eq!(result.content_type.as_deref(), Some("text/html"));
    }

    #[tokio::test]
    async fn fetch_capped_rejects_a_loopback_target_before_sending() {
        // The public entry point — unlike cap_response above, this must
        // refuse a loopback URL outright, via Task 1's get_checked (the
        // resolver never even runs for a literal IP, so this check is the
        // only thing standing between this call and a real connection).
        let client = reqwest::Client::new();
        let result = fetch_capped(&client, "http://127.0.0.1:1/nope", 2 * 1024 * 1024).await;
        assert!(matches!(result, Err(FetchError::Blocked)));
    }
}
