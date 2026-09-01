use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use url::{Host, Url};

/// Rejects loopback, RFC1918, link-local (incl. `169.254.169.254`, the cloud
/// metadata address), CGNAT, multicast, and IPv6 equivalents — the ranges an
/// SSRF-vulnerable fetch could be redirected into on an internal network.
#[allow(dead_code)]
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => is_public_ipv6(v6),
    }
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

/// Reserved hostname that resolves straight to loopback in test builds only.
/// Lets `#[cfg(test)]` code drive a real HTTP request through the full
/// SSRF-checked path (`get_checked` -> `SsrfSafeResolver`) against an
/// in-process mock server, without weakening `is_url_host_safe`'s literal-IP
/// handling at all — this hostname is never a literal IP, so it's an
/// ordinary `Host::Domain` as far as that function is concerned, and every
/// existing literal-IP test is completely unaffected.
///
/// `#[cfg(test)]` means this constant, and the branch in `resolve` below
/// that checks it, are compiled out entirely for a release build — not
/// merely inert at runtime. There is no code path by which this can ship.
/// Picked from the `.invalid` TLD (reserved by RFC 2606) so it can never
/// collide with a real, resolvable domain.
#[cfg(test)]
pub const TEST_LOOPBACK_HOST: &str = "grove-test-loopback.invalid";

/// A DNS resolver that filters every answer to public IPs only — protects
/// hostname-based requests and DNS rebinding. Does NOT run for a URL whose
/// host is already a literal IP (nothing to resolve); `get_checked` below
/// covers that case, which this resolver structurally cannot.
#[derive(Clone)]
#[allow(dead_code)]
pub struct SsrfSafeResolver;

impl Resolve for SsrfSafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();

            #[cfg(test)]
            if host == TEST_LOOPBACK_HOST {
                let iter: Addrs = Box::new(std::iter::once(SocketAddr::from((
                    IpAddr::V4(Ipv4Addr::LOCALHOST),
                    0,
                ))));
                return Ok(iter);
            }

            let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let filtered: Vec<SocketAddr> = addrs.filter(|a| is_public_ip(a.ip())).collect();
            let iter: Addrs = Box::new(filtered.into_iter());
            Ok(iter)
        })
    }
}

/// Checks a URL's host directly when it's already a literal IP — the
/// resolver never runs in that case (an IP literal has nothing to resolve),
/// so this is the *only* enforcement point for it, both for the initial
/// request and for every redirect hop. Hostnames are deferred to the
/// resolver above, which already filters them correctly.
///
/// Only `http`/`https` are accepted. For WHATWG "special" schemes the `url`
/// crate types a literal IP host correctly, so the checks below can see it —
/// but for non-special schemes (`redis://`, `gopher://`, `file://host/path`,
/// arbitrary custom schemes) even a literal `127.0.0.1` or
/// `169.254.169.254` host is left as an opaque `Host::Domain(_)` string,
/// which would otherwise fall through to the "defer to DNS" branch below and
/// pass unchecked. Rejecting the scheme up front closes that gap and keeps
/// this the single place both callers (`unfurl`, `image_proxy`, via
/// `get_checked`) need to trust.
#[allow(dead_code)]
pub fn is_url_host_safe(url: &Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    match url.host() {
        Some(Host::Ipv4(v4)) => is_public_ip(IpAddr::V4(v4)),
        Some(Host::Ipv6(v6)) => is_public_ip(IpAddr::V6(v6)),
        Some(Host::Domain(_)) => true,
        None => false,
    }
}

#[derive(Debug, PartialEq)]
#[allow(dead_code)]
enum RedirectDecision {
    Follow,
    StopAtCap,
    Blocked,
}

/// Pure decision logic, deliberately decoupled from reqwest's `Attempt`
/// type (which isn't constructible outside reqwest's own redirect
/// machinery, so this couldn't be unit-tested any other way) — this is
/// what actually makes the hop-cap boundary testable without a network.
#[allow(dead_code)]
fn redirect_decision(target: &Url, hops_so_far: usize) -> RedirectDecision {
    if hops_so_far > 3 {
        return RedirectDecision::StopAtCap;
    }
    if is_url_host_safe(target) {
        RedirectDecision::Follow
    } else {
        RedirectDecision::Blocked
    }
}

/// Shared client for link unfurling and image proxying. Build once at
/// startup and clone (cheap — internally `Arc`-backed) into `AppState`.
///
/// **Do not call `.get(url).send()` on this client directly for any
/// caller-supplied URL — it does not block a direct request to a literal
/// IP on its own.** Always go through `get_checked` below (or a wrapper
/// that itself calls it, like Task 2's `fetch_capped`).
#[allow(dead_code)]
pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(SsrfSafeResolver))
        .redirect(reqwest::redirect::Policy::custom(
            |attempt| match redirect_decision(attempt.url(), attempt.previous().len()) {
                RedirectDecision::Follow => attempt.follow(),
                RedirectDecision::StopAtCap => attempt.stop(),
                RedirectDecision::Blocked => {
                    attempt.error("blocked redirect target: not a public IP")
                }
            },
        ))
        .timeout(Duration::from_secs(5))
        .user_agent("Grove/1.0")
        .build()
        .expect("failed to build SSRF-safe http client")
}

#[derive(Debug)]
pub enum GetCheckedError {
    InvalidUrl,
    Blocked,
    #[allow(dead_code)]
    Request(reqwest::Error),
}

/// The only sanctioned way to send a request through this client for a
/// caller-supplied URL — checks the target host, including the literal-IP
/// case the resolver can't see, before ever connecting. `build_http_client`
/// alone is not sufficient; this is the actual safe primitive.
pub async fn get_checked(
    client: &reqwest::Client,
    url: &str,
) -> Result<reqwest::Response, GetCheckedError> {
    let parsed = Url::parse(url).map_err(|_| GetCheckedError::InvalidUrl)?;
    if !is_url_host_safe(&parsed) {
        return Err(GetCheckedError::Blocked);
    }
    client
        .get(url)
        .send()
        .await
        .map_err(GetCheckedError::Request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_and_private_and_link_local_ranges() {
        for ip in [
            "127.0.0.1",
            "127.5.5.5",
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "169.254.1.1",
            "100.64.0.1",
            "100.127.255.255",
            "224.0.0.1",
            "255.255.255.255",
            "0.0.0.0",
            "192.0.2.1",
            "::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::",
            "::ffff:10.0.0.5",
            "::ffff:127.0.0.1",
        ] {
            let addr: std::net::IpAddr = ip.parse().unwrap();
            assert!(!is_public_ip(addr), "{ip} should be blocked");
        }
    }

    #[test]
    fn allows_real_public_addresses() {
        for ip in [
            "8.8.8.8",
            "1.1.1.1",
            "100.63.255.255",
            "100.128.0.0",
            "172.32.0.1",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
        ] {
            let addr: std::net::IpAddr = ip.parse().unwrap();
            assert!(is_public_ip(addr), "{ip} should be allowed");
        }
    }

    #[tokio::test]
    async fn get_checked_refuses_a_literal_loopback_ip() {
        let app = axum::Router::new().route(
            "/",
            axum::routing::get(|| async { "should never be reached" }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = build_http_client();
        let result = get_checked(&client, &format!("http://{}/", addr)).await;
        assert!(matches!(result, Err(GetCheckedError::Blocked)));
    }

    #[tokio::test]
    async fn raw_client_alone_does_not_block_a_literal_ip_by_design() {
        let app = axum::Router::new().route(
            "/",
            axum::routing::get(|| async { "reached — as documented" }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = build_http_client();
        let result = client.get(format!("http://{}/", addr)).send().await;
        assert!(
            result.is_ok(),
            "documents that the raw client does not self-protect — use get_checked"
        );
    }

    #[test]
    fn is_url_host_safe_blocks_a_non_http_scheme_with_a_literal_loopback_host() {
        // The `url` crate leaves a literal IP as an opaque Host::Domain(_)
        // for non-special schemes like redis:// — without the scheme check
        // this would incorrectly fall through the Host::Domain(_) => true
        // branch and pass as safe.
        let url = Url::parse("redis://127.0.0.1:6379/").unwrap();
        assert!(!is_url_host_safe(&url));
    }

    #[test]
    fn is_url_host_safe_blocks_a_file_scheme_with_an_internal_host() {
        let url = Url::parse("file://internal-host/secret").unwrap();
        assert!(!is_url_host_safe(&url));
    }

    #[test]
    fn is_url_host_safe_allows_an_ordinary_public_https_hostname() {
        let url = Url::parse("https://example.com/img.png").unwrap();
        assert!(is_url_host_safe(&url));
    }

    #[test]
    fn is_url_host_safe_still_blocks_a_literal_loopback_ip_over_http() {
        // Pre-existing behavior — confirms the new scheme check doesn't
        // regress the original literal-IP enforcement for http(s).
        let url = Url::parse("http://127.0.0.1/x").unwrap();
        assert!(!is_url_host_safe(&url));
    }

    #[test]
    fn redirect_decision_follows_a_public_target_within_the_hop_cap() {
        let url = Url::parse("https://example.com/next").unwrap();
        assert_eq!(redirect_decision(&url, 1), RedirectDecision::Follow);
        assert_eq!(redirect_decision(&url, 3), RedirectDecision::Follow);
    }

    #[test]
    fn redirect_decision_stops_past_the_hop_cap_even_for_a_safe_target() {
        let url = Url::parse("https://example.com/next").unwrap();
        assert_eq!(redirect_decision(&url, 4), RedirectDecision::StopAtCap);
    }

    #[test]
    fn redirect_decision_blocks_a_literal_loopback_target_within_the_hop_cap() {
        let url = Url::parse("http://127.0.0.1/nope").unwrap();
        assert_eq!(redirect_decision(&url, 1), RedirectDecision::Blocked);
    }

    #[test]
    fn redirect_decision_hop_cap_takes_priority_over_target_safety() {
        // Verifies branch order: past the cap, it stops regardless of
        // whether the target would also have been blocked.
        let url = Url::parse("http://127.0.0.1/nope").unwrap();
        assert_eq!(redirect_decision(&url, 4), RedirectDecision::StopAtCap);
    }

    #[tokio::test]
    async fn get_checked_reaches_a_mock_server_via_the_reserved_test_loopback_host() {
        // Proves the whole test-only seam actually works end to end: the
        // reserved hostname is an ordinary domain to is_url_host_safe (never
        // touches its literal-IP branch), so get_checked lets it through to
        // the resolver, which — only under #[cfg(test)] — hands back
        // loopback instead of doing a real DNS lookup. The mock server's
        // *own* bound port comes from the URL, not from the resolver (which
        // always answers with port 0, same as the production lookup_host
        // call above) — this test is itself the confirmation that reqwest
        // connects on the URL's port, not the resolver's.
        let app = axum::Router::new().route(
            "/",
            axum::routing::get(|| async { "reached via test seam" }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = build_http_client();
        let url = format!("http://{}:{}/", TEST_LOOPBACK_HOST, addr.port());
        let resp = get_checked(&client, &url)
            .await
            .expect("the reserved test hostname must resolve to loopback through get_checked");
        assert_eq!(resp.status(), reqwest::StatusCode::OK);
        assert_eq!(resp.text().await.unwrap(), "reached via test seam");
    }

    #[test]
    fn the_reserved_test_loopback_host_does_not_touch_the_literal_ip_branch() {
        // is_url_host_safe sees this hostname as an ordinary Host::Domain —
        // it never enters the Ipv4/Ipv6 branches that the literal-IP tests
        // above cover, so this seam cannot weaken that enforcement.
        let url = Url::parse(&format!("http://{TEST_LOOPBACK_HOST}/x")).unwrap();
        assert!(is_url_host_safe(&url));
    }

    #[tokio::test]
    async fn redirect_policy_blocks_a_redirect_to_a_different_loopback_target() {
        // Server B: the redirect target. If the policy is broken (e.g.
        // mutated to always Follow), this WILL be reached — that's what
        // makes this test mutation-proof, unlike a dead-port target which
        // fails the connection regardless of policy correctness.
        let server_b = axum::Router::new().route(
            "/should-never-be-reached",
            axum::routing::get(|| async { "reached server B" }),
        );
        let listener_b = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_b = listener_b.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener_b, server_b).await.unwrap();
        });

        // Server A: redirects to server B.
        let redirect_target = format!("http://{}/should-never-be-reached", addr_b);
        let server_a = axum::Router::new().route(
            "/redirect-to-loopback",
            axum::routing::get(move || {
                let target = redirect_target.clone();
                async move { axum::response::Redirect::temporary(&target) }
            }),
        );
        let listener_a = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_a = listener_a.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener_a, server_a).await.unwrap();
        });

        // Initial request goes through the RAW client, not get_checked —
        // deliberately. get_checked would block this mock server (itself
        // loopback) before any redirect could happen. Using the raw client
        // here still proves the redirect policy is real and wired: reqwest
        // invokes it regardless of how the initial request was sent.
        let client = build_http_client();
        let result = client
            .get(format!("http://{}/redirect-to-loopback", addr_a))
            .send()
            .await;
        assert!(
            result.is_err(),
            "a redirect landing on a different loopback target must be blocked \
             (if this fails, the request actually reached server B)"
        );
    }
}
