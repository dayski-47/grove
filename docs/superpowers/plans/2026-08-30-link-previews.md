# Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unfurl the first URL in a message into a preview card (title/description/image), fetched and image-proxied entirely server-side so the viewer's browser never talks to a third-party host directly.

**Architecture:** Two new JWT-auth'd REST endpoints (`POST /api/links/unfurl`, `GET /api/links/image-proxy`) backed by a Postgres cache table and a shared `reqwest::Client` whose DNS resolution is intercepted to reject private/internal/reserved IP ranges on every connection it makes, including redirects. Frontend extracts the first URL from a message, lazily fetches its preview once the message scrolls into view, and renders a dismissible card.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL backend (existing), `reqwest` + `scraper` + `sha2` (new deps), React/TypeScript frontend (existing).

**Spec:** `docs/superpowers/specs/2026-08-30-link-previews-design.md`

## Global Constraints

- One preview card per message — extract and unfurl the *first* URL only, never more.
- No server-side image storage — the image proxy is a pure streaming passthrough, re-fetched from source on every cache-miss request.
- Every outbound fetch (unfurl and image-proxy alike) goes through the same SSRF-safe client — never `reqwest::Client::new()` directly against an attacker-influenced URL.
- Any unfurl failure, for any reason (blocked, timeout, non-HTML, no metadata), returns the same `{ "available": false }` shape — never a distinguishable error. This is the same anti-oracle pattern `join_by_code` already uses for invite codes.
- 24h cache TTL (`link_previews.fetched_at`), keyed by SHA-256 hash of the URL string.
- Rate limits reuse the existing `check_rate_limit` Lua limiter — `unfurl:{user_id}` 30/60s, `imgproxy:{user_id}` 60/60s.
- Response body reads are capped at 2MB (`MAX_FETCH_BYTES`) for both endpoints — never buffer an unbounded stream.
- **Deviation from the spec's exact wording, found during planning:** the spec described SSRF IP-pinning via `reqwest`'s `.resolve()` override — that API pins a *fixed* hostname at client-build time and doesn't fit fetching arbitrary, per-request URLs. The actual mechanism (Task 1) is a custom `reqwest::dns::Resolve` implementation that filters every DNS answer to public IPs only, installed once on the shared client — this protects the initial connection *and* every redirect hop automatically, since redirects re-resolve through the same resolver. No separate redirect-time IP check is needed.
- **Also found during planning:** `<img>` tags can't carry a custom `Authorization` header, so the image-proxy endpoint needs a `?token=` query-string fallback for auth — Task 5 extends the shared `AuthenticatedUser` extractor with this, mirroring the exact pattern `websocket/server.rs` already uses for the WS upgrade handshake (browsers can't set custom headers on a `WebSocket` connect either).

---

### Task 1: SSRF-safe HTTP client (`net::ssrf`)

**Files:**
- Create: `chat_server/src/net/mod.rs`
- Create: `chat_server/src/net/ssrf.rs`
- Modify: `chat_server/Cargo.toml`

**Interfaces:**
- Produces: `pub fn is_public_ip(ip: std::net::IpAddr) -> bool`, `pub struct SsrfSafeResolver`, `pub fn build_http_client() -> reqwest::Client`
- Consumes: nothing new

- [ ] **Step 1: Add the `reqwest` dependency**

In `chat_server/Cargo.toml`, add under `[dependencies]`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
```

This pulls in `ring` as reqwest's TLS crypto backend, separate from the `aws_lc_rs` provider `main.rs` already installs process-wide for the WS server's TLS — the two coexist without conflict since neither calls `rustls::crypto::CryptoProvider::install_default()` a second time; reqwest builds its own `ClientConfig` with its own provider internally.

- [ ] **Step 2: Write the module skeleton**

`chat_server/src/net/mod.rs`:

```rust
pub mod ssrf;
```

- [ ] **Step 3: Write the failing test for `is_public_ip`**

`chat_server/src/net/ssrf.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_and_private_and_link_local_ranges() {
        for ip in [
            "127.0.0.1", "127.5.5.5", "10.0.0.5", "172.16.0.1", "172.31.255.255",
            "192.168.1.1", "169.254.169.254", "169.254.1.1", "100.64.0.1",
            "100.127.255.255", "224.0.0.1", "255.255.255.255", "0.0.0.0",
            "192.0.2.1", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
            "::", "::ffff:10.0.0.5", "::ffff:127.0.0.1",
        ] {
            let addr: std::net::IpAddr = ip.parse().unwrap();
            assert!(!is_public_ip(addr), "{ip} should be blocked");
        }
    }

    #[test]
    fn allows_real_public_addresses() {
        for ip in [
            "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.32.0.1",
            "2606:4700:4700::1111", "::ffff:8.8.8.8",
        ] {
            let addr: std::net::IpAddr = ip.parse().unwrap();
            assert!(is_public_ip(addr), "{ip} should be allowed");
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cargo test net::ssrf -- --nocapture`
Expected: FAIL — `is_public_ip` not defined yet.

- [ ] **Step 5: Implement `is_public_ip`, `SsrfSafeResolver`, and `build_http_client`**

Add above the `#[cfg(test)]` block in `chat_server/src/net/ssrf.rs`:

```rust
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

/// Rejects loopback, RFC1918, link-local (incl. `169.254.169.254`, the cloud
/// metadata address), CGNAT, multicast, and IPv6 equivalents — the ranges an
/// SSRF-vulnerable fetch could be redirected into on an internal network.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => is_public_ipv6(v6),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
    {
        return false;
    }
    // CGNAT, 100.64.0.0/10 — no stable std helper covers this range.
    let o = ip.octets();
    if o[0] == 100 && (o[1] & 0b1100_0000) == 0b0100_0000 {
        return false;
    }
    true
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
        return false;
    }
    let seg = ip.segments();
    if (seg[0] & 0xfe00) == 0xfc00 {
        return false; // unique local fc00::/7
    }
    if (seg[0] & 0xffc0) == 0xfe80 {
        return false; // link-local fe80::/10
    }
    true
}

/// A DNS resolver that filters every answer to public IPs only. Installed as
/// the client's *only* resolution path — reqwest connects to exactly what
/// this returns, so there's no gap between "checked" and "connected" for a
/// DNS-rebinding attack to exploit, and every redirect hop re-resolves
/// through this same filter automatically.
#[derive(Clone)]
pub struct SsrfSafeResolver;

impl Resolve for SsrfSafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let filtered: Vec<SocketAddr> = addrs.filter(|a| is_public_ip(a.ip())).collect();
            let iter: Addrs = Box::new(filtered.into_iter());
            Ok(iter)
        })
    }
}

/// Shared client for link unfurling and image proxying. Build once at
/// startup and clone (cheap — internally `Arc`-backed) into `AppState`.
pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(SsrfSafeResolver))
        .redirect(reqwest::redirect::Policy::limited(3))
        .timeout(Duration::from_secs(5))
        .user_agent("Grove/1.0")
        .build()
        .expect("failed to build SSRF-safe http client")
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test net::ssrf -- --nocapture`
Expected: PASS (both tests)

- [ ] **Step 7: Add an integration test — the resolver actually blocks a live loopback fetch**

Append to the `#[cfg(test)] mod tests` block (needs `#[tokio::test]`, and `axum` is already a dependency for the throwaway local server):

```rust
    #[tokio::test]
    async fn ssrf_safe_client_refuses_to_fetch_loopback() {
        let app = axum::Router::new()
            .route("/", axum::routing::get(|| async { "should never be reached" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });

        let client = build_http_client();
        let result = client.get(format!("http://{}/", addr)).send().await;
        assert!(result.is_err(), "fetching a loopback address must be blocked");
    }
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cargo test net::ssrf::tests::ssrf_safe_client_refuses_to_fetch_loopback -- --nocapture`
Expected: PASS

- [ ] **Step 9: Wire the module into the crate**

In `chat_server/src/main.rs`, add `mod net;` alongside the other `mod` declarations.

- [ ] **Step 10: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add Cargo.toml Cargo.lock src/main.rs src/net/mod.rs src/net/ssrf.rs
git commit -m "feat: ssrf-safe http client for outbound link fetches"
```

---

### Task 2: Capped streaming fetch (`net::fetch`)

**Files:**
- Create: `chat_server/src/net/fetch.rs`
- Modify: `chat_server/src/net/mod.rs`
- Modify: `chat_server/Cargo.toml`

**Interfaces:**
- Consumes: nothing from Task 1 directly (this helper takes any `&reqwest::Client`; production call sites pass the SSRF-safe one from Task 1)
- Produces: `pub const MAX_FETCH_BYTES: usize`, `pub struct CappedFetch { pub body: bytes::Bytes, pub content_type: Option<String> }`, `pub async fn fetch_capped(client: &reqwest::Client, url: &str, max_bytes: usize) -> Result<CappedFetch, FetchError>`

- [ ] **Step 1: Add `futures-util`'s stream extension (already a dependency) and write the failing test**

`futures-util` is already in `chat_server/Cargo.toml` (used by `websocket/handler.rs`) — no new dependency needed here.

`chat_server/src/net/fetch.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_a_body_over_the_cap() {
        let app = axum::Router::new().route(
            "/huge",
            axum::routing::get(|| async {
                ([("content-type", "text/html")], vec![b'a'; 10 * 1024 * 1024])
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });

        // Plain client here — this test is about the capping logic, not SSRF
        // policy (that's covered on its own in net::ssrf).
        let client = reqwest::Client::new();
        let result = fetch_capped(&client, &format!("http://{}/huge", addr), 2 * 1024 * 1024).await;
        assert!(matches!(result, Err(FetchError::TooLarge)));
    }

    #[tokio::test]
    async fn returns_body_and_content_type_for_a_small_response() {
        let app = axum::Router::new().route(
            "/small",
            axum::routing::get(|| async { ([("content-type", "text/html")], "<title>tiny</title>") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });

        let client = reqwest::Client::new();
        let result = fetch_capped(&client, &format!("http://{}/small", addr), 2 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(result.body.as_ref(), b"<title>tiny</title>");
        assert_eq!(result.content_type.as_deref(), Some("text/html"));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test net::fetch -- --nocapture`
Expected: FAIL — nothing defined yet.

- [ ] **Step 3: Implement `fetch_capped`**

Add above the test module:

```rust
use bytes::Bytes;
use futures_util::StreamExt;

pub const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;

pub struct CappedFetch {
    pub body: Bytes,
    pub content_type: Option<String>,
}

#[derive(Debug)]
pub enum FetchError {
    Request(reqwest::Error),
    TooLarge,
}

impl From<reqwest::Error> for FetchError {
    fn from(e: reqwest::Error) -> Self {
        FetchError::Request(e)
    }
}

pub async fn fetch_capped(
    client: &reqwest::Client,
    url: &str,
    max_bytes: usize,
) -> Result<CappedFetch, FetchError> {
    let resp = client.get(url).send().await?;
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.extend_from_slice(&chunk);
        if buf.len() > max_bytes {
            return Err(FetchError::TooLarge);
        }
    }

    Ok(CappedFetch { body: Bytes::from(buf), content_type })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test net::fetch -- --nocapture`
Expected: PASS (both tests)

- [ ] **Step 5: Register the module**

In `chat_server/src/net/mod.rs`:

```rust
pub mod fetch;
pub mod ssrf;
```

- [ ] **Step 6: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add src/net/mod.rs src/net/fetch.rs
git commit -m "feat: capped streaming fetch helper"
```

---

### Task 3: HTML metadata parser (`links::preview`)

**Files:**
- Create: `chat_server/src/links/mod.rs`
- Create: `chat_server/src/links/preview.rs`
- Modify: `chat_server/Cargo.toml`

**Interfaces:**
- Consumes: nothing new
- Produces: `pub struct ParsedPreview { pub title: Option<String>, pub description: Option<String>, pub image_url: Option<String> }` (derives `Debug, Default, PartialEq`), `pub fn parse_preview_html(html: &str) -> ParsedPreview`

- [ ] **Step 1: Add the `scraper` dependency**

In `chat_server/Cargo.toml`:

```toml
scraper = "0.20"
```

- [ ] **Step 2: Write the failing tests**

`chat_server/src/links/preview.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_title_and_prefers_og_description_over_meta_description() {
        let html = r#"
        <html><head>
            <title>  Example Page Title  </title>
            <meta name="description" content="fallback description">
            <meta property="og:description" content="OG description wins">
            <meta property="og:image" content="https://example.com/img.png">
        </head><body></body></html>
        "#;
        assert_eq!(
            parse_preview_html(html),
            ParsedPreview {
                title: Some("Example Page Title".to_string()),
                description: Some("OG description wins".to_string()),
                image_url: Some("https://example.com/img.png".to_string()),
            }
        );
    }

    #[test]
    fn falls_back_to_meta_description_without_og_tags() {
        let html = r#"<html><head><title>T</title><meta name="description" content="fallback"></head></html>"#;
        let result = parse_preview_html(html);
        assert_eq!(result.description, Some("fallback".to_string()));
    }

    #[test]
    fn handles_a_page_with_only_a_title() {
        let html = r#"<html><head><title>Just A Title</title></head></html>"#;
        assert_eq!(
            parse_preview_html(html),
            ParsedPreview {
                title: Some("Just A Title".to_string()),
                description: None,
                image_url: None,
            }
        );
    }

    #[test]
    fn returns_all_none_for_a_page_with_no_metadata() {
        let html = r#"<html><body><p>no head metadata</p></body></html>"#;
        assert_eq!(parse_preview_html(html), ParsedPreview::default());
    }

    #[test]
    fn treats_a_blank_title_as_no_title() {
        let html = r#"<html><head><title>   </title></head></html>"#;
        assert_eq!(parse_preview_html(html), ParsedPreview::default());
    }

    #[test]
    fn does_not_panic_on_malformed_html() {
        let html = r#"<title>Unterminated <meta property="og:image" content="https://x.com/a.png"#;
        // html5ever is a tolerant parser — this must not panic, whatever it extracts.
        let _ = parse_preview_html(html);
    }

    #[test]
    fn truncates_an_absurdly_long_title() {
        let long_title = "a".repeat(1000);
        let html = format!("<html><head><title>{long_title}</title></head></html>");
        let result = parse_preview_html(&html);
        assert!(result.title.unwrap().chars().count() <= 300);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test links::preview -- --nocapture`
Expected: FAIL — `parse_preview_html` not defined.

- [ ] **Step 4: Implement `parse_preview_html`**

Add above the test module:

```rust
use scraper::{Html, Selector};

const TITLE_MAX_CHARS: usize = 300;
const DESCRIPTION_MAX_CHARS: usize = 500;

#[derive(Debug, Default, PartialEq)]
pub struct ParsedPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
}

/// Static parse only — no JS execution, matching how Slack/Discord's own
/// unfurlers work. Untrusted external content, so every extracted field is
/// length-capped before it ever reaches the database or a response body.
pub fn parse_preview_html(html: &str) -> ParsedPreview {
    let doc = Html::parse_document(html);

    let title_sel = Selector::parse("title").unwrap();
    let title = doc
        .select(&title_sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| truncate_chars(&s, TITLE_MAX_CHARS));

    let og_desc_sel = Selector::parse(r#"meta[property="og:description"]"#).unwrap();
    let desc_sel = Selector::parse(r#"meta[name="description"]"#).unwrap();
    let description = doc
        .select(&og_desc_sel)
        .next()
        .or_else(|| doc.select(&desc_sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| truncate_chars(&s, DESCRIPTION_MAX_CHARS));

    let og_image_sel = Selector::parse(r#"meta[property="og:image"]"#).unwrap();
    let image_url = doc
        .select(&og_image_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    ParsedPreview { title, description, image_url }
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test links::preview -- --nocapture`
Expected: PASS (all 7 tests)

- [ ] **Step 6: Register the module**

`chat_server/src/links/mod.rs`:

```rust
pub mod preview;
```

In `chat_server/src/main.rs`, add `mod links;` alongside `mod net;`.

- [ ] **Step 7: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add Cargo.toml Cargo.lock src/main.rs src/links/mod.rs src/links/preview.rs
git commit -m "feat: html metadata parser for link previews"
```

---

### Task 4: `link_previews` cache table (`database::link_previews`)

**Files:**
- Create: `chat_server/migrations/012_link_previews.sql`
- Create: `chat_server/src/database/link_previews.rs`
- Modify: `chat_server/src/database/mod.rs` (if it exists as an explicit re-export list — check first; if `database` is declared inline in `main.rs`/`lib.rs` via `mod database { pub mod messages; ... }`, add `pub mod link_previews;` there instead)

**Interfaces:**
- Consumes: nothing new
- Produces: `#[derive(sqlx::FromRow)] pub struct LinkPreviewRow { pub title: Option<String>, pub description: Option<String>, pub image_url: Option<String> }`, `pub async fn get_fresh(pool: &PgPool, url_hash: &str) -> Result<Option<LinkPreviewRow>, sqlx::Error>`, `pub async fn upsert(pool: &PgPool, url_hash: &str, url: &str, title: Option<&str>, description: Option<&str>, image_url: Option<&str>) -> Result<(), sqlx::Error>`, `pub async fn get_image_url(pool: &PgPool, url_hash: &str) -> Result<Option<String>, sqlx::Error>`

- [ ] **Step 1: Write the migration**

`chat_server/migrations/012_link_previews.sql`:

```sql
-- Link preview cache. Global, not per-user — a URL's metadata doesn't
-- depend on who's asking, so the first person anywhere to hit a link
-- is the only one who ever pays the fetch cost within the TTL window.
CREATE TABLE link_previews (
    url_hash    CHAR(64) PRIMARY KEY,
    url         TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    image_url   TEXT,
    fetched_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Write the failing tests**

`chat_server/src/database/link_previews.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn upsert_then_get_fresh_round_trips(pool: sqlx::PgPool) -> sqlx::Result<()> {
        upsert(
            &pool, "hash1", "https://example.com",
            Some("Title"), Some("Desc"), Some("https://example.com/img.png"),
        ).await?;

        let row = get_fresh(&pool, "hash1").await?.expect("row should exist and be fresh");
        assert_eq!(row.title, Some("Title".to_string()));
        assert_eq!(row.description, Some("Desc".to_string()));
        assert_eq!(row.image_url, Some("https://example.com/img.png".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn get_fresh_returns_none_for_an_unknown_hash(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let row = get_fresh(&pool, "does-not-exist").await?;
        assert!(row.is_none());
        Ok(())
    }

    #[sqlx::test]
    async fn get_fresh_returns_none_for_a_stale_row(pool: sqlx::PgPool) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO link_previews (url_hash, url, title, fetched_at)
             VALUES ($1, $2, $3, NOW() - INTERVAL '25 hours')",
        )
        .bind("stale-hash")
        .bind("https://example.com")
        .bind("Old Title")
        .execute(&pool)
        .await?;

        let row = get_fresh(&pool, "stale-hash").await?;
        assert!(row.is_none(), "a row older than 24h must not be treated as fresh");
        Ok(())
    }

    #[sqlx::test]
    async fn upsert_overwrites_an_existing_row(pool: sqlx::PgPool) -> sqlx::Result<()> {
        upsert(&pool, "hash1", "https://example.com", Some("Old"), None, None).await?;
        upsert(&pool, "hash1", "https://example.com", Some("New"), None, None).await?;

        let row = get_fresh(&pool, "hash1").await?.unwrap();
        assert_eq!(row.title, Some("New".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn get_image_url_ignores_staleness(pool: sqlx::PgPool) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO link_previews (url_hash, url, image_url, fetched_at)
             VALUES ($1, $2, $3, NOW() - INTERVAL '25 hours')",
        )
        .bind("stale-hash")
        .bind("https://example.com")
        .bind("https://example.com/img.png")
        .execute(&pool)
        .await?;

        // The image proxy trusts an already-vetted image_url regardless of
        // the metadata TTL — only get_fresh gates on staleness.
        let image_url = get_image_url(&pool, "stale-hash").await?;
        assert_eq!(image_url, Some("https://example.com/img.png".to_string()));
        Ok(())
    }

    #[sqlx::test]
    async fn get_image_url_returns_none_for_an_unknown_hash(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let image_url = get_image_url(&pool, "does-not-exist").await?;
        assert!(image_url.is_none());
        Ok(())
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test database::link_previews -- --nocapture`
Expected: FAIL — nothing defined yet (needs `DATABASE_URL`/`REDIS_URL` reachable per this project's test setup, e.g. `docker compose -f docker-compose.prod.yml up -d db redis` first if not already running).

- [ ] **Step 4: Implement the module**

Add above the test module:

```rust
use sqlx::PgPool;

#[derive(sqlx::FromRow)]
pub struct LinkPreviewRow {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
}

pub async fn get_fresh(pool: &PgPool, url_hash: &str) -> Result<Option<LinkPreviewRow>, sqlx::Error> {
    sqlx::query_as::<_, LinkPreviewRow>(
        "SELECT title, description, image_url FROM link_previews
         WHERE url_hash = $1 AND fetched_at > NOW() - INTERVAL '24 hours'",
    )
    .bind(url_hash)
    .fetch_optional(pool)
    .await
}

pub async fn upsert(
    pool: &PgPool,
    url_hash: &str,
    url: &str,
    title: Option<&str>,
    description: Option<&str>,
    image_url: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO link_previews (url_hash, url, title, description, image_url, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (url_hash) DO UPDATE SET
             url = EXCLUDED.url,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             image_url = EXCLUDED.image_url,
             fetched_at = EXCLUDED.fetched_at",
    )
    .bind(url_hash)
    .bind(url)
    .bind(title)
    .bind(description)
    .bind(image_url)
    .execute(pool)
    .await?;
    Ok(())
}

/// Unlike `get_fresh`, this doesn't gate on the 24h TTL — the image proxy
/// trusts any `image_url` that was ever legitimately unfurled, regardless
/// of whether the metadata itself has since gone stale.
pub async fn get_image_url(pool: &PgPool, url_hash: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT image_url FROM link_previews WHERE url_hash = $1")
        .bind(url_hash)
        .fetch_optional(pool)
        .await
        .map(|opt| opt.flatten())
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test database::link_previews -- --nocapture`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Register the module**

Find where `database::messages` is declared (grep `pub mod messages` in `chat_server/src/database/` or wherever the `database` module root is) and add `pub mod link_previews;` alongside it, matching the exact same style.

- [ ] **Step 7: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add migrations/012_link_previews.sql src/database/link_previews.rs src/database/mod.rs
git commit -m "feat: link_previews cache table and data access"
```

(If `database`'s module root lives somewhere other than `src/database/mod.rs`, e.g. inline in `main.rs`, stage that file instead — check with `grep -rn "mod messages" chat_server/src/` before committing.)

---

### Task 5: Query-string token fallback for `AuthenticatedUser`

**Files:**
- Modify: `chat_server/src/api/mod.rs`

**Interfaces:**
- Consumes: nothing new
- Produces: `AuthenticatedUser` unchanged in shape (`{ pub user_id: i64 }`) — only its `FromRequestParts` extraction logic gains a fallback source

This is a standalone, security-sensitive change to the extractor every authenticated REST endpoint already depends on. It must not change behavior for any existing caller — only add a new fallback path for requests that can't carry a header at all (an `<img>` tag load, same constraint the WS handshake already works around with `?token=`).

- [ ] **Step 1: Write the failing tests**

Find the existing test module in `chat_server/src/api/mod.rs` (create one if none exists yet — check first with `grep -n "mod tests" chat_server/src/api/mod.rs`). Add:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, Uri};

    fn make_state_with_secret(secret: &str) -> Arc<AppState> {
        // Minimal AppState for extractor-only tests — this needs whatever
        // AppState:: constructor pattern the existing test helpers in this
        // codebase use (see `make_app_state` in api/messages.rs or
        // websocket/handler.rs for the exact fields to fill in). Reuse
        // that same pattern here rather than re-deriving it.
        unimplemented!("fill in using the make_app_state pattern from api/messages.rs")
    }

    // Steps 2+ below replace this placeholder with real setup — see Step 3.
}
```

**Do not leave the `unimplemented!` in — Step 3 below gives the real test bodies.** This first pass exists only to confirm you've located the right test-setup pattern before writing real assertions.

- [ ] **Step 2: Locate the real test-setup pattern**

Read `chat_server/src/api/messages.rs`'s `make_app_state` helper (already used elsewhere in this codebase) to see the exact `AppState` construction this project's tests use — same `DATABASE_URL`/`REDIS_URL` env fallback, same `RoleCache::with_prefix` test-namespacing convention. This extractor test needs a `PgPool` (via `#[sqlx::test]`) plus the same Redis setup, so mirror that helper exactly rather than reinventing it.

- [ ] **Step 3: Replace the placeholder with real tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::FromRequestParts;
    use axum::http::Request;
    use jsonwebtoken::{EncodingKey, Header, encode};

    async fn make_state(pool: sqlx::PgPool) -> Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::new(redis),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
        })
    }

    fn mint(user_id: i64, secret: &str) -> String {
        encode(
            &Header::default(),
            &Claims { sub: user_id, exp: 9_999_999_999 },
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    #[sqlx::test]
    async fn authorization_header_still_works_unchanged(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(42, &state.jwt_secret);

        let req = Request::builder()
            .uri("/whatever")
            .header("Authorization", format!("Bearer {token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state).await.unwrap();
        assert_eq!(user.user_id, 42);
        Ok(())
    }

    #[sqlx::test]
    async fn query_token_works_when_no_header_is_present(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let token = mint(7, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?url_hash=abc&token={token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state).await.unwrap();
        assert_eq!(user.user_id, 7);
        Ok(())
    }

    #[sqlx::test]
    async fn header_wins_when_both_are_present(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let header_token = mint(1, &state.jwt_secret);
        let query_token = mint(2, &state.jwt_secret);

        let req = Request::builder()
            .uri(format!("/whatever?token={query_token}"))
            .header("Authorization", format!("Bearer {header_token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();

        let user = AuthenticatedUser::from_request_parts(&mut parts, &state).await.unwrap();
        assert_eq!(user.user_id, 1, "header must take precedence over a query token");
        Ok(())
    }

    #[sqlx::test]
    async fn rejects_when_neither_source_has_a_token(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let req = Request::builder().uri("/whatever").body(()).unwrap();
        let (mut parts, _) = req.into_parts();

        let result = AuthenticatedUser::from_request_parts(&mut parts, &state).await;
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
        Ok(())
    }
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cargo test api::mod::tests -- --nocapture` (adjust the path if `mod tests` ends up namespaced differently — check the actual module path axum/cargo reports)
Expected: FAIL on the query-token test — the extractor doesn't check the query string yet. The header test should already pass since it exercises existing behavior.

- [ ] **Step 5: Implement the fallback**

In `chat_server/src/api/mod.rs`, find the existing `impl FromRequestParts<Arc<AppState>> for AuthenticatedUser` block and replace its token-extraction lines:

```rust
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(StatusCode::UNAUTHORIZED)?;
```

with:

```rust
        let header_token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());

        // Some requests can't carry a custom header at all — an <img> tag
        // driven fetch is one, the same constraint the WS upgrade handshake
        // already works around with a query-string token.
        let query_token = header_token.is_none().then(|| {
            parts.uri.query().and_then(|q| {
                q.split('&')
                    .find(|p| p.starts_with("token="))
                    .and_then(|p| p.strip_prefix("token="))
                    .map(|s| s.to_string())
            })
        }).flatten();

        let token = header_token.or(query_token).ok_or(StatusCode::UNAUTHORIZED)?;
```

Then update every subsequent use of `token` in that function body from `token` (a `&str` before) to `&token` (now an owned `String`) — check the `decode::<Claims>(token, ...)` call a few lines down and adjust to `decode::<Claims>(&token, ...)`.

- [ ] **Step 6: Run to verify all four tests pass**

Run: `cargo test api::mod::tests -- --nocapture`
Expected: PASS (all 4)

- [ ] **Step 7: Run the full existing test suite to confirm nothing else broke**

Run: `cargo test`
Expected: every previously-passing test (all REST/WS handlers gated by `AuthenticatedUser`) still passes — this extractor is the auth boundary for the whole API surface, so this is the single most important regression check in this entire plan.

- [ ] **Step 8: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add src/api/mod.rs
git commit -m "feat: allow a query-string token as an auth fallback"
```

---

### Task 6: `POST /api/links/unfurl`

**Files:**
- Create: `chat_server/src/api/links.rs`
- Modify: `chat_server/src/api/mod.rs` (add `pub mod links;`, add `http_client` field to `AppState`)
- Modify: `chat_server/src/api/server.rs` (register the route)
- Modify: `chat_server/src/main.rs` (build the client, wire into `AppState`)
- Modify: `chat_server/src/api/messages.rs`, `chat_server/src/websocket/handler.rs`, `chat_server/src/api/auth.rs` (their `make_app_state` test helpers need the new field — confirmed via `grep -rln "AppState {" src/` that these three plus `main.rs` are every existing site; there will be a *fifth*, `api/mod.rs`'s own `make_state` from Task 5, by the time this task runs)
- Modify: `chat_server/Cargo.toml`

**Interfaces:**
- Consumes: Task 1 (`net::ssrf::build_http_client`), Task 2 (`net::fetch::{fetch_capped, MAX_FETCH_BYTES, FetchError}`), Task 3 (`links::preview::parse_preview_html`), Task 4 (`database::link_previews::{get_fresh, upsert}`)
- Produces: `pub fn url_hash(url: &str) -> String`, `#[derive(Deserialize)] pub struct UnfurlRequest { pub url: String }`, `#[derive(Serialize)] pub struct UnfurlResponse { pub available: bool, pub url_hash: Option<String>, pub title: Option<String>, pub description: Option<String>, pub has_image: bool }`, `pub async fn unfurl(...) -> Result<Json<UnfurlResponse>, StatusCode>`

- [ ] **Step 1: Add `sha2`**

`chat_server/Cargo.toml`:

```toml
sha2 = "0.10"
```

- [ ] **Step 2: Add `http_client` to `AppState` and thread it through**

In `chat_server/src/api/mod.rs`, add to the `AppState` struct:

```rust
    pub http_client: reqwest::Client,
```

In `chat_server/src/main.rs`, after `let allowed_origins = config::allowed_origins();`:

```rust
    let http_client = net::ssrf::build_http_client();
```

And add `http_client,` to the `AppState { ... }` construction.

In `chat_server/src/api/messages.rs`'s `make_app_state`, `chat_server/src/websocket/handler.rs`'s `make_app_state`, and `chat_server/src/api/auth.rs`'s `make_app_state` (all three already updated once before for `allowed_origins` — same pattern), add:

```rust
            http_client: crate::net::ssrf::build_http_client(),
```

Also check `chat_server/src/api/mod.rs` for a `make_state` helper inside its `#[cfg(test)] mod tests` — Task 5 added one there, and it needs the same field added the same way.

**Every one of these — never `reqwest::Client::new()` as a shortcut to make the build pass.** A plain client skips the SSRF protection entirely; even in test-only code, that's the kind of thing that gets copy-pasted into production later.

- [ ] **Step 3: Confirm the crate builds with the new field wired everywhere**

Run: `cargo build`
Expected: clean build — this step exists purely to catch any missed test-helper `AppState` construction before writing the actual endpoint logic.

- [ ] **Step 4: Write the failing tests**

`chat_server/src/api/links.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::link_previews;

    async fn make_state(pool: sqlx::PgPool) -> std::sync::Arc<AppState> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        std::sync::Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::new(redis),
            subscribers: crate::memory::subscribers::ChannelSubscribers::new(),
            allowed_origins: crate::config::allowed_origins(),
            http_client: crate::net::ssrf::build_http_client(),
        })
    }

    #[sqlx::test]
    async fn rejects_a_non_http_url(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: "ftp://example.com".to_string() }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[sqlx::test]
    async fn returns_a_cached_row_without_fetching(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/cached");
        link_previews::upsert(
            &state.db, &hash, "https://example.com/cached",
            Some("Cached Title"), Some("Cached Desc"), Some("https://example.com/img.png"),
        ).await.unwrap();

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: "https://example.com/cached".to_string() }),
        )
        .await
        .unwrap();

        assert!(result.0.available);
        assert_eq!(result.0.title, Some("Cached Title".to_string()));
        assert_eq!(result.0.url_hash, Some(hash));
        assert!(result.0.has_image);
        Ok(())
    }

    #[sqlx::test]
    async fn cached_row_with_no_metadata_reports_unavailable(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/empty");
        link_previews::upsert(&state.db, &hash, "https://example.com/empty", None, None, None)
            .await
            .unwrap();

        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: "https://example.com/empty".to_string() }),
        )
        .await
        .unwrap();

        assert!(!result.0.available, "a cached-but-empty row must report unavailable");
        Ok(())
    }

    #[sqlx::test]
    async fn an_unreachable_internal_target_reports_unavailable_not_an_error(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        // No mock server needed — SSRF protection blocks this before any
        // connection attempt, and that must surface as the same
        // { available: false } shape as any other failure, not a 5xx.
        let state = make_state(pool).await;
        let result = unfurl(
            AuthenticatedUser { user_id: 1 },
            State(state),
            Json(UnfurlRequest { url: "http://127.0.0.1:1/nope".to_string() }),
        )
        .await
        .unwrap();

        assert!(!result.0.available);
        Ok(())
    }
}
```

- [ ] **Step 5: Run to verify it fails**

Run: `cargo test api::links -- --nocapture`
Expected: FAIL — nothing implemented yet.

- [ ] **Step 6: Implement `url_hash`, the request/response types, and the handler**

Add above the test module:

```rust
use crate::api::AppState;
use crate::api::AuthenticatedUser;
use crate::api::ratelimit::check_rate_limit;
use crate::database::link_previews;
use crate::links::preview::{self, ParsedPreview};
use crate::net::fetch::{self, MAX_FETCH_BYTES};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub fn url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Deserialize)]
pub struct UnfurlRequest {
    pub url: String,
}

#[derive(Serialize)]
pub struct UnfurlResponse {
    pub available: bool,
    pub url_hash: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub has_image: bool,
}

fn unavailable() -> UnfurlResponse {
    UnfurlResponse { available: false, url_hash: None, title: None, description: None, has_image: false }
}

pub async fn unfurl(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UnfurlRequest>,
) -> Result<Json<UnfurlResponse>, StatusCode> {
    check_rate_limit(&state.redis, &format!("unfurl:{}", auth.user_id), 30, 60).await?;

    let parsed = reqwest::Url::parse(&req.url).map_err(|_| StatusCode::BAD_REQUEST)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let hash = url_hash(&req.url);

    if let Some(row) = link_previews::get_fresh(&state.db, &hash)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let has_image = row.image_url.is_some();
        let has_content = row.title.is_some() || row.description.is_some() || has_image;
        return Ok(Json(if has_content {
            UnfurlResponse {
                available: true,
                url_hash: Some(hash),
                title: row.title,
                description: row.description,
                has_image,
            }
        } else {
            unavailable()
        }));
    }

    // Cache miss or stale — fetch live. Any failure from here on collapses
    // to "no preview available", never a distinguishable error — this
    // endpoint must not become an oracle for probing internal network
    // reachability. See fetch_and_parse below.
    let Some(fetched) = fetch_and_parse(&state.http_client, &req.url).await else {
        return Ok(Json(unavailable()));
    };

    link_previews::upsert(
        &state.db, &hash, &req.url,
        fetched.title.as_deref(), fetched.description.as_deref(), fetched.image_url.as_deref(),
    ).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let has_image = fetched.image_url.is_some();
    let has_content = fetched.title.is_some() || fetched.description.is_some() || has_image;
    Ok(Json(if has_content {
        UnfurlResponse {
            available: true,
            url_hash: Some(hash),
            title: fetched.title,
            description: fetched.description,
            has_image,
        }
    } else {
        unavailable()
    }))
}

async fn fetch_and_parse(client: &reqwest::Client, url: &str) -> Option<ParsedPreview> {
    let capped = fetch::fetch_capped(client, url, MAX_FETCH_BYTES).await.ok()?;
    let ct = capped.content_type?;
    if !ct.to_ascii_lowercase().starts_with("text/html") {
        return None;
    }
    let html = String::from_utf8(capped.body.to_vec()).ok()?;
    Some(preview::parse_preview_html(&html))
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `cargo test api::links -- --nocapture`
Expected: PASS (all 5 tests)

- [ ] **Step 8: Register the module and the route**

In `chat_server/src/api/mod.rs`, add `pub mod links;`.

In `chat_server/src/api/server.rs`, add the import and route:

```rust
use super::links::unfurl;
```

```rust
        .route("/api/links/unfurl", post(unfurl))
```

- [ ] **Step 9: Full build + test sanity check**

Run: `cargo build && cargo test`
Expected: clean build, every test (old and new) passes.

- [ ] **Step 10: Commit**

```bash
cd chat_server
cargo fmt
cargo clippy --all-targets -- -D warnings
git add Cargo.toml Cargo.lock src/main.rs src/api/mod.rs src/api/server.rs src/api/links.rs src/api/messages.rs src/websocket/handler.rs
git commit -m "feat: link unfurl endpoint"
```

---

### Task 7: `GET /api/links/image-proxy`

**Files:**
- Modify: `chat_server/src/api/links.rs`
- Modify: `chat_server/src/api/server.rs`

**Interfaces:**
- Consumes: Task 1 (`state.http_client`), Task 2 (`net::fetch::fetch_capped`), Task 4 (`database::link_previews::get_image_url`), Task 5 (`AuthenticatedUser`'s query-token fallback — this is *why* this endpoint can be JWT-gated at all despite being loaded from an `<img src>`)
- Produces: `#[derive(Deserialize)] pub struct ImageProxyParams { pub url_hash: String }`, `pub async fn image_proxy(...) -> Result<Response, StatusCode>`

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` block in `chat_server/src/api/links.rs`:

```rust
    #[sqlx::test]
    async fn returns_404_for_an_unknown_hash(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: "nope".to_string() }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }

    #[sqlx::test]
    async fn returns_404_when_the_cached_row_has_no_image(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/no-image");
        link_previews::upsert(&state.db, &hash, "https://example.com/no-image", Some("T"), None, None)
            .await
            .unwrap();

        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }

    #[sqlx::test]
    async fn a_cached_row_pointing_at_an_internal_address_fails_without_panicking(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        // The image proxy applies the same SSRF protection as unfurl — this
        // confirms it degrades to an error response, not a panic or a leak.
        let state = make_state(pool).await;
        let hash = url_hash("https://example.com/bad-image");
        link_previews::upsert(
            &state.db, &hash, "https://example.com/bad-image",
            None, None, Some("http://127.0.0.1:1/nope"),
        ).await.unwrap();

        let result = image_proxy(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Query(ImageProxyParams { url_hash: hash }),
        )
        .await;
        assert!(result.is_err());
        Ok(())
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test api::links -- --nocapture`
Expected: FAIL — `image_proxy`/`ImageProxyParams` not defined.

- [ ] **Step 3: Implement the handler**

Add to `chat_server/src/api/links.rs` (above the test module, alongside `unfurl`):

```rust
use axum::http::header;
use axum::response::{IntoResponse, Response};

#[derive(Deserialize)]
pub struct ImageProxyParams {
    pub url_hash: String,
}

pub async fn image_proxy(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<ImageProxyParams>,
) -> Result<Response, StatusCode> {
    check_rate_limit(&state.redis, &format!("imgproxy:{}", auth.user_id), 60, 60).await?;

    let image_url = link_previews::get_image_url(&state.db, &params.url_hash)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let capped = fetch::fetch_capped(&state.http_client, &image_url, MAX_FETCH_BYTES)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let content_type = capped.content_type.unwrap_or_else(|| "application/octet-stream".to_string());

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
        ],
        capped.body,
    )
        .into_response())
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test api::links -- --nocapture`
Expected: PASS (all 8 tests in this file)

- [ ] **Step 5: Register the route**

In `chat_server/src/api/server.rs`:

```rust
use super::links::{image_proxy, unfurl};
```

```rust
        .route("/api/links/image-proxy", get(image_proxy))
```

- [ ] **Step 6: Full sanity check**

Run: `cargo build && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: clean build, clean lint, every test passes.

- [ ] **Step 7: Commit**

```bash
cd chat_server
git add src/api/links.rs src/api/server.rs
git commit -m "feat: link preview image proxy endpoint"
```

---

### Task 8: Frontend URL extraction (`extractFirstUrl`)

**Files:**
- Modify: `grove_client/src/components/MessageRow/shared.tsx`
- Modify: `grove_client/src/components/MessageRow/shared.test.ts`

**Interfaces:**
- Consumes: nothing new (reuses the existing `trimTrailingPunctuation` in the same file, exporting it)
- Produces: `export function extractFirstUrl(text: string): string | undefined`

- [ ] **Step 1: Write the failing tests**

Add to `grove_client/src/components/MessageRow/shared.test.ts`:

```ts
describe("extractFirstUrl", () => {
    test("returns the first url in a message with plain text around it", () => {
        expect(extractFirstUrl("check this out https://example.com/page it is cool")).toBe("https://example.com/page");
    });

    test("returns undefined when there is no url", () => {
        expect(extractFirstUrl("no url here at all")).toBeUndefined();
    });

    test("keeps balanced parens in a wikipedia-style url", () => {
        expect(extractFirstUrl("see https://en.wikipedia.org/wiki/Rust_(programming_language) for docs.")).toBe(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)"
        );
    });

    test("only returns the first of multiple urls", () => {
        expect(extractFirstUrl("two links https://a.com and https://b.com")).toBe("https://a.com");
    });

    test("strips trailing markdown bold markers", () => {
        expect(extractFirstUrl("wrapped in md **https://example.com/bold**")).toBe("https://example.com/bold");
    });

    test("strips trailing punctuation that follows markdown markers", () => {
        expect(extractFirstUrl("wrapped in md **https://example.com/bold**.")).toBe("https://example.com/bold");
    });

    test("strips trailing strikethrough markers before trailing punctuation", () => {
        expect(extractFirstUrl("strike ~~https://x.com~~,")).toBe("https://x.com");
    });

    test("strips a trailing inline-code backtick", () => {
        expect(extractFirstUrl("code `https://x.com/code`")).toBe("https://x.com/code");
    });
});
```

Add the import at the top of the test file (alongside whatever's already imported from `./shared`):

```ts
import { extractFirstUrl } from "./shared";
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: FAIL — `extractFirstUrl` not exported yet.

- [ ] **Step 3: Export `trimTrailingPunctuation` and implement `extractFirstUrl`**

In `grove_client/src/components/MessageRow/shared.tsx`, change:

```ts
function trimTrailingPunctuation(url: string): string {
```

to:

```ts
export function trimTrailingPunctuation(url: string): string {
```

Find the `CHECKS` array's URL entry:

```ts
    { regex: /https?:\/\/[^\s<]+/, type: "url" },
```

Replace the whole `CHECKS` array declaration's URL line and add a shared constant just above `const CHECKS: Check[] = [`:

```ts
const URL_PATTERN = /https?:\/\/[^\s<]+/;
```

and change the CHECKS entry to:

```ts
    { regex: URL_PATTERN, type: "url" },
```

Then add, just below `trimTrailingPunctuation`:

```ts
function trimTrailingMarkdownMarkers(url: string): string {
    let end = url.length;
    while (end > 0 && "*_~`".includes(url[end - 1])) end -= 1;
    return url.slice(0, end);
}

/** First URL in a message, if any — used for the link-preview card, kept
 *  separate from parseMarkdown's own URL handling since it needs the raw
 *  match regardless of what markdown wraps it. */
export function extractFirstUrl(text: string): string | undefined {
    const m = URL_PATTERN.exec(text);
    if (!m) return undefined;
    return trimTrailingMarkdownMarkers(trimTrailingPunctuation(m[0]));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: PASS (all new tests, plus every pre-existing test in this file still green)

- [ ] **Step 5: Typecheck and lint**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/MessageRow/shared.tsx src/components/MessageRow/shared.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd grove_client
git add src/components/MessageRow/shared.tsx src/components/MessageRow/shared.test.ts
git commit -m "feat: extract the first url from a message for link previews"
```

---

### Task 9: `LinkPreviewCard` and integration

**Files:**
- Create: `grove_client/src/components/MessageRow/LinkPreviewCard.tsx`
- Modify: `grove_client/src/api.ts`
- Modify: `grove_client/src/components/MessageRow/MessageBody.tsx`
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Consumes: Task 8 (`extractFirstUrl`), Task 6/7's `UnfurlResponse` JSON shape, Task 5's `?token=` query mechanism (for the image `src`)
- Produces: `LinkPreviewCard` component, `unfurlLink()`, `imageProxyUrl()`

This task has no backend to test against in this repo's test suite (frontend has no test framework beyond vitest unit tests on plain functions, per this project's established convention — component behavior here is verified by building and a manual browser check, matching how every other `.tsx` component in this codebase is verified).

- [ ] **Step 1: Add the API functions**

In `grove_client/src/api.ts`, add near the other auth-adjacent calls:

```ts
export interface UnfurlResult {
    available:   boolean;
    url_hash:    string | null;
    title:       string | null;
    description: string | null;
    has_image:   boolean;
}

export async function unfurlLink(url: string, token: string): Promise<UnfurlResult> {
    const res = await fetch(`${API_BASE}/api/links/unfurl`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ url }),
    });
    if (!res.ok) {
        return { available: false, url_hash: null, title: null, description: null, has_image: false };
    }
    return res.json();
}

// <img> tags can't carry a custom Authorization header, so this embeds the
// token as a query param instead — the backend's AuthenticatedUser
// extractor accepts either (see chat_server/src/api/mod.rs).
export function imageProxyUrl(urlHash: string, token: string): string {
    return `${API_BASE}/api/links/image-proxy?url_hash=${encodeURIComponent(urlHash)}&token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 2: Write `LinkPreviewCard`**

`grove_client/src/components/MessageRow/LinkPreviewCard.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { getToken } from "../../auth";
import { unfurlLink, imageProxyUrl } from "../../api";

interface PreviewState {
    title?:       string;
    description?: string;
    hasImage:     boolean;
    urlHash?:     string;
}

// One IntersectionObserver per card, disconnected after the first
// intersection — cheap, and avoids firing an unfurl call for every link in
// a long history the instant it mounts. Single caller, so this stays local
// rather than becoming a shared hook (see this project's hook-extraction rule).
function useOnceVisible(ref: React.RefObject<HTMLElement | null>): boolean {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (visible) return;
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [visible, ref]);
    return visible;
}

export function LinkPreviewCard({ url }: { url: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const visible = useOnceVisible(containerRef);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!visible) return;
        const token = getToken();
        if (!token) return;

        let cancelled = false;
        unfurlLink(url, token)
            .then(result => {
                if (cancelled || !result.available) return;
                setPreview({
                    title:       result.title ?? undefined,
                    description: result.description ?? undefined,
                    hasImage:    result.has_image,
                    urlHash:     result.url_hash ?? undefined,
                });
            })
            .catch(() => { /* no preview is a normal, silent outcome */ });

        return () => { cancelled = true; };
    }, [visible, url]);

    if (dismissed || !preview) {
        return <div ref={containerRef} aria-hidden="true" />;
    }

    const token = getToken();

    return (
        <div ref={containerRef} className="dw-link-preview">
            {preview.hasImage && preview.urlHash && token && (
                <img
                    className="dw-link-preview-img"
                    src={imageProxyUrl(preview.urlHash, token)}
                    alt=""
                    loading="lazy"
                />
            )}
            <div className="dw-link-preview-body">
                {preview.title && <div className="dw-link-preview-title">{preview.title}</div>}
                {preview.description && <div className="dw-link-preview-desc">{preview.description}</div>}
            </div>
            <button
                className="dw-link-preview-dismiss"
                aria-label="Dismiss preview"
                onClick={() => setDismissed(true)}
            >
                ×
            </button>
        </div>
    );
}
```

- [ ] **Step 3: Wire it into `MessageBody.tsx`**

In `grove_client/src/components/MessageRow/MessageBody.tsx`, `useMemo` is **already imported** (`import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";`) — do not add a second `react` import line, it would collide. Add only:

```tsx
import { LinkPreviewCard } from "./LinkPreviewCard";
import { extractFirstUrl } from "./shared";
```

Inside the `MessageBody` function body, after the existing hooks (`poppingEmojis`, etc.) and before the `return`:

```tsx
    const previewUrl = useMemo(
        () => (!m.deleted && !isEditing ? extractFirstUrl(m.text) : undefined),
        [m.text, m.deleted, isEditing],
    );
```

Then in the JSX, right after the closing `</div>` of the `.dw-msg-text` wrapper block (the outer `<div>` that contains the deleted/editing/text ternary), add:

```tsx
            {previewUrl && <LinkPreviewCard url={previewUrl} />}
```

- [ ] **Step 4: Add the CSS**

In `grove_client/src/styles/darkwood.css`, near the other message-related rules (e.g. after `.dw-code-block` from the earlier message-formatting work):

```css
.dw-link-preview {
  position: relative;
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  max-width: 420px;
  background: var(--surface-2);
  border-left: 2px solid var(--leaf);
  border-radius: var(--r-sm);
}

.dw-link-preview-img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--r-xs);
  flex-shrink: 0;
}

.dw-link-preview-body {
  min-width: 0;
  flex: 1;
}

.dw-link-preview-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: var(--sp-1);
}

.dw-link-preview-desc {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dw-link-preview-dismiss {
  position: absolute;
  top: var(--sp-1);
  right: var(--sp-1);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-md);
  line-height: 1;
  padding: var(--sp-1);
  transition: color var(--dur-fast);
}
.dw-link-preview-dismiss:hover { color: var(--text-primary); }
```

- [ ] **Step 5: Build and typecheck**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/MessageRow/LinkPreviewCard.tsx src/components/MessageRow/MessageBody.tsx src/api.ts && npm run build`
Expected: all clean.

- [ ] **Step 6: Manual browser check**

Run: use the `run` skill (or `docker compose -f docker-compose.prod.yml up --build`) to launch Grove, send a message containing a real URL with OG metadata (e.g. a Wikipedia article link) in a channel, and confirm: the card appears shortly after the message renders, the image loads through Grove's own origin (check the Network tab — the image request's URL should be `/api/links/image-proxy?...`, not the third-party host), and the dismiss button hides it.

- [ ] **Step 7: Commit**

```bash
cd grove_client
git add src/api.ts src/components/MessageRow/LinkPreviewCard.tsx src/components/MessageRow/MessageBody.tsx src/styles/darkwood.css
git commit -m "feat: render link preview cards in messages"
```

---

## Self-Review

**Spec coverage:** unfurl endpoint (Task 6) ✓, image proxy (Task 7) ✓, SSRF protection incl. redirect-hop coverage (Task 1) ✓, 24h cache (Task 4) ✓, per-user rate limits both endpoints (Tasks 6/7) ✓, uniform failure response (Task 6) ✓, frontend extraction/debounce-via-visibility/card/dismiss (Tasks 8/9) ✓. The auth-fallback mechanism (Task 5) wasn't in the spec explicitly — it's an implementation-level necessity the spec's "JWT-auth'd like everything else" requirement still holds, just via a mechanism refinement documented in Global Constraints above.

**Placeholder scan:** the only non-final code in this plan is Task 5 Step 1's intentional `unimplemented!()` stub, which Step 3 immediately replaces with real assertions — flagged inline as deliberate, not a leftover.

**Type consistency:** `UnfurlResponse` (Rust, Task 6) and `UnfurlResult` (TS, Task 9) fields match 1:1 (`available`, `url_hash`, `title`, `description`, `has_image`). `ImageProxyParams.url_hash` (Task 7) matches the `url_hash` query param `imageProxyUrl` (Task 9) constructs. `AuthenticatedUser { user_id: i64 }` (Task 5) matches every call site across Tasks 6/7. `ParsedPreview { title, description, image_url }` (Task 3) matches the fields `fetch_and_parse` (Task 6) reads. `CappedFetch { body, content_type }` (Task 2) matches both consumers (Tasks 6, 7).
