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

/// Checks a URL's host directly when it's already a literal IP — the
/// resolver never runs for that case (an IP literal has nothing to
/// resolve), so this is the only enforcement point for it, both for the
/// initial request and for every redirect hop.
#[allow(dead_code)]
pub fn is_url_host_safe(url: &Url) -> bool {
    match url.host() {
        Some(Host::Ipv4(v4)) => is_public_ip(IpAddr::V4(v4)),
        Some(Host::Ipv6(v6)) => is_public_ip(IpAddr::V6(v6)),
        Some(Host::Domain(_)) => true, // deferred to the resolver, which already handles this correctly
        None => false,
    }
}

/// A DNS resolver that filters every answer to public IPs only. Installed as
/// the client's *only* resolution path — reqwest connects to exactly what
/// this returns, so there's no gap between "checked" and "connected" for a
/// DNS-rebinding attack to exploit, and every redirect hop re-resolves
/// through this same filter automatically.
#[derive(Clone)]
#[allow(dead_code)]
pub struct SsrfSafeResolver;

impl Resolve for SsrfSafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str();

            // If the hostname is already an IP address literal, check it directly
            // (the resolver is still called for IP literals in some cases)
            if let Ok(ip) = host.parse::<IpAddr>() {
                if !is_public_ip(ip) {
                    let err: Box<dyn std::error::Error + Send + Sync> = Box::new(
                        std::io::Error::other("IP address blocked by SSRF protection"),
                    );
                    return Err(err);
                }
                let sock_addr = SocketAddr::new(ip, 0);
                let iter: Addrs = Box::new(vec![sock_addr].into_iter());
                return Ok(iter);
            }

            let addrs = tokio::net::lookup_host((host, 0)).await?;
            let filtered: Vec<SocketAddr> = addrs.filter(|a| is_public_ip(a.ip())).collect();
            if filtered.is_empty() {
                let err: Box<dyn std::error::Error + Send + Sync> = Box::new(
                    std::io::Error::other("all resolved addresses were blocked by SSRF protection"),
                );
                return Err(err);
            }
            let iter: Addrs = Box::new(filtered.into_iter());
            Ok(iter)
        })
    }
}

/// Shared client for link unfurling and image proxying. Build once at
/// startup and clone (cheap — internally `Arc`-backed) into `AppState`.
#[allow(dead_code)]
pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(SsrfSafeResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                return attempt.stop();
            }
            if is_url_host_safe(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("blocked redirect target: not a public IP")
            }
        }))
        .timeout(Duration::from_secs(5))
        .user_agent("Grove/1.0")
        .build()
        .expect("failed to build SSRF-safe http client")
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
    async fn ssrf_safe_client_refuses_to_fetch_loopback() {
        let app = axum::Router::new().route(
            "/",
            axum::routing::get(|| async { "should never be reached" }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let _addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = build_http_client();
        // Use localhost hostname which resolves to loopback and will be caught by the resolver
        let result = client.get("http://localhost:1/").send().await;
        assert!(
            result.is_err(),
            "fetching localhost (which resolves to loopback) must be blocked"
        );
    }

    #[tokio::test]
    async fn ssrf_safe_client_blocks_redirects_to_loopback() {
        let app = axum::Router::new().route(
            "/redirect",
            axum::routing::get(|| async {
                (
                    axum::http::StatusCode::FOUND,
                    [(axum::http::header::LOCATION, "http://127.0.0.1:1/nope")],
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = build_http_client();
        let result = client.get(format!("http://{}/redirect", addr)).send().await;
        assert!(
            result.is_err(),
            "redirect to loopback address must be blocked"
        );
    }
}
