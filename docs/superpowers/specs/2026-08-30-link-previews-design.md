# Link Previews — Design

**Status:** approved, pending plan
**Sub-project:** Core messaging depth (2 of 3 remaining pieces) — first of link previews → uploads → threads

## Goal

Unfurl the first URL in a message into a preview card (title, description, image), the way Slack/Discord do, without ever letting the browser talk directly to an arbitrary third-party host, and without adding any new hot-path cost to sending or broadcasting messages.

## Scope

- One preview card per message, for the first URL only. A message with several links only ever gets one card — keeps rendering bounded and avoids a spammy wall of cards.
- Preview images are proxied through Grove's own backend, never loaded directly from the source host by the viewer's browser.
- No new WS message type, no change to the binary frame protocol. The preview is a pure client-side add-on that shows up after a message renders, never something the sender waits on or something riding the broadcast path.
- Out of scope for this pass: previews for edited-in URLs re-triggering re-fetch (edit already re-renders the message, which re-triggers extraction — that's enough), per-user dismiss persistence (dismiss is session-local only), previewing more than one URL per message.

## Architecture

```
Client renders message
  → extracts first URL from text (same regex family as the existing auto-linkify feature)
  → debounced POST /api/links/unfurl { url }
       → cache hit (fresh row in link_previews)?  return it, no fetch
       → cache miss/stale?  fetch the URL server-side, parse, cache, return
  → client renders LinkPreviewCard using the response
       → card's <img> points at GET /api/links/image-proxy?url_hash=...
       → browser fetches the image through Grove, never touching the source host directly
```

### Backend: unfurl endpoint

`POST /api/links/unfurl { url: string }`, JWT-auth'd like every other route.

1. Validate `url` parses and its scheme is `http`/`https` — reject anything else with `400`.
2. Compute `url_hash` = SHA-256 hex digest of the URL string, verbatim (no normalization beyond what's already been done client-side by the linkify pass — a query-string reorder double-caching is an acceptable v1 trade-off, not a correctness bug).
3. Look up `link_previews` by `url_hash`. If a row exists and `fetched_at` is within 24h, return it — no network call.
4. Otherwise, fetch the URL server-side through a shared `reqwest::Client` with:
   - A **per-connection IP check**, not just a URL-scheme check — resolve the hostname, reject if the resolved IP falls in any private/loopback/link-local/multicast/reserved range (including `169.254.169.254`, the cloud metadata address, and IPv4-mapped IPv6 literals unwrapped before checking). Pin the connection to the exact IP that was checked (`reqwest`'s `.resolve()` override) so a second DNS lookup between the check and the connect can't answer differently (DNS rebinding).
   - The same IP check applied to **every redirect hop** via a custom `redirect::Policy`, capped at 3 total redirects.
   - 5s timeout, response body capped at 2MB, `User-Agent: Grove/1.0`.
   - Reject non-`text/html` content types before reading the body.
5. On a successful HTML response, parse `<title>`, `<meta name="description">` / `og:description`, and `og:image` with a lightweight HTML parser (no JS execution — this is a static parse, matching what Slack/Discord's unfurlers do).
6. Upsert the `link_previews` row (title/description/image_url nullable — a page with none of the three still caches as "no metadata", so we don't refetch a dead/metadata-less URL on every message that references it within the TTL).
7. Rate-limited per user (`unfurl:{user_id}`, existing Lua limiter, 30/60s — generous for normal reading, bounds abuse).

**Response shape is uniform regardless of failure reason** — SSRF-blocked, timeout, DNS failure, non-HTML, oversized, or genuinely no metadata all collapse to the same `{ "available": false }`. This is the same pattern already used for invite codes (`join_by_code` returns a generic 404 for empty/malformed/nonexistent alike) — a distinguishable error for "blocked because internal" vs. "genuinely unreachable" would itself leak information about Grove's internal network topology to anyone probing it. Success returns `{ "available": true, "url_hash": "...", "title": "...", "description": "...", "has_image": bool }` — the server hands back the `url_hash` it computed so the client never has to (and can't get it wrong).

### Backend: image proxy

`GET /api/links/image-proxy?url_hash=<hash>` (JWT-auth'd).

Looks up `link_previews` by `url_hash`, 404s if no row or no `image_url` cached. Otherwise fetches `image_url` with the **identical** IP-pinning/redirect/timeout protections as the unfurl fetch (this is the important part — the client never gets to hand this endpoint an arbitrary URL, only a hash of something already vetted through the unfurl path above, so it can't become its own open SSRF relay). Streams the response through with `Content-Type` passed along and `Cache-Control: public, max-age=86400` so a viewer's browser only ever fetches a given image once. No server-side image storage — pure passthrough, re-fetched from the source on each cache-miss request. Own rate limit key (`imgproxy:{user_id}`, 60/60s).

### Data model

New migration `012_link_previews.sql`:

```sql
CREATE TABLE link_previews (
    url_hash    CHAR(64) PRIMARY KEY,
    url         TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    image_url   TEXT,
    fetched_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Global cache, not per-user — a URL's metadata doesn't depend on who's asking, so the first person anywhere on Grove to encounter a link is the only one who ever pays the fetch cost within a given 24h window.

### Frontend

- Extract the first URL from `m.text` using the same match semantics as the existing auto-linkify pass in `MessageRow/shared.tsx` (reuse, don't fork, the URL-matching regex).
- Trigger the unfurl fetch when the message row becomes visible, not on mount — reuse the `IntersectionObserver` already wired up for pagination in `MessageList.tsx` rather than firing a burst of unfurl calls the instant a long history loads. Debounced/deduplicated per URL so scrolling past the same link twice doesn't refetch.
- `LinkPreviewCard`: `surface-2` background, `r-sm` radius, `leaf` accent stripe, image via the proxy URL (capped height, `loading="lazy"`), title, 2-line-clamped description, a dismiss (×) button that hides the card for the rest of the session only (component-local state, not persisted — reappears on reload, which is fine for something this low-stakes).
- No card renders at all when `available: false` — not an error state, just nothing.

## Error handling

- Malformed/non-http(s) URL: `400`, never reaches the fetch layer.
- Any fetch failure for any reason: `200 { available: false }` (see uniform-response rationale above) — the frontend just renders nothing, no toast, no retry.
- Rate limited: `429`, frontend silently skips the card (same as any other rate-limited background call in this codebase).
- Image proxy on an unknown/stale hash: `404` — this is fine to distinguish (unlike the unfurl endpoint) because the input here is a `url_hash` the server itself minted, not an attacker-chosen URL; a 404 on a bad hash reveals nothing about any target URL's reachability.

## Testing

- **Unit tests, no network:** the IP-blocklist predicate (`is_public_ip`) tested exhaustively against literals covering every blocked range (loopback, RFC1918, link-local incl. `169.254.169.254`, CGNAT, multicast, IPv6 loopback/unique-local/link-local, IPv4-mapped-IPv6 unwrapping) plus a handful of real public IPs that must pass. The HTML-metadata parser tested against sample HTML strings directly (title-only, full OG tags, no metadata at all, malformed HTML) — a pure function, no HTTP involved.
- **Integration tests (`#[sqlx::test]`):** exercise the endpoint's cache-hit path by seeding `link_previews` directly (this is also the realistic common case — most requests in production hit the cache, not the network) — verifies the response shape, the 24h staleness boundary, and the uniform-failure-response contract. The live-fetch path itself is *not* integration-tested against a real network call — matches this codebase's existing discipline of never depending on real external network reachability in the test suite (Postgres and Redis are real in tests; the public internet isn't and shouldn't be).
- Rate limiting reuses the existing tested `check_rate_limit` helper — no new test needed there beyond confirming the key/limit/window values are wired correctly.

## Open items for the plan phase

None — this is small enough that the implementation plan can go straight to exact code, matching how the message-formatting plan was written.
