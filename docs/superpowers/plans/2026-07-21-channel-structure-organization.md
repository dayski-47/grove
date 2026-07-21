# Channel Structure & Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add channel descriptions, freeform categories, private channels with invite-code joining, and a three-tier role system (owner/moderator/member) to Grove — the first sub-project of the "Grove vs Slack/Discord" feature-parity overhaul.

**Architecture:** Backend (`chat_server/`): one migration extends `channels`/`channel_members`; seven new/modified REST endpoints; a new `RoleCache` Redis module mirrors the existing `PresenceTracker` pattern so role checks stay a single Redis read on the hottest paths (message delete, kick); the WS `DELETE` handler gains an owner/moderator bypass of the existing author-only check. Frontend (`grove_client/`): a new `ChannelSettingsModal.tsx` component (Overview + Members sections — the first modal in the app, using the already-defined-but-unused `--z-modal` token) handles all structured management; the Ctrl+K palette gains two new actions (grouped category browsing, join-by-code) without altering its existing recents/search behavior; `AppShell.tsx`'s channel-creation flow gains category/privacy fields.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL/Redis (backend), React 19/TypeScript/Vite (frontend). New backend dependency: `rand` (invite code generation). No new frontend dependencies.

## Global Constraints

- All role/ownership checks are enforced **server-side** on every request — the client UI hiding an action is a convenience, never the access boundary.
- `category` is a plain freeform `VARCHAR` column, no separate table — the client autocompletes against distinct existing values.
- `invite_code` is only ever set while `is_private = true`; regenerating overwrites it in place (no grace period); toggling private→public clears it.
- Role checks on hot paths (message delete, kick) read a Redis hash (`channel:{id}:roles`), never a Postgres round-trip per action — mirrors the existing membership-set caching pattern (`channel:{id}:members`, a Redis `SET`), implemented as a **sibling hash key**, not a replacement of the existing set (the existing set has many call sites via `SISMEMBER`/`sismember` that must keep working unchanged).
- Message **deletion** gains an owner/moderator bypass of its existing author-only check (`database::messages::delete_message` currently requires `user_id = <author>`). Message **editing** is unaffected — author-only, unchanged. Message **pinning** is unaffected — it's already open to any member and stays that way.
- Backend testing: this project has zero existing test infrastructure in `chat_server` (confirmed — no `tests/` dir, no `#[test]`/`#[tokio::test]` anywhere). Per explicit instruction to use the production-standard approach, this plan adds `#[sqlx::test]`-based integration tests (sqlx's built-in per-test ephemeral-database + auto-migration mechanism — the standard, low-friction way to test an sqlx-backed Rust service, requiring no additional test infrastructure beyond the Postgres already running in this project's `docker-compose.prod.yml`) for every new/modified endpoint, with particular attention to permission-boundary cases. Redis-only logic (the `RoleCache` module itself) follows this codebase's existing precedent of not unit-testing Redis interactions directly (`PresenceTracker` isn't tested either) — it's verified indirectly through the `#[sqlx::test]` coverage of the endpoints that use it, plus manual verification.
- Frontend testing: `grove_client` has no test framework (established project-wide convention) — `tsc -b` + `eslint` + `npm run build` + manual browser check substitute.
- `cargo fmt` + `cargo clippy` before every backend commit, per this project's standing rule.
- Frontend TS interfaces mirror backend JSON field names exactly (snake_case, e.g. `is_private`, `invite_code`) — matching this codebase's existing convention (see `DmInfo.partner_id`, `DmInfo.channel_id` in `grove_client/src/types.ts`), not camelCase conversion.

---

### Task 1: Migration + Cargo.toml dependencies

**Files:**
- Create: `chat_server/migrations/011_channel_roles.sql`
- Modify: `chat_server/Cargo.toml`

**Interfaces:**
- Produces: `channels.description`, `channels.category`, `channels.is_private`, `channels.invite_code` columns; `channel_members.role` column (`'owner' | 'moderator' | 'member'`, default `'member'`). All later tasks depend on this schema.

- [ ] **Step 1: Write the migration**

Create `chat_server/migrations/011_channel_roles.sql`:

```sql
-- Channel structure & organization: descriptions, freeform categories,
-- private channels with invite codes, and per-member roles.

ALTER TABLE channels
    ADD COLUMN description VARCHAR(500),
    ADD COLUMN category    VARCHAR(100),
    ADD COLUMN is_private  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN invite_code VARCHAR(12) UNIQUE;

CREATE INDEX idx_channels_category ON channels(category);

ALTER TABLE channel_members
    ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member';
```

- [ ] **Step 2: Add the `rand` dependency and the sqlx `migrate` feature**

In `chat_server/Cargo.toml`, find:

```toml
sqlx = { version = "0.9.0", features = ["postgres", "runtime-tokio", "tls-native-tls", "macros"] }
```

Replace with:

```toml
sqlx = { version = "0.9.0", features = ["postgres", "runtime-tokio", "tls-native-tls", "macros", "migrate"] }
```

Then add a new line under the `[dependencies]` section (anywhere after the `sqlx` line is fine):

```toml
rand = "0.9"
```

- [ ] **Step 3: Verify the migration applies**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo build 2>&1 | tail -20
```

Expected: builds successfully (migrations run automatically at server startup via whatever existing migration-runner call exists — this step only needs to confirm the new dependency versions resolve; the migration itself is exercised for real in Task 2's `#[sqlx::test]` setup, which runs migrations against an ephemeral test database).

- [ ] **Step 4: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/migrations/011_channel_roles.sql chat_server/Cargo.toml chat_server/Cargo.lock
git commit -m "feat: add channel description/category/privacy/role schema"
```

---

### Task 2: sqlx test harness smoke test

**Files:**
- Modify: `chat_server/src/database/messages.rs` (add a `#[cfg(test)]` module at the bottom)

**Interfaces:**
- Produces: proof that `#[sqlx::test]` works in this project (ephemeral per-test database, migrations auto-applied) — every later backend task's tests depend on this pattern working.

- [ ] **Step 1: Write a smoke test**

At the bottom of `chat_server/src/database/messages.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn inserts_and_reads_back_a_message(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;

        let msg_id = insert_message(&pool, channel_id as u64, user_id as u64, "hello", 1000)
            .await
            .expect("insert_message should succeed");

        let text: String = sqlx::query_scalar("SELECT text FROM messages WHERE id = $1")
            .bind(msg_id as i64)
            .fetch_one(&pool)
            .await?;
        assert_eq!(text, "hello");
        Ok(())
    }
}
```

- [ ] **Step 2: Run it**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test inserts_and_reads_back_a_message -- --nocapture 2>&1 | tail -40
```

Expected: `test database::messages::tests::inserts_and_reads_back_a_message ... ok`. This requires `DATABASE_URL` to point at a reachable Postgres server with permission to create databases (the same Postgres this project already runs via `docker-compose.prod.yml` — if it isn't already running, start it with `docker compose -f /home/richtofen/projects/grovefolder/docker-compose.prod.yml up -d db` first). `#[sqlx::test]` creates a fresh, uniquely-named database per test run and applies all migrations in `chat_server/migrations/` automatically — no manual test-DB setup needed beyond a reachable server.

- [ ] **Step 3: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/database/messages.rs
git commit -m "test: add sqlx::test smoke test, confirms ephemeral test-DB harness works"
```

---

### Task 3: Invite code generator

**Files:**
- Create: `chat_server/src/api/invite_code.rs`
- Modify: `chat_server/src/api/mod.rs:1-5` (add `pub mod invite_code;`)

**Interfaces:**
- Produces: `generate_invite_code() -> String` — an 10-character, URL-safe, random code (`[A-Za-z0-9]`). Consumed by Task 5 (`create_channel`) and Task 7 (`regenerate_invite_code`).

- [ ] **Step 1: Write the generator**

Create `chat_server/src/api/invite_code.rs`:

```rust
use rand::Rng;

const CODE_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LEN: usize = 10;

/// Generates a random, URL-safe invite code (10 alphanumeric characters).
pub fn generate_invite_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LEN)
        .map(|_| {
            let idx = rng.random_range(0..CODE_CHARS.len());
            CODE_CHARS[idx] as char
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_a_code_of_the_expected_length() {
        let code = generate_invite_code();
        assert_eq!(code.len(), CODE_LEN);
    }

    #[test]
    fn generates_only_alphanumeric_characters() {
        let code = generate_invite_code();
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn generates_different_codes_across_calls() {
        let a = generate_invite_code();
        let b = generate_invite_code();
        // Not a strict guarantee, but a collision here (10 chars, 62-symbol
        // alphabet, 2 samples) is astronomically unlikely and would indicate
        // a broken RNG rather than bad luck.
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 2: Register the module**

In `chat_server/src/api/mod.rs`, find:

```rust
pub mod auth;
pub mod messages;
pub mod ratelimit;
pub mod server;
pub mod validation;
```

Replace with:

```rust
pub mod auth;
pub mod invite_code;
pub mod messages;
pub mod ratelimit;
pub mod server;
pub mod validation;
```

- [ ] **Step 3: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test invite_code:: -- --nocapture 2>&1 | tail -20
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/invite_code.rs chat_server/src/api/mod.rs
git commit -m "feat: add invite code generator"
```

---

### Task 4: `RoleCache` Redis module

**Files:**
- Create: `chat_server/src/cache/roles.rs`
- Modify: `chat_server/src/cache/mod.rs:1-2` (register module)
- Modify: `chat_server/src/api/mod.rs` (add `roles: RoleCache` field to `AppState`)
- Modify: `chat_server/src/main.rs` (construct and wire in `RoleCache`)

**Interfaces:**
- Produces: `RoleCache::set_role(channel_id, user_id, role: &str)`, `RoleCache::get_role(channel_id, user_id) -> String` (defaults to `"member"` on cache miss or Redis error — least-privilege default), `RoleCache::remove_role(channel_id, user_id)`. Consumed by every task from Task 5 onward that needs a role check.

- [ ] **Step 1: Write the module**

Create `chat_server/src/cache/roles.rs`, mirroring the existing `PresenceTracker` pattern in `chat_server/src/cache/presence.rs`:

```rust
use redis::{AsyncCommands, aio::ConnectionManager};

#[derive(Clone)]
pub struct RoleCache {
    conn: ConnectionManager,
}

impl RoleCache {
    pub fn new(conn: ConnectionManager) -> Self {
        Self { conn }
    }

    pub async fn set_role(
        &self,
        channel_id: i64,
        user_id: i64,
        role: &str,
    ) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        con.hset(format!("channel:{}:roles", channel_id), user_id, role)
            .await
    }

    /// Defaults to "member" on cache miss or Redis error — least-privilege
    /// fallback, matching this project's existing fail-closed security posture
    /// (see the JWT blocklist check in `api/mod.rs`).
    pub async fn get_role(&self, channel_id: i64, user_id: i64) -> String {
        let mut con = self.conn.clone();
        con.hget::<_, _, Option<String>>(format!("channel:{}:roles", channel_id), user_id)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "member".to_string())
    }

    pub async fn remove_role(&self, channel_id: i64, user_id: i64) -> Result<(), redis::RedisError> {
        let mut con = self.conn.clone();
        let _: () = con
            .hdel(format!("channel:{}:roles", channel_id), user_id)
            .await?;
        Ok(())
    }
}
```

- [ ] **Step 2: Register the module**

In `chat_server/src/cache/mod.rs`, find:

```rust
pub mod batch;
pub mod presence;
```

Replace with:

```rust
pub mod batch;
pub mod presence;
pub mod roles;
```

- [ ] **Step 3: Wire into `AppState`**

In `chat_server/src/api/mod.rs`, find:

```rust
use crate::api::auth::Claims;
use crate::cache::presence::PresenceTracker;
```

Replace with:

```rust
use crate::api::auth::Claims;
use crate::cache::presence::PresenceTracker;
use crate::cache::roles::RoleCache;
```

Then find:

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub jwt_secret: String,
    pub presence: PresenceTracker,
}
```

Replace with:

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub jwt_secret: String,
    pub presence: PresenceTracker,
    pub roles: RoleCache,
}
```

- [ ] **Step 4: Construct it in `main.rs`**

In `chat_server/src/main.rs`, find:

```rust
    let presence = cache::presence::PresenceTracker::new(redis_conn.clone());

    let app_state = api::AppState {
        db: db_pool,
        redis: redis_conn,
        jwt_secret,
        presence,
    };
```

Replace with:

```rust
    let presence = cache::presence::PresenceTracker::new(redis_conn.clone());
    let roles = cache::roles::RoleCache::new(redis_conn.clone());

    let app_state = api::AppState {
        db: db_pool,
        redis: redis_conn,
        jwt_secret,
        presence,
        roles,
    };
```

- [ ] **Step 5: Build**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo build 2>&1 | tail -30
```

Expected: builds with no errors (this module has no direct tests per the Global Constraints note — it's exercised indirectly by later tasks' `#[sqlx::test]`s once role-setting is wired into real endpoints).

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/cache/roles.rs chat_server/src/cache/mod.rs chat_server/src/api/mod.rs chat_server/src/main.rs
git commit -m "feat: add RoleCache Redis module, wire into AppState"
```

---

### Task 5: Extend `create_channel`

**Files:**
- Modify: `chat_server/src/api/messages.rs:50-58` (`CreateChannelRequest`/`CreateChannelResponse`)
- Modify: `chat_server/src/api/messages.rs:167-226` (`create_channel`)

**Interfaces:**
- Consumes: `generate_invite_code()` (Task 3), `state.roles.set_role()` (Task 4).
- Produces: `CreateChannelRequest { name, description: Option<String>, category: Option<String>, is_private: bool }`, `CreateChannelResponse { channel_id, invite_code: Option<String> }`.

- [ ] **Step 1: Extend the request/response types**

In `chat_server/src/api/messages.rs`, find:

```rust
#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateChannelResponse {
    pub channel_id: i64,
}
```

Replace with:

```rust
#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub is_private: bool,
}

#[derive(Serialize)]
pub struct CreateChannelResponse {
    pub channel_id: i64,
    pub invite_code: Option<String>,
}
```

- [ ] **Step 2: Update `create_channel`**

Find the full `create_channel` function (`chat_server/src/api/messages.rs:167-226`) and replace it with:

```rust
pub async fn create_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<Json<CreateChannelResponse>, (StatusCode, String)> {
    validate_channel_name(&req.name)?;
    let description = req.description.map(|d| d.chars().take(500).collect::<String>());
    let category = req.category.map(|c| c.chars().take(100).collect::<String>());
    let invite_code = if req.is_private {
        Some(crate::api::invite_code::generate_invite_code())
    } else {
        None
    };

    let mut tx = state.db.begin().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    let channel_id: i64 = sqlx::query_scalar(
        "INSERT INTO channels (name, description, category, is_private, invite_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(req.name.trim())
    .bind(&description)
    .bind(&category)
    .bind(req.is_private)
    .bind(&invite_code)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    tx.commit().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;

    // Seed Redis membership + role after successful commit.
    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con.sadd(&key, auth.user_id).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server error".to_string(),
        )
    })?;
    state
        .roles
        .set_role(channel_id, auth.user_id, "owner")
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Server error".to_string(),
            )
        })?;

    Ok(Json(CreateChannelResponse {
        channel_id,
        invite_code,
    }))
}
```

- [ ] **Step 3: Write the test**

At the bottom of `chat_server/src/api/messages.rs`, add (create the module if it doesn't exist yet — it doesn't, this is the first test in this file):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    async fn make_app_state(pool: sqlx::PgPool) -> Arc<AppState> {
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let redis = crate::cache::connect_redis(&redis_url)
            .await
            .expect("Redis must be reachable for this test — start it via docker-compose.prod.yml");
        Arc::new(AppState {
            db: pool,
            redis: redis.clone(),
            jwt_secret: "test-secret-at-least-32-bytes-long!!".to_string(),
            presence: crate::cache::presence::PresenceTracker::new(redis.clone()),
            roles: crate::cache::roles::RoleCache::new(redis),
        })
    }

    #[sqlx::test]
    async fn creates_a_public_channel_with_no_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        let auth = AuthenticatedUser { user_id: 1 };
        // Seed a user row so the FK on channel_members is satisfiable.
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;

        let req = CreateChannelRequest {
            name: "general".to_string(),
            description: Some("General chat".to_string()),
            category: Some("Community".to_string()),
            is_private: false,
        };
        let result = create_channel(auth, State(state.clone()), Json(req)).await;
        let Ok(Json(resp)) = result else {
            panic!("create_channel should succeed");
        };
        assert!(resp.invite_code.is_none());

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 1",
        )
        .bind(resp.channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "owner");
        Ok(())
    }

    #[sqlx::test]
    async fn creates_a_private_channel_with_an_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        let auth = AuthenticatedUser { user_id: 1 };
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;

        let req = CreateChannelRequest {
            name: "secret-plans".to_string(),
            description: None,
            category: None,
            is_private: true,
        };
        let result = create_channel(auth, State(state), Json(req)).await;
        let Ok(Json(resp)) = result else {
            panic!("create_channel should succeed");
        };
        assert!(resp.invite_code.is_some());
        assert_eq!(resp.invite_code.unwrap().len(), 10);
        Ok(())
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -40
```

Expected: both tests pass (requires Redis reachable — start via `docker compose -f /home/richtofen/projects/grovefolder/docker-compose.prod.yml up -d redis` if not already running).

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

Expected: clean (fix anything flagged before proceeding).

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs
git commit -m "feat: extend create_channel with description/category/privacy/owner role"
```

---

### Task 6: `update_channel` (PATCH)

**Files:**
- Modify: `chat_server/src/api/messages.rs` (new types + handler, add near `create_channel`)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Consumes: `generate_invite_code()` (Task 3), `state.roles.get_role()` (Task 4).
- Produces: `PATCH /api/channels/:id` handler `update_channel`.

- [ ] **Step 1: Add the request type and handler**

In `chat_server/src/api/messages.rs`, add after `create_channel` (before `get_history`):

```rust
#[derive(Deserialize)]
pub struct UpdateChannelRequest {
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_private: Option<bool>,
}

#[derive(Serialize)]
pub struct UpdateChannelResponse {
    pub invite_code: Option<String>,
}

pub async fn update_channel(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
    Json(req): Json<UpdateChannelRequest>,
) -> Result<Json<UpdateChannelResponse>, StatusCode> {
    let role = state.roles.get_role(channel_id, auth.user_id).await;
    if role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    let current_private: bool = sqlx::query_scalar("SELECT is_private FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let next_private = req.is_private.unwrap_or(current_private);
    let invite_code = if next_private && !current_private {
        Some(crate::api::invite_code::generate_invite_code())
    } else if !next_private {
        None
    } else {
        // Staying private and no explicit toggle — leave the existing code alone.
        sqlx::query_scalar("SELECT invite_code FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };

    let description = req
        .description
        .map(|d| d.chars().take(500).collect::<String>());
    let category = req.category.map(|c| c.chars().take(100).collect::<String>());

    sqlx::query(
        "UPDATE channels SET
            description = COALESCE($1, description),
            category    = COALESCE($2, category),
            is_private  = $3,
            invite_code = $4
         WHERE id = $5",
    )
    .bind(&description)
    .bind(&category)
    .bind(next_private)
    .bind(&invite_code)
    .bind(channel_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(UpdateChannelResponse { invite_code }))
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_channel, list_channels, list_dms, list_friends, open_dm,
    pin_message, remove_friend, search_users, unpin_message, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_channel, list_channels, list_dms, list_friends, open_dm,
    pin_message, remove_friend, search_users, unpin_message, update_channel, update_my_profile,
};
```

Then find:

```rust
        .route("/api/channels/create", post(create_channel))
```

Replace with:

```rust
        .route("/api/channels/create", post(create_channel))
        .route("/api/channels/{id}", axum::routing::patch(update_channel))
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs` (reuses the `make_app_state` helper from Task 5):

```rust
    #[sqlx::test]
    async fn owner_can_update_description_and_category(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let req = UpdateChannelRequest {
            description: Some("Updated description".to_string()),
            category: Some("Ops".to_string()),
            is_private: None,
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        assert!(result.is_ok());

        let (description, category): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT description, category FROM channels WHERE id = $1",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(description.as_deref(), Some("Updated description"));
        assert_eq!(category.as_deref(), Some("Ops"));
        Ok(())
    }

    #[sqlx::test]
    async fn non_owner_cannot_update_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        // No role cached — RoleCache::get_role defaults to "member", correctly denying access.

        let req = UpdateChannelRequest {
            description: Some("Hijacked".to_string()),
            category: None,
            is_private: None,
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
        Ok(())
    }

    #[sqlx::test]
    async fn toggling_to_private_generates_an_invite_code(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let req = UpdateChannelRequest {
            description: None,
            category: None,
            is_private: Some(true),
        };
        let result = update_channel(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
            Json(req),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("update_channel should succeed");
        };
        assert!(resp.invite_code.is_some());
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

Expected: all tests (from this task and Task 5) pass.

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add PATCH /api/channels/:id (owner-only settings update)"
```

---

### Task 7: Invite code regeneration

**Files:**
- Modify: `chat_server/src/api/messages.rs` (handler)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Produces: `POST /api/channels/:id/invite-code/regenerate` handler `regenerate_invite_code`.

- [ ] **Step 1: Add the handler**

In `chat_server/src/api/messages.rs`, add after `update_channel`:

```rust
#[derive(Serialize)]
pub struct RegenerateInviteCodeResponse {
    pub invite_code: String,
}

pub async fn regenerate_invite_code(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
) -> Result<Json<RegenerateInviteCodeResponse>, StatusCode> {
    let role = state.roles.get_role(channel_id, auth.user_id).await;
    if role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    let is_private: bool = sqlx::query_scalar("SELECT is_private FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !is_private {
        return Err(StatusCode::BAD_REQUEST);
    }

    let new_code = crate::api::invite_code::generate_invite_code();
    sqlx::query("UPDATE channels SET invite_code = $1 WHERE id = $2")
        .bind(&new_code)
        .bind(channel_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(RegenerateInviteCodeResponse {
        invite_code: new_code,
    }))
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_channel, list_channels, list_dms, list_friends, open_dm,
    pin_message, remove_friend, search_users, unpin_message, update_channel, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_channel, list_channels, list_dms, list_friends, open_dm,
    pin_message, regenerate_invite_code, remove_friend, search_users, unpin_message,
    update_channel, update_my_profile,
};
```

Then find:

```rust
        .route("/api/channels/{id}", axum::routing::patch(update_channel))
```

Replace with:

```rust
        .route("/api/channels/{id}", axum::routing::patch(update_channel))
        .route(
            "/api/channels/{id}/invite-code/regenerate",
            post(regenerate_invite_code),
        )
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn owner_can_regenerate_invite_code_for_private_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'oldcode123') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = regenerate_invite_code(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path(channel_id),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("regenerate_invite_code should succeed");
        };
        assert_ne!(resp.invite_code, "oldcode123");

        let stored: Option<String> = sqlx::query_scalar("SELECT invite_code FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&state.db)
            .await?;
        assert_eq!(stored, Some(resp.invite_code));
        Ok(())
    }

    #[sqlx::test]
    async fn cannot_regenerate_invite_code_for_public_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = regenerate_invite_code(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::BAD_REQUEST);
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add invite code regeneration endpoint"
```

---

### Task 8: Join by invite code

**Files:**
- Modify: `chat_server/src/api/messages.rs` (handler)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Produces: `POST /api/channels/join-by-code` handler `join_by_code`.

- [ ] **Step 1: Add the handler**

In `chat_server/src/api/messages.rs`, add after `regenerate_invite_code`:

```rust
#[derive(Deserialize)]
pub struct JoinByCodeRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct JoinByCodeResponse {
    pub channel_id: i64,
    pub name: String,
}

pub async fn join_by_code(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<JoinByCodeRequest>,
) -> Result<Json<JoinByCodeResponse>, StatusCode> {
    let code = req.code.trim();
    if code.is_empty() || code.len() > 12 {
        return Err(StatusCode::NOT_FOUND);
    }

    let channel: Option<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM channels WHERE invite_code = $1 AND is_private = TRUE")
            .bind(code)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Generic 404 either way — never reveal whether a code format was ever valid.
    let (channel_id, name) = channel.ok_or(StatusCode::NOT_FOUND)?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con
        .sadd(&key, auth.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .roles
        .set_role(channel_id, auth.user_id, "member")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(JoinByCodeResponse { channel_id, name }))
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_channel, list_channels, list_dms, list_friends, open_dm,
    pin_message, regenerate_invite_code, remove_friend, search_users, unpin_message,
    update_channel, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_by_code, join_channel, list_channels, list_dms, list_friends,
    open_dm, pin_message, regenerate_invite_code, remove_friend, search_users, unpin_message,
    update_channel, update_my_profile,
};
```

Then find:

```rust
        .route("/api/channels/join", post(join_channel))
```

Replace with:

```rust
        .route("/api/channels/join", post(join_channel))
        .route("/api/channels/join-by-code", post(join_by_code))
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn valid_code_joins_the_channel(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret', TRUE, 'joincode12') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;

        let result = join_by_code(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            Json(JoinByCodeRequest { code: "joincode12".to_string() }),
        )
        .await;
        let Ok(Json(resp)) = result else {
            panic!("join_by_code should succeed");
        };
        assert_eq!(resp.channel_id, channel_id);

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 2",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "member");
        Ok(())
    }

    #[sqlx::test]
    async fn invalid_code_returns_generic_not_found(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;

        let result = join_by_code(
            AuthenticatedUser { user_id: 2 },
            State(state),
            Json(JoinByCodeRequest { code: "doesnotexist".to_string() }),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::NOT_FOUND);
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add join-by-invite-code endpoint"
```

---

### Task 9: Extend `list_channels` (fields + private filtering)

**Files:**
- Modify: `chat_server/src/api/messages.rs:88-92` (`ChannelInfo`)
- Modify: `chat_server/src/api/messages.rs:326-337` (`list_channels`)

**Interfaces:**
- Produces: `ChannelInfo { id, name, description: Option<String>, category: Option<String>, is_private: bool }`. Non-members no longer see private channels they haven't joined.

- [ ] **Step 1: Extend `ChannelInfo`**

Find:

```rust
#[derive(Serialize, sqlx::FromRow)]
pub struct ChannelInfo {
    pub id: i64,
    pub name: String,
}
```

Replace with:

```rust
#[derive(Serialize, sqlx::FromRow)]
pub struct ChannelInfo {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_private: bool,
}
```

- [ ] **Step 2: Update `list_channels`**

Find:

```rust
pub async fn list_channels(
    _auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ChannelInfo>>, StatusCode> {
    let channels = sqlx::query_as::<_, ChannelInfo>(
        "SELECT id, name FROM channels WHERE NOT is_dm ORDER BY id ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(channels))
}
```

Replace with:

```rust
pub async fn list_channels(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ChannelInfo>>, StatusCode> {
    let channels = sqlx::query_as::<_, ChannelInfo>(
        "SELECT c.id, c.name, c.description, c.category, c.is_private
         FROM channels c
         WHERE NOT c.is_dm
           AND (NOT c.is_private OR EXISTS (
               SELECT 1 FROM channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $1
           ))
         ORDER BY c.id ASC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(channels))
}
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn list_channels_hides_private_channels_from_non_members(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        sqlx::query("INSERT INTO channels (name, is_private) VALUES ('public-chan', FALSE)")
            .execute(&state.db)
            .await?;
        let private_id: i64 = sqlx::query_scalar(
            "INSERT INTO channels (name, is_private, invite_code) VALUES ('secret-chan', TRUE, 'abc1234567') RETURNING id",
        )
        .fetch_one(&state.db)
        .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner')")
            .bind(private_id)
            .execute(&state.db)
            .await?;

        let as_member = list_channels(AuthenticatedUser { user_id: 1 }, State(state.clone())).await;
        let Ok(Json(member_view)) = as_member else { panic!("should succeed") };
        assert_eq!(member_view.len(), 2, "owner sees both channels");

        let as_outsider = list_channels(AuthenticatedUser { user_id: 2 }, State(state)).await;
        let Ok(Json(outsider_view)) = as_outsider else { panic!("should succeed") };
        assert_eq!(outsider_view.len(), 1, "non-member only sees the public channel");
        assert_eq!(outsider_view[0].name, "public-chan");
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs
git commit -m "feat: list_channels excludes private channels the caller isn't in"
```

---

### Task 10: Member list endpoint

**Files:**
- Modify: `chat_server/src/api/messages.rs` (types + handler)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Produces: `GET /api/channels/:id/members` handler `get_channel_members`, response `Vec<MemberInfo>` where `MemberInfo { user_id, username, role }`.

- [ ] **Step 1: Add the handler**

In `chat_server/src/api/messages.rs`, add after `join_by_code`:

```rust
#[derive(Serialize, sqlx::FromRow)]
pub struct MemberInfo {
    pub user_id: i64,
    pub username: String,
    pub role: String,
}

pub async fn get_channel_members(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(channel_id): axum::extract::Path<i64>,
) -> Result<Json<Vec<MemberInfo>>, StatusCode> {
    assert_channel_member(&state.redis, channel_id, auth.user_id).await?;

    let members = sqlx::query_as::<_, MemberInfo>(
        "SELECT u.id AS user_id, u.username, cm.role
         FROM channel_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.channel_id = $1
         ORDER BY
             CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
             u.username ASC",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(members))
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_online, get_channel_pins, get_channel_reactions,
    get_history, get_user, join_by_code, join_channel, list_channels, list_dms, list_friends,
    open_dm, pin_message, regenerate_invite_code, remove_friend, search_users, unpin_message,
    update_channel, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, list_channels,
    list_dms, list_friends, open_dm, pin_message, regenerate_invite_code, remove_friend,
    search_users, unpin_message, update_channel, update_my_profile,
};
```

Then find:

```rust
        .route(
            "/api/channels/{id}/invite-code/regenerate",
            post(regenerate_invite_code),
        )
```

Replace with:

```rust
        .route(
            "/api/channels/{id}/invite-code/regenerate",
            post(regenerate_invite_code),
        )
        .route("/api/channels/{id}/members", get(get_channel_members))
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn returns_members_ordered_owner_first(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'member'), ($1, 1, 'owner')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        let key = format!("channel:{}:members", channel_id);
        let mut con = state.redis.clone();
        let _: () = redis::AsyncCommands::sadd(&mut con, &key, vec![1i64, 2i64]).await.unwrap();

        let result = get_channel_members(
            AuthenticatedUser { user_id: 1 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        let Ok(Json(members)) = result else { panic!("should succeed") };
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].username, "alice");
        assert_eq!(members[0].role, "owner");
        Ok(())
    }

    #[sqlx::test]
    async fn non_member_cannot_list_members(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;

        let result = get_channel_members(
            AuthenticatedUser { user_id: 3 },
            State(state),
            axum::extract::Path(channel_id),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add GET /api/channels/:id/members"
```

---

### Task 11: Promote/demote member role

**Files:**
- Modify: `chat_server/src/api/messages.rs` (types + handler)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Produces: `POST /api/channels/:id/members/:user_id/role` handler `update_member_role`, body `{ role: "moderator" | "member" }`.

- [ ] **Step 1: Add the handler**

In `chat_server/src/api/messages.rs`, add after `get_channel_members`:

```rust
#[derive(Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

pub async fn update_member_role(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path((channel_id, target_user_id)): axum::extract::Path<(i64, i64)>,
    Json(req): Json<UpdateMemberRoleRequest>,
) -> Result<StatusCode, StatusCode> {
    if req.role != "moderator" && req.role != "member" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let caller_role = state.roles.get_role(channel_id, auth.user_id).await;
    if caller_role != "owner" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_user_id == auth.user_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let rows = sqlx::query(
        "UPDATE channel_members SET role = $1 WHERE channel_id = $2 AND user_id = $3 AND role != 'owner'",
    )
    .bind(&req.role)
    .bind(channel_id)
    .bind(target_user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .rows_affected();

    if rows == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    state
        .roles
        .set_role(channel_id, target_user_id, &req.role)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, list_channels,
    list_dms, list_friends, open_dm, pin_message, regenerate_invite_code, remove_friend,
    search_users, unpin_message, update_channel, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, list_channels,
    list_dms, list_friends, open_dm, pin_message, regenerate_invite_code, remove_friend,
    search_users, unpin_message, update_channel, update_member_role, update_my_profile,
};
```

Then find:

```rust
        .route("/api/channels/{id}/members", get(get_channel_members))
```

Replace with:

```rust
        .route("/api/channels/{id}/members", get(get_channel_members))
        .route(
            "/api/channels/{id}/members/{user_id}/role",
            post(update_member_role),
        )
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn owner_can_promote_member_to_moderator(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();

        let result = update_member_role(
            AuthenticatedUser { user_id: 1 },
            State(state.clone()),
            axum::extract::Path((channel_id, 2)),
            Json(UpdateMemberRoleRequest { role: "moderator".to_string() }),
        )
        .await;
        assert_eq!(result, Ok(StatusCode::OK));

        let role: String = sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = 2",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(role, "moderator");
        assert_eq!(state.roles.get_role(channel_id, 2).await, "moderator");
        Ok(())
    }

    #[sqlx::test]
    async fn moderator_cannot_promote_anyone(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h'), (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'moderator'), ($1, 3, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 2, "moderator").await.unwrap();

        let result = update_member_role(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path((channel_id, 3)),
            Json(UpdateMemberRoleRequest { role: "moderator".to_string() }),
        )
        .await;
        assert_eq!(result, Err(StatusCode::FORBIDDEN));
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add owner-only member promote/demote endpoint"
```

---

### Task 12: Kick member

**Files:**
- Modify: `chat_server/src/api/messages.rs` (handler)
- Modify: `chat_server/src/api/server.rs` (route)

**Interfaces:**
- Consumes: `state.roles.get_role()`, `state.roles.remove_role()` (Task 4).
- Produces: `DELETE /api/channels/:id/members/:user_id` handler `kick_member`.

- [ ] **Step 1: Add the handler**

In `chat_server/src/api/messages.rs`, add after `update_member_role`:

```rust
pub async fn kick_member(
    auth: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    axum::extract::Path((channel_id, target_user_id)): axum::extract::Path<(i64, i64)>,
) -> Result<StatusCode, StatusCode> {
    let caller_role = state.roles.get_role(channel_id, auth.user_id).await;
    if caller_role != "owner" && caller_role != "moderator" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_user_id == auth.user_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let target_role = state.roles.get_role(channel_id, target_user_id).await;
    // A moderator may only kick plain members — never the owner or another
    // moderator. Only the owner can remove peers.
    if caller_role == "moderator" && target_role != "member" {
        return Err(StatusCode::FORBIDDEN);
    }
    if target_role == "owner" {
        return Err(StatusCode::FORBIDDEN);
    }

    let rows =
        sqlx::query("DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2")
            .bind(channel_id)
            .bind(target_user_id)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .rows_affected();

    if rows == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut con = state.redis.clone();
    let key = format!("channel:{}:members", channel_id);
    let _: () = con
        .srem(&key, target_user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .roles
        .remove_role(channel_id, target_user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}
```

- [ ] **Step 2: Wire the route**

In `chat_server/src/api/server.rs`, find:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, list_channels,
    list_dms, list_friends, open_dm, pin_message, regenerate_invite_code, remove_friend,
    search_users, unpin_message, update_channel, update_member_role, update_my_profile,
};
```

Replace with:

```rust
use super::messages::{
    add_friend, create_channel, get_channel_members, get_channel_online, get_channel_pins,
    get_channel_reactions, get_history, get_user, join_by_code, join_channel, kick_member,
    list_channels, list_dms, list_friends, open_dm, pin_message, regenerate_invite_code,
    remove_friend, search_users, unpin_message, update_channel, update_member_role,
    update_my_profile,
};
```

Then find:

```rust
        .route(
            "/api/channels/{id}/members/{user_id}/role",
            post(update_member_role),
        )
```

Replace with:

```rust
        .route(
            "/api/channels/{id}/members/{user_id}/role",
            post(update_member_role),
        )
        .route(
            "/api/channels/{id}/members/{user_id}",
            axum::routing::delete(kick_member),
        )
```

- [ ] **Step 3: Write the tests**

Add to the `tests` module in `chat_server/src/api/messages.rs`:

```rust
    #[sqlx::test]
    async fn moderator_can_kick_a_plain_member(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (2, 'bob', 'b@x.com', 'h'), (3, 'carol', 'c@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 2, 'moderator'), ($1, 3, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 2, "moderator").await.unwrap();
        state.roles.set_role(channel_id, 3, "member").await.unwrap();

        let result = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path((channel_id, 3)),
        )
        .await;
        assert_eq!(result, Ok(StatusCode::OK));

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id = $1 AND user_id = 3",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        assert_eq!(remaining, 0);
        Ok(())
    }

    #[sqlx::test]
    async fn moderator_cannot_kick_the_owner_or_another_moderator(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'a@x.com', 'h'), (2, 'bob', 'b@x.com', 'h'), (4, 'dan', 'd@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'moderator'), ($1, 4, 'moderator')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;
        state.roles.set_role(channel_id, 1, "owner").await.unwrap();
        state.roles.set_role(channel_id, 2, "moderator").await.unwrap();
        state.roles.set_role(channel_id, 4, "moderator").await.unwrap();

        let kick_owner = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state.clone()),
            axum::extract::Path((channel_id, 1)),
        )
        .await;
        assert_eq!(kick_owner, Err(StatusCode::FORBIDDEN));

        let kick_peer_mod = kick_member(
            AuthenticatedUser { user_id: 2 },
            State(state),
            axum::extract::Path((channel_id, 4)),
        )
        .await;
        assert_eq!(kick_peer_mod, Err(StatusCode::FORBIDDEN));
        Ok(())
    }

    #[sqlx::test]
    async fn plain_member_cannot_kick_anyone(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let state = make_app_state(pool).await;
        sqlx::query("INSERT INTO users (id, username, email, password_hash) VALUES (3, 'carol', 'c@x.com', 'h'), (5, 'eve', 'e@x.com', 'h')")
            .execute(&state.db)
            .await?;
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('general') RETURNING id")
                .fetch_one(&state.db)
                .await?;
        sqlx::query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, 3, 'member'), ($1, 5, 'member')")
            .bind(channel_id)
            .execute(&state.db)
            .await?;

        let result = kick_member(
            AuthenticatedUser { user_id: 3 },
            State(state),
            axum::extract::Path((channel_id, 5)),
        )
        .await;
        assert_eq!(result, Err(StatusCode::FORBIDDEN));
        Ok(())
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test messages::tests:: -- --nocapture 2>&1 | tail -80
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/api/messages.rs chat_server/src/api/server.rs
git commit -m "feat: add kick-member endpoint with moderator/owner boundary"
```

---

### Task 13: Moderator message-delete bypass

**Files:**
- Modify: `chat_server/src/database/messages.rs:107-126` (`delete_message`)
- Modify: `chat_server/src/websocket/handler.rs:380-409` (`MessageType::DELETE` case)

**Interfaces:**
- Produces: `database::messages::delete_message_as_moderator(pool, message_id, channel_id) -> Result<Option<i64>, sqlx::Error>` — deletes without the author check.
- Consumes: `state.roles.get_role()` (called as `app_state.roles.get_role(...)` inside the WS handler, which already has `app_state: &AppState` in scope per the existing `MessageType::DELETE` arm).

- [ ] **Step 1: Add the moderator-bypass DB function**

In `chat_server/src/database/messages.rs`, add after the existing `delete_message` function:

```rust
/// Soft-deletes a message regardless of author — for owner/moderator use only;
/// the caller is responsible for verifying the role before calling this.
/// Returns Some(channel_id) on success, None if the message doesn't exist
/// in this channel or is already deleted.
pub async fn delete_message_as_moderator(
    pool: &PgPool,
    message_id: i64,
    channel_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let rows = sqlx::query(
        "UPDATE messages SET deleted_at = NOW(), text = ''
         WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(channel_id)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(if rows == 0 { None } else { Some(channel_id) })
}
```

- [ ] **Step 2: Use the role check in the WS handler**

In `chat_server/src/websocket/handler.rs`, find the `MessageType::DELETE` arm:

```rust
        MessageType::DELETE => {
            #[derive(serde::Deserialize)]
            struct DeletePayload {
                message_id: i64,
            }
            let Ok(payload) = serde_json::from_str::<DeletePayload>(&text) else {
                return Ok(());
            };
            let Some(_) = crate::database::messages::delete_message(
                &app_state.db,
                payload.message_id,
                channel_id as i64,
                user_id as i64,
            )
            .await?
            else {
                return Ok(());
            };
```

Replace with:

```rust
        MessageType::DELETE => {
            #[derive(serde::Deserialize)]
            struct DeletePayload {
                message_id: i64,
            }
            let Ok(payload) = serde_json::from_str::<DeletePayload>(&text) else {
                return Ok(());
            };
            let role = app_state
                .roles
                .get_role(channel_id as i64, user_id as i64)
                .await;
            let deleted = if role == "owner" || role == "moderator" {
                crate::database::messages::delete_message_as_moderator(
                    &app_state.db,
                    payload.message_id,
                    channel_id as i64,
                )
                .await?
            } else {
                crate::database::messages::delete_message(
                    &app_state.db,
                    payload.message_id,
                    channel_id as i64,
                    user_id as i64,
                )
                .await?
            };
            let Some(_) = deleted else {
                return Ok(());
            };
```

- [ ] **Step 3: Write the tests**

At the bottom of `chat_server/src/database/messages.rs`, extend the existing `tests` module (added in Task 2):

```rust
    #[sqlx::test]
    async fn delete_message_as_moderator_removes_any_authors_message(
        pool: sqlx::PgPool,
    ) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let author_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let msg_id = insert_message(&pool, channel_id as u64, author_id as u64, "hi", 1000)
            .await
            .unwrap();

        // A different user (the moderator) deletes it — delete_message (author-only)
        // would reject this; delete_message_as_moderator does not check authorship.
        let result = delete_message_as_moderator(&pool, msg_id as i64, channel_id).await?;
        assert!(result.is_some());

        let deleted_at: Option<chrono::NaiveDateTime> =
            sqlx::query_scalar("SELECT deleted_at FROM messages WHERE id = $1")
                .bind(msg_id as i64)
                .fetch_one(&pool)
                .await?;
        assert!(deleted_at.is_some());
        Ok(())
    }

    #[sqlx::test]
    async fn regular_delete_message_still_requires_authorship(pool: sqlx::PgPool) -> sqlx::Result<()> {
        let channel_id: i64 =
            sqlx::query_scalar("INSERT INTO channels (name) VALUES ('test') RETURNING id")
                .fetch_one(&pool)
                .await?;
        let author_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('alice', 'a@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let other_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash) VALUES ('bob', 'b@x.com', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let msg_id = insert_message(&pool, channel_id as u64, author_id as u64, "hi", 1000)
            .await
            .unwrap();

        let result = delete_message(&pool, msg_id as i64, channel_id, other_id).await?;
        assert!(result.is_none(), "non-author delete_message call must be rejected");
        Ok(())
    }
```

Note: if `chrono` isn't already a dependency, use `Option<sqlx::types::time::PrimitiveDateTime>` or simply assert on a `deleted: bool` computed column instead — check `chat_server/Cargo.toml` for what's already available before writing this assertion; the simplest option that avoids a new dependency is:

```rust
        let deleted: bool = sqlx::query_scalar(
            "SELECT deleted_at IS NOT NULL FROM messages WHERE id = $1",
        )
        .bind(msg_id as i64)
        .fetch_one(&pool)
        .await?;
        assert!(deleted);
```

Use this `bool`-based assertion instead of the `chrono`/`NaiveDateTime` version above (avoids introducing a new dependency just for a test assertion).

- [ ] **Step 4: Run the tests**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test database::messages::tests:: -- --nocapture 2>&1 | tail -60
```

- [ ] **Step 5: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/database/messages.rs chat_server/src/websocket/handler.rs
git commit -m "feat: owner/moderator can delete any message, not just their own"
```

---

### Task 14: Seed role cache on WS connect

**Files:**
- Modify: `chat_server/src/websocket/handler.rs:136-171` (`seed_redis_membership`)

**Interfaces:**
- Consumes: `state.roles.set_role()` (Task 4). Ensures a user's role is in the Redis cache immediately on reconnect, not just at creation/promotion time (mirrors the existing membership-seeding rationale — Redis can be flushed/restarted independently of Postgres).

- [ ] **Step 1: Extend `seed_redis_membership`**

Find:

```rust
async fn seed_redis_membership(
    user_id: u64,
    db: &sqlx::PgPool,
    redis: &ConnectionManager,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut con = redis.clone();

    // Regular channels the user has joined
    let channel_ids: Vec<i64> =
        sqlx::query_scalar("SELECT channel_id FROM channel_members WHERE user_id = $1")
            .bind(user_id as i64)
            .fetch_all(db)
            .await?;
    for cid in channel_ids {
        let key = format!("channel:{}:members", cid);
        let _: () = con.sadd(&key, user_id as i64).await?;
    }
```

Replace with:

```rust
async fn seed_redis_membership(
    user_id: u64,
    db: &sqlx::PgPool,
    redis: &ConnectionManager,
    roles: &crate::cache::roles::RoleCache,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut con = redis.clone();

    // Regular channels the user has joined, with their role.
    let memberships: Vec<(i64, String)> = sqlx::query_as(
        "SELECT channel_id, role FROM channel_members WHERE user_id = $1",
    )
    .bind(user_id as i64)
    .fetch_all(db)
    .await?;
    for (cid, role) in memberships {
        let key = format!("channel:{}:members", cid);
        let _: () = con.sadd(&key, user_id as i64).await?;
        roles.set_role(cid, user_id as i64, &role).await?;
    }
```

- [ ] **Step 2: Update the call site**

In `chat_server/src/websocket/handler.rs`, find (near the top of the connection-handling function, right after the `last_seen` update):

```rust
    if let Err(e) = seed_redis_membership(user_id, &app_state.db, &app_state.redis).await {
        eprintln!("warn: redis membership seed failed for {user_id}: {e}");
    }
```

Replace with:

```rust
    if let Err(e) = seed_redis_membership(user_id, &app_state.db, &app_state.redis, &app_state.roles).await {
        eprintln!("warn: redis membership seed failed for {user_id}: {e}");
    }
```

- [ ] **Step 3: Build**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo build 2>&1 | tail -30
```

Expected: builds clean (this function has no existing test coverage — it's WS-connection-lifecycle code, verified manually in Task 16's full walkthrough, consistent with how this function was untested before this change too).

- [ ] **Step 4: cargo fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt
cargo clippy -- -D warnings 2>&1 | tail -40
```

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add chat_server/src/websocket/handler.rs
git commit -m "feat: seed role cache alongside membership on WS connect"
```

---

### Task 15: Frontend types + API client

**Files:**
- Modify: `grove_client/src/types.ts` (new types)
- Modify: `grove_client/src/api.ts` (new functions + extended `createChannel`)
- Modify: `grove_client/src/components/AppShell.tsx:24` (`Channel` interface)

**Interfaces:**
- Produces: `MemberInfo { user_id, username, role }`, `ChannelDetails` extension fields, and API functions `updateChannel`, `regenerateInviteCode`, `joinByCode`, `getChannelMembers`, `updateMemberRole`, `kickMember`. Consumed by Task 16 (`ChannelSettingsModal`) and Task 18/19/20 (`AppShell.tsx`).

- [ ] **Step 1: Add types**

In `grove_client/src/types.ts`, add at the end of the file:

```typescript
export type ChannelRole = "owner" | "moderator" | "member";

export interface MemberInfo {
    user_id:  number;
    username: string;
    role:     ChannelRole;
}
```

- [ ] **Step 2: Extend the `Channel` interface in `AppShell.tsx`**

In `grove_client/src/components/AppShell.tsx`, find:

```typescript
interface Channel { id: number; name: string; }
```

Replace with:

```typescript
interface Channel {
    id:          number;
    name:        string;
    description?: string;
    category?:    string;
    is_private:   boolean;
}
```

- [ ] **Step 2b: Fix the initial channel-list load, which currently drops every new field**

The startup fetch that populates `channels` state strips the response down to just `id`/`name` — this would silently break category-grouped browsing (Task 19) for every channel that existed before the current session, since only channels created or joined *within* the session would retain their category/privacy via the separate append calls elsewhere. Find:

```typescript
        listChannels(token).then(chs => setChannels(chs.map(c => ({ id: c.id, name: c.name })))).catch(console.error);
```

Replace with:

```typescript
        listChannels(token).then(chs => setChannels(chs.map(c => ({
            id: c.id, name: c.name, description: c.description, category: c.category, is_private: c.is_private,
        })))).catch(console.error);
```

- [ ] **Step 3: Extend `createChannel` and add the new API functions**

In `grove_client/src/api.ts`, find the import block:

```typescript
import type {
    ReactionSummary,
    UserProfile,
    PinnedMessage,
    AuthResponse,
    RegisterRequest,
    LoginRequest,
    CreateChannelResponse,
    DmInfo,
    FriendInfo,
    HistoricMessage,
} from "./types";
```

Replace with:

```typescript
import type {
    ReactionSummary,
    UserProfile,
    PinnedMessage,
    AuthResponse,
    RegisterRequest,
    LoginRequest,
    CreateChannelResponse,
    DmInfo,
    FriendInfo,
    HistoricMessage,
    MemberInfo,
    ChannelRole,
} from "./types";
```

Then find:

```typescript
export interface ChannelInfo {
  id: number;
  name: string;
}

export function createChannel(
    name: string,
    token: string
    ): Promise<CreateChannelResponse> {
    return postJson<CreateChannelResponse>(
        "/api/channels/create",
        { name },
        token
    );
}
```

Replace with:

```typescript
export interface ChannelInfo {
  id:           number;
  name:         string;
  description?: string;
  category?:    string;
  is_private:   boolean;
}

export function createChannel(
    name: string,
    token: string,
    options?: { description?: string; category?: string; is_private?: boolean },
    ): Promise<CreateChannelResponse> {
    return postJson<CreateChannelResponse>(
        "/api/channels/create",
        {
            name,
            description: options?.description,
            category:    options?.category,
            is_private:  options?.is_private ?? false,
        },
        token
    );
}

export function updateChannel(
    channelId: number,
    updates: { description?: string; category?: string; is_private?: boolean },
    token: string,
): Promise<{ invite_code: string | null }> {
    return fetch(`${API_BASE}/api/channels/${channelId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(updates),
    }).then(async res => {
        if (!res.ok) throw new Error(`Update channel failed: ${res.status}`);
        return res.json() as Promise<{ invite_code: string | null }>;
    });
}

export function regenerateInviteCode(
    channelId: number,
    token: string,
): Promise<{ invite_code: string }> {
    return postJson<{ invite_code: string }>(
        `/api/channels/${channelId}/invite-code/regenerate`,
        {},
        token,
    );
}

export function joinByCode(
    code: string,
    token: string,
): Promise<{ channel_id: number; name: string }> {
    return postJson<{ channel_id: number; name: string }>(
        "/api/channels/join-by-code",
        { code },
        token,
    );
}

export async function getChannelMembers(channelId: number, token: string): Promise<MemberInfo[]> {
    const res = await fetch(`${API_BASE}/api/channels/${channelId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch members: ${res.status}`);
    return (await res.json()) as MemberInfo[];
}

export function updateMemberRole(
    channelId: number,
    userId: number,
    role: ChannelRole,
    token: string,
): Promise<void> {
    return postJson<void>(
        `/api/channels/${channelId}/members/${userId}/role`,
        { role },
        token,
    );
}

export async function kickMember(channelId: number, userId: number, token: string): Promise<void> {
    await fetch(`${API_BASE}/api/channels/${channelId}/members/${userId}`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/api.ts src/types.ts src/components/AppShell.tsx
```

Expected: errors referencing `Channel`'s new required `is_private` field not being supplied wherever a `Channel` object literal is constructed elsewhere in `AppShell.tsx` (e.g. in `handleCreateChannel`, which currently does `setChannels(prev => [...prev, { id: res.channel_id, name }])`) — this is expected and gets fixed in Task 18. Confirm there are no *other* unrelated new errors.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/types.ts grove_client/src/api.ts grove_client/src/components/AppShell.tsx
git commit -m "feat: add channel-role/member types and API client functions"
```

(This commit intentionally leaves one call site red — Task 18 updates `handleCreateChannel` to supply the new required field. Same deliberate-gap pattern used in the reactbits motion pass plan.)

---

### Task 16: `ChannelSettingsModal` component

**Files:**
- Create: `grove_client/src/components/ChannelSettingsModal.tsx`
- Modify: `grove_client/src/styles/darkwood.css` (new modal styles, appended before the `REDUCED MOTION` section)

**Interfaces:**
- Consumes: `updateChannel`, `regenerateInviteCode`, `getChannelMembers`, `updateMemberRole`, `kickMember` (Task 15).
- Produces: `<ChannelSettingsModal channelId token currentUserId myRole onClose />` — a self-contained modal that fetches its own data on mount.

- [ ] **Step 1: Write the component**

Create `grove_client/src/components/ChannelSettingsModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
    updateChannel, regenerateInviteCode, getChannelMembers,
    updateMemberRole, kickMember,
} from "../api";
import type { MemberInfo, ChannelRole } from "../types";

interface ChannelSettingsModalProps {
    channelId:     number;
    channelName:   string;
    description?:  string;
    category?:     string;
    isPrivate:     boolean;
    inviteCode?:   string;
    token:         string;
    currentUserId: number;
    myRole:        ChannelRole;
    onClose:       () => void;
    onUpdated:     (updates: { description?: string; category?: string; is_private?: boolean }) => void;
}

export function ChannelSettingsModal({
    channelId, channelName, description, category, isPrivate, inviteCode,
    token, currentUserId, myRole, onClose, onUpdated,
}: ChannelSettingsModalProps) {
    const [tab, setTab] = useState<"overview" | "members">("overview");
    const [descDraft, setDescDraft] = useState(description ?? "");
    const [categoryDraft, setCategoryDraft] = useState(category ?? "");
    const [privateDraft, setPrivateDraft] = useState(isPrivate);
    const [code, setCode] = useState(inviteCode);
    const [members, setMembers] = useState<MemberInfo[]>([]);
    const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);

    const canEdit = myRole === "owner" || myRole === "moderator";
    const isOwner = myRole === "owner";

    useEffect(() => {
        getChannelMembers(channelId, token).then(setMembers).catch(() => {});
    }, [channelId, token]);

    async function saveOverview() {
        const updates = {
            description: descDraft,
            category:    categoryDraft,
            is_private:  privateDraft,
        };
        const res = await updateChannel(channelId, updates, token).catch(() => null);
        if (!res) return;
        setCode(res.invite_code ?? undefined);
        onUpdated(updates);
    }

    async function handleRegenerate() {
        const res = await regenerateInviteCode(channelId, token).catch(() => null);
        if (res) setCode(res.invite_code);
    }

    async function handlePromote(userId: number, role: ChannelRole) {
        await updateMemberRole(channelId, userId, role, token).catch(() => {});
        setMembers(prev => prev.map(m => (m.user_id === userId ? { ...m, role } : m)));
        setOpenMenuFor(null);
    }

    async function handleKick(userId: number) {
        await kickMember(channelId, userId, token).catch(() => {});
        setMembers(prev => prev.filter(m => m.user_id !== userId));
        setOpenMenuFor(null);
    }

    return (
        <>
            <div className="dw-modal-backdrop" onClick={onClose} aria-hidden="true" />
            <div className="dw-modal" role="dialog" aria-modal="true" aria-label={`${channelName} settings`}>
                <div className="dw-modal-header">
                    <h2 className="dw-modal-title">#{channelName} settings</h2>
                    <button className="dw-modal-close" onClick={onClose} aria-label="Close settings">×</button>
                </div>

                <div className="dw-modal-tabs" role="tablist">
                    <button
                        className={`dw-modal-tab${tab === "overview" ? " active" : ""}`}
                        role="tab"
                        aria-selected={tab === "overview"}
                        onClick={() => setTab("overview")}
                    >
                        Overview
                    </button>
                    <button
                        className={`dw-modal-tab${tab === "members" ? " active" : ""}`}
                        role="tab"
                        aria-selected={tab === "members"}
                        onClick={() => setTab("members")}
                    >
                        Members ({members.length})
                    </button>
                </div>

                {tab === "overview" && (
                    <div className="dw-modal-body">
                        <label className="dw-modal-field">
                            <span className="dw-modal-label">Description</span>
                            <textarea
                                className="dw-modal-textarea"
                                value={descDraft}
                                onChange={e => setDescDraft(e.target.value)}
                                disabled={!canEdit}
                                maxLength={500}
                                rows={3}
                            />
                        </label>
                        <label className="dw-modal-field">
                            <span className="dw-modal-label">Category</span>
                            <input
                                className="dw-modal-input"
                                value={categoryDraft}
                                onChange={e => setCategoryDraft(e.target.value)}
                                disabled={!isOwner}
                                maxLength={100}
                                placeholder="Uncategorized"
                            />
                        </label>
                        {isOwner && (
                            <label className="dw-modal-field dw-modal-field-row">
                                <span className="dw-modal-label">Private channel</span>
                                <input
                                    type="checkbox"
                                    checked={privateDraft}
                                    onChange={e => setPrivateDraft(e.target.checked)}
                                />
                            </label>
                        )}
                        {isOwner && privateDraft && code && (
                            <div className="dw-modal-field">
                                <span className="dw-modal-label">Invite code</span>
                                <div className="dw-modal-field-row">
                                    <code className="dw-modal-code">{code}</code>
                                    <button className="dw-modal-btn-sm" onClick={handleRegenerate}>
                                        Regenerate
                                    </button>
                                </div>
                            </div>
                        )}
                        {canEdit && (
                            <button className="dw-modal-btn-primary" onClick={saveOverview}>
                                Save
                            </button>
                        )}
                    </div>
                )}

                {tab === "members" && (
                    <ul className="dw-modal-members" role="list">
                        {members.map(m => (
                            <li key={m.user_id} className="dw-modal-member-row">
                                <span className="dw-modal-member-name">{m.username}</span>
                                <span className={`dw-modal-role-badge dw-modal-role-${m.role}`}>{m.role}</span>
                                {m.user_id !== currentUserId && canEdit && (m.role !== "owner") && (
                                    <div className="dw-modal-member-menu">
                                        <button
                                            className="dw-modal-kebab"
                                            onClick={() => setOpenMenuFor(v => (v === m.user_id ? null : m.user_id))}
                                            aria-label={`Manage ${m.username}`}
                                        >
                                            ⋮
                                        </button>
                                        {openMenuFor === m.user_id && (
                                            <div className="dw-modal-menu-popover" role="menu">
                                                {isOwner && m.role === "member" && (
                                                    <button role="menuitem" onClick={() => handlePromote(m.user_id, "moderator")}>
                                                        Promote to moderator
                                                    </button>
                                                )}
                                                {isOwner && m.role === "moderator" && (
                                                    <button role="menuitem" onClick={() => handlePromote(m.user_id, "member")}>
                                                        Demote to member
                                                    </button>
                                                )}
                                                {(isOwner || (myRole === "moderator" && m.role === "member")) && (
                                                    <button role="menuitem" className="dw-modal-danger" onClick={() => handleKick(m.user_id)}>
                                                        Kick from channel
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
}
```

- [ ] **Step 2: Add the modal CSS**

In `grove_client/src/styles/darkwood.css`, find the end of the `MESSAGE ENTRANCE (reactbits motion pass)` section (currently ending right before the `REDUCED MOTION` comment). Insert before that comment:

```css
/* ============================================================
   CHANNEL SETTINGS MODAL
   ============================================================ */

.dw-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: var(--z-modal);
}

.dw-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(480px, calc(100vw - 32px));
  max-height: min(600px, calc(100vh - 64px));
  overflow-y: auto;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-float);
  z-index: calc(var(--z-modal) + 1);
  padding: var(--sp-6);
}

.dw-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}

.dw-modal-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-primary);
}

.dw-modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-xl);
  cursor: pointer;
  line-height: 1;
}

.dw-modal-close:hover { color: var(--text-primary); }

.dw-modal-tabs {
  display: flex;
  gap: var(--sp-4);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--sp-4);
}

.dw-modal-tab {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: var(--sp-2) 0;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.dw-modal-tab.active {
  color: var(--leaf-bright);
  border-bottom-color: var(--leaf-bright);
}

.dw-modal-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.dw-modal-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.dw-modal-field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.dw-modal-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dw-modal-textarea, .dw-modal-input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  padding: var(--sp-2) var(--sp-3);
}

.dw-modal-textarea:focus, .dw-modal-input:focus {
  outline: none;
  border-color: var(--border-focus);
}

.dw-modal-code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-xs);
  color: var(--leaf-bright);
}

.dw-modal-btn-sm {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  padding: var(--sp-1) var(--sp-2);
  cursor: pointer;
}

.dw-modal-btn-primary {
  background: var(--leaf);
  border: none;
  border-radius: var(--r-sm);
  color: var(--text-inverse);
  font-weight: 500;
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  align-self: flex-start;
}

.dw-modal-btn-primary:hover { background: var(--leaf-bright); }

.dw-modal-members {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.dw-modal-member-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  position: relative;
}

.dw-modal-member-row:hover { background: var(--surface-2); }

.dw-modal-member-name {
  flex-grow: 1;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.dw-modal-role-badge {
  font-size: var(--text-xs);
  padding: 2px var(--sp-2);
  border-radius: var(--r-full);
  color: var(--text-muted);
  background: var(--surface-3);
}

.dw-modal-role-owner   { color: var(--leaf-bright); }
.dw-modal-role-moderator { color: var(--text-secondary); }

.dw-modal-kebab {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-md);
}

.dw-modal-kebab:hover { color: var(--text-primary); }

.dw-modal-menu-popover {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-panel);
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  min-width: 160px;
}

.dw-modal-menu-popover button {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
}

.dw-modal-menu-popover button:hover { background: var(--surface-3); }

.dw-modal-danger { color: var(--danger) !important; }
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i channelsettingsmodal || echo "no errors"
npx eslint src/components/ChannelSettingsModal.tsx
```

Expected: `no errors`, no lint output.

- [ ] **Step 4: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/ChannelSettingsModal.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: add ChannelSettingsModal component"
```

---

### Task 17: Wire gear icon into `ChatView.tsx` header

**Files:**
- Modify: `grove_client/src/components/ChatView.tsx:11-46` (props + header)

**Interfaces:**
- Produces: `ChatViewProps` gains `onOpenSettings?: () => void`. `AppShell.tsx` (Task 19) supplies it and renders `ChannelSettingsModal` conditionally.
- Note: the design spec mentioned the chat header gaining "a member-count display." This plan deliberately does not add a persistent header member-count, to avoid an extra members fetch on every channel switch (members are only fetched on-demand, when the settings modal actually opens — see Task 16/20). The member count is shown in the modal's "Members (N)" tab label instead, which is where it's actually needed and already fetched. This is a scope trim caught during this plan's self-review, consistent with the emphasis on avoiding unnecessary round-trips.

- [ ] **Step 1: Extend props**

In `grove_client/src/components/ChatView.tsx`, find:

```tsx
interface ChatViewProps {
    channelId:    number;
    channelName:  string;
    isDm:         boolean;
    messages:     DisplayMessage[];
```

Replace with:

```tsx
interface ChatViewProps {
    channelId:      number;
    channelName:    string;
    isDm:           boolean;
    onOpenSettings?: () => void;
    messages:     DisplayMessage[];
```

Then find:

```tsx
export function ChatView({
    channelId, channelName, isDm,
    messages, usernames, currentUserId, myUsername,
```

Replace with:

```tsx
export function ChatView({
    channelId, channelName, isDm, onOpenSettings,
    messages, usernames, currentUserId, myUsername,
```

- [ ] **Step 2: Add the gear icon to the header**

Find:

```tsx
            {/* Header */}
            <header className="dw-chat-header">
                <span className="dw-chat-prefix" aria-hidden="true">
                    {isDm ? "@" : "#"}
                </span>
                <h2 className="dw-chat-name">{channelName}</h2>
            </header>
```

Replace with:

```tsx
            {/* Header */}
            <header className="dw-chat-header">
                <span className="dw-chat-prefix" aria-hidden="true">
                    {isDm ? "@" : "#"}
                </span>
                <h2 className="dw-chat-name">{channelName}</h2>
                {!isDm && onOpenSettings && (
                    <button
                        className="dw-chat-settings-btn"
                        onClick={onOpenSettings}
                        aria-label="Channel settings"
                    >
                        ⚙
                    </button>
                )}
            </header>
```

- [ ] **Step 3: Add the header button CSS**

In `grove_client/src/styles/darkwood.css`, in the `CHANNEL SETTINGS MODAL` section added in Task 16, append:

```css
.dw-chat-settings-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-md);
  cursor: pointer;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  transition: transform var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.dw-chat-settings-btn:hover {
  color: var(--text-primary);
  background: var(--surface-2);
  transform: scale(1.05);
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i chatview || echo "no errors"
npx eslint src/components/ChatView.tsx
```

Expected: `no errors` (the `onOpenSettings?` prop is optional, so `AppShell.tsx` not yet passing it — until Task 19 — doesn't break the build), no lint output.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/ChatView.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: add channel settings gear icon to chat header"
```

---

### Task 18: Extend channel-creation flow

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx` (`handleCreateChannel`, palette create-item UX)

**Interfaces:**
- Consumes: `createChannel` extended signature (Task 15).
- Produces: fixes the Task 15 build gap (`Channel` object literals now supply `is_private`).

- [ ] **Step 1: Add creation-flow state**

In `grove_client/src/components/AppShell.tsx`, find:

```typescript
    /* Command palette */
    const [paletteOpen, setPaletteOpen]   = useState(false);
    const [paletteQuery, setPaletteQuery] = useState("");
    const [paletteIdx, setPaletteIdx]     = useState(0);
```

Replace with:

```typescript
    /* Command palette */
    const [paletteOpen, setPaletteOpen]   = useState(false);
    const [paletteQuery, setPaletteQuery] = useState("");
    const [paletteIdx, setPaletteIdx]     = useState(0);
    const [createCategory, setCreateCategory] = useState("");
    const [createPrivate, setCreatePrivate]   = useState(false);
```

- [ ] **Step 2: Update `handleCreateChannel`**

Find:

```typescript
    async function handleCreateChannel() {
        const name = paletteQuery.trim().replace(/^#/, "");
        if (!name) return;
        try {
            const res = await createChannel(name, token);
            setChannels(prev => [...prev, { id: res.channel_id, name }]);
            openChannel(res.channel_id, name, "channel");
        } catch { /* ignore */ }
    }
```

Replace with:

```typescript
    async function handleCreateChannel() {
        const name = paletteQuery.trim().replace(/^#/, "");
        if (!name) return;
        try {
            const res = await createChannel(name, token, {
                category:   createCategory.trim() || undefined,
                is_private: createPrivate,
            });
            setChannels(prev => [...prev, {
                id: res.channel_id, name,
                category: createCategory.trim() || undefined,
                is_private: createPrivate,
            }]);
            if (res.invite_code) {
                setToasts(prev => [...prev, {
                    id: crypto.randomUUID(),
                    text: `Channel created — invite code: ${res.invite_code}`,
                }]);
            }
            setCreateCategory("");
            setCreatePrivate(false);
            openChannel(res.channel_id, name, "channel");
        } catch { /* ignore */ }
    }
```

- [ ] **Step 3: Confirm the `Toast` shape matches**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
grep -n "^type Toast" -A 6 src/components/AppShell.tsx
```

If `Toast` doesn't have exactly `{ id: string; text: string }` (it may have more fields, e.g. a `kind`), adjust the `setToasts` call above to match the real shape — read the existing type definition first and construct a value that satisfies it exactly (do not guess; the `tsc` step below will catch a mismatch).

- [ ] **Step 4: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/AppShell.tsx
```

Expected: no errors (this closes the Task 15 gap — `Channel` object literals now supply `is_private`), no lint output.

Note: the category/private inputs' actual JSX (checkboxes/fields near the palette's create-item UI) are intentionally left for Task 19, which redesigns the relevant part of the palette JSX anyway (browse mode + join-by-code) — wiring `createCategory`/`createPrivate` state here first, with their UI added in the same pass as the other palette changes, avoids touching the same JSX block twice.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/AppShell.tsx
git commit -m "feat: thread category/privacy through channel creation"
```

---

### Task 19: Palette — grouped category browsing + join-by-code + create-channel fields

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx` (palette state, `PaletteItem` type, `paletteItems` logic, palette JSX, wire `ChannelSettingsModal`)

**Interfaces:**
- Consumes: `joinByCode` (Task 15), `ChannelSettingsModal` (Task 16), `onOpenSettings` (Task 17).
- Produces: two new palette actions (`browse-channels`, `join-private`), a new `paletteMode` state, and the settings-modal open/close wiring on `ChatView`.

- [ ] **Step 1: Add palette mode state**

Find:

```typescript
    const [createCategory, setCreateCategory] = useState("");
    const [createPrivate, setCreatePrivate]   = useState(false);
```

Replace with:

```typescript
    const [createCategory, setCreateCategory] = useState("");
    const [createPrivate, setCreatePrivate]   = useState(false);
    const [paletteMode, setPaletteMode] = useState<"default" | "browse" | "join-code">("default");
    const [joinCodeDraft, setJoinCodeDraft] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
```

- [ ] **Step 2: Reset `paletteMode` whenever the palette opens/closes**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
grep -n "setPaletteOpen(v => !v); setPaletteQuery(\"\"); setPaletteIdx(0)" src/components/AppShell.tsx
grep -n "setPaletteOpen(false)" src/components/AppShell.tsx
```

At every one of those call sites (the two topbar-logo/topbar-btn `onClick` handlers that open the palette, the `Ctrl+K` keydown handler, and the `Escape`/backdrop-click handlers that close it), add `setPaletteMode("default");` alongside the existing `setPaletteQuery("")`/`setPaletteIdx(0)` or `setPaletteOpen(false)` calls, so the palette always returns to its default view when reopened or dismissed. Example for one such site — find:

```typescript
                    onClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); }}
```

Replace each occurrence with:

```typescript
                    onClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); setPaletteMode("default"); }}
```

And for the `Escape` handler inside `handlePaletteKey`, find:

```typescript
        } else if (e.key === "Escape") {
            setPaletteOpen(false);
        }
```

Replace with:

```typescript
        } else if (e.key === "Escape") {
            if (paletteMode !== "default") {
                setPaletteMode("default");
            } else {
                setPaletteOpen(false);
            }
        }
```

(Escape backs out of browse/join-code mode first, then closes the palette on a second press — standard modal-within-modal escape behavior.)

- [ ] **Step 3: Add the two new palette actions to the default (recents) view**

Find:

```typescript
            return [
                ...recentItems,
                { kind: "action", id: "friends", label: "Friends", icon: "👥" },
            ];
```

Replace with:

```typescript
            return [
                ...recentItems,
                { kind: "action", id: "friends", label: "Friends", icon: "👥" },
                { kind: "action", id: "browse-channels", label: "Browse all channels", icon: "🗂" },
                { kind: "action", id: "join-private", label: "Join private channel", icon: "🔒" },
            ];
```

- [ ] **Step 4: Handle the new actions in `selectPaletteItem`**

Find:

```typescript
        } else if (item.kind === "action") {
            if (item.id === "friends") { setActivePage("friends"); setPaletteOpen(false); }
            if (item.id === "create")  handleCreateChannel();
        }
```

Replace with:

```typescript
        } else if (item.kind === "action") {
            if (item.id === "friends") { setActivePage("friends"); setPaletteOpen(false); }
            if (item.id === "create")  handleCreateChannel();
            if (item.id === "browse-channels") setPaletteMode("browse");
            if (item.id === "join-private")    setPaletteMode("join-code");
        }
```

- [ ] **Step 5: Add a `handleJoinByCode` function**

Find `handleCreateChannel` (now modified in Task 18) and add this new function directly after it:

```typescript
    async function handleJoinByCode() {
        const code = joinCodeDraft.trim();
        if (!code) return;
        try {
            const res = await joinByCode(code, token);
            setChannels(prev => prev.some(c => c.id === res.channel_id)
                ? prev
                : [...prev, { id: res.channel_id, name: res.name, is_private: true }]);
            setJoinCodeDraft("");
            setPaletteMode("default");
            openChannel(res.channel_id, res.name, "channel");
        } catch {
            setToasts(prev => [...prev, { id: crypto.randomUUID(), text: "Invalid or expired invite code" }]);
        }
    }
```

Add the import at the top of the file — find:

```typescript
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
} from "../api";
```

Replace with:

```typescript
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
    joinByCode,
} from "../api";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
```

- [ ] **Step 6: Render the browse/join-code palette views**

Find this exact block (the full existing palette list, verbatim):

```tsx
                        {paletteItems.length > 0 && (
                            <ul className="dw-palette-list" id="palette-list" role="listbox">
                                {!q && recentIds.some(id => channels.find(c => c.id === id) || dms.find(d => d.channel_id === id)) && (
                                    <li className="dw-palette-category" role="presentation">Recent</li>
                                )}
                                {paletteItems.map((item, i) => (
                                    <li
                                        key={item.kind + item.id}
                                        id={`palette-item-${i}`}
                                        className={`dw-palette-item${i === paletteIdx ? " active" : ""}`}
                                        role="option"
                                        aria-selected={i === paletteIdx}
                                        onMouseEnter={() => setPaletteIdx(i)}
                                        onMouseDown={e => { e.preventDefault(); selectPaletteItem(item); }}
                                    >
                                        {item.kind === "channel" && (
                                            <>
                                                <span className="dw-palette-icon dw-palette-hash">#</span>
                                                <span className="dw-palette-label">{item.name}</span>
                                                {unreadByChannel[item.id] ? (
                                                    <span className="dw-palette-badge">
                                                        {unreadByChannel[item.id]}
                                                    </span>
                                                ) : null}
                                            </>
                                        )}
                                        {item.kind === "dm" && (
                                            <>
                                                <div
                                                    className="dw-palette-avatar"
                                                    style={{ background: avatarBg(item.partnerId) }}
                                                >
                                                    {avatarInitial(item.name)}
                                                    <span className={`dw-palette-dot ${item.online ? "online" : "offline"}`} />
                                                </div>
                                                <span className="dw-palette-label">{item.name}</span>
                                                <span className="dw-palette-sub">
                                                    {item.online ? "online" : "offline"}
                                                </span>
                                            </>
                                        )}
                                        {item.kind === "action" && (
                                            <>
                                                <span className="dw-palette-icon">{item.icon}</span>
                                                <span className="dw-palette-label">{item.label}</span>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
```

Replace it in full with a version that branches on `paletteMode` (this is the same JSX, unindented logic-wise, just gated behind `paletteMode === "default"`, plus two new sibling blocks for the other two modes):

```tsx
                        {paletteMode === "join-code" && (
                            <div className="dw-palette-join-code">
                                <input
                                    className="dw-palette-input"
                                    placeholder="Enter invite code…"
                                    value={joinCodeDraft}
                                    onChange={e => setJoinCodeDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") handleJoinByCode(); }}
                                    autoFocus
                                    aria-label="Invite code"
                                />
                                <button className="dw-modal-btn-primary" onClick={handleJoinByCode}>
                                    Join
                                </button>
                            </div>
                        )}

                        {paletteMode === "browse" && (
                            <ul className="dw-palette-list" id="palette-list" role="listbox">
                                {Object.entries(
                                    channels.reduce<Record<string, Channel[]>>((groups, ch) => {
                                        const key = ch.category?.trim() || "Channels";
                                        (groups[key] ??= []).push(ch);
                                        return groups;
                                    }, {}),
                                ).map(([groupName, chans]) => (
                                    <Fragment key={groupName}>
                                        <li className="dw-palette-category" role="presentation">{groupName}</li>
                                        {chans.map(ch => (
                                            <li
                                                key={ch.id}
                                                className="dw-palette-item"
                                                role="option"
                                                aria-selected={false}
                                                onMouseDown={e => { e.preventDefault(); openChannel(ch.id, ch.name, "channel"); setPaletteOpen(false); }}
                                            >
                                                <span className="dw-palette-icon dw-palette-hash">#</span>
                                                <span className="dw-palette-label">{ch.name}</span>
                                            </li>
                                        ))}
                                    </Fragment>
                                ))}
                            </ul>
                        )}

                        {paletteMode === "default" && paletteItems.length > 0 && (
                            <ul className="dw-palette-list" id="palette-list" role="listbox">
                                {!q && recentIds.some(id => channels.find(c => c.id === id) || dms.find(d => d.channel_id === id)) && (
                                    <li className="dw-palette-category" role="presentation">Recent</li>
                                )}
                                {paletteItems.map((item, i) => (
                                    <li
                                        key={item.kind + item.id}
                                        id={`palette-item-${i}`}
                                        className={`dw-palette-item${i === paletteIdx ? " active" : ""}`}
                                        role="option"
                                        aria-selected={i === paletteIdx}
                                        onMouseEnter={() => setPaletteIdx(i)}
                                        onMouseDown={e => { e.preventDefault(); selectPaletteItem(item); }}
                                    >
                                        {item.kind === "channel" && (
                                            <>
                                                <span className="dw-palette-icon dw-palette-hash">#</span>
                                                <span className="dw-palette-label">{item.name}</span>
                                                {unreadByChannel[item.id] ? (
                                                    <span className="dw-palette-badge">
                                                        {unreadByChannel[item.id]}
                                                    </span>
                                                ) : null}
                                            </>
                                        )}
                                        {item.kind === "dm" && (
                                            <>
                                                <div
                                                    className="dw-palette-avatar"
                                                    style={{ background: avatarBg(item.partnerId) }}
                                                >
                                                    {avatarInitial(item.name)}
                                                    <span className={`dw-palette-dot ${item.online ? "online" : "offline"}`} />
                                                </div>
                                                <span className="dw-palette-label">{item.name}</span>
                                                <span className="dw-palette-sub">
                                                    {item.online ? "online" : "offline"}
                                                </span>
                                            </>
                                        )}
                                        {item.kind === "action" && (
                                            <>
                                                <span className="dw-palette-icon">{item.icon}</span>
                                                <span className="dw-palette-label">{item.label}</span>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
```

Then find the following block (right after where the replaced block ended):

```tsx
                        {paletteItems.length === 0 && q && (
                            <div className="dw-palette-empty">Nothing found for "{q}"</div>
                        )}
```

Replace with:

```tsx
                        {paletteMode === "default" && paletteItems.length === 0 && q && (
                            <div className="dw-palette-empty">Nothing found for "{q}"</div>
                        )}
```

Add the `Fragment` import — find the top-level React import:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
```

Replace with:

```typescript
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
```

- [ ] **Step 7: Wire the settings modal into `ChatView`**

Find where `<ChatView` is rendered (in the main content area) and its closing `/>` — add `onOpenSettings` to its props:

```bash
cd /home/richtofen/projects/grovefolder/grove_client
grep -n "<ChatView" src/components/AppShell.tsx
```

Find:

```tsx
                    <ChatView
                        channelId={activeChannelId}
                        channelName={activeDisplayName}
                        isDm={activeChannelKind === "dm"}
```

Replace with:

```tsx
                    <ChatView
                        channelId={activeChannelId}
                        channelName={activeDisplayName}
                        isDm={activeChannelKind === "dm"}
                        onOpenSettings={() => setSettingsOpen(true)}
```

Then find (the `<main>` closing tag, immediately followed by the command palette render):

```tsx
                ) : (
                    <EmptyContent />
                )}
            </main>

            {/* ── Command palette ──────────────────────── */}
```

Replace with (inserting the modal render as a sibling of `<main>`, since it's a fixed-position overlay, not part of the content flow — gated on `settingsOpen` and the active channel being a non-DM channel):

```tsx
                ) : (
                    <EmptyContent />
                )}
            </main>

            {settingsOpen && activeChannelId !== null && activeChannelKind === "channel" && (() => {
                const activeChannel = channels.find(c => c.id === activeChannelId);
                if (!activeChannel) return null;
                return (
                    <ChannelSettingsModal
                        channelId={activeChannelId}
                        channelName={activeChannel.name}
                        description={activeChannel.description}
                        category={activeChannel.category}
                        isPrivate={activeChannel.is_private}
                        token={token}
                        currentUserId={userId}
                        myRole="member"
                        onClose={() => setSettingsOpen(false)}
                        onUpdated={updates => setChannels(prev => prev.map(c => (
                            c.id === activeChannelId ? { ...c, ...updates } : c
                        )))}
                    />
                );
            })()}
```

Note: `myRole="member"` is a placeholder value here — the frontend has no per-channel "my role" state yet (the backend knows it via `channel_members.role`, but nothing in `AppShell.tsx` currently fetches or stores it for the active channel). This is a real gap the plan must close, not leave as a silent placeholder — Task 20 adds a `myChannelRole` fetch/state and threads the real value in here.

- [ ] **Step 8: Add browse/join-code palette CSS**

In `grove_client/src/styles/darkwood.css`, in the `CHANNEL SETTINGS MODAL` section, append:

```css
.dw-palette-join-code {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3);
}

.dw-palette-join-code .dw-palette-input {
  flex-grow: 1;
}
```

- [ ] **Step 9: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/AppShell.tsx
```

Expected: no errors, no lint output (aside from the intentional `myRole="member"` placeholder noted above, which is valid TypeScript — Task 20 replaces the value, not the type).

- [ ] **Step 10: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/AppShell.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: add category-grouped browse and join-by-code to the palette, wire settings modal"
```

---

### Task 20: Fetch and thread the caller's real channel role

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx` (state + `openChannel` + modal wiring)

**Interfaces:**
- Consumes: `getChannelMembers` (Task 15) — reused here to derive "my role," rather than adding a new dedicated endpoint (`GET .../members` already contains every member's role, including the caller's).
- Produces: replaces Task 19's `myRole="member"` placeholder with the real value.

- [ ] **Step 1: Add role state**

Find (added in Task 19):

```typescript
    const [settingsOpen, setSettingsOpen] = useState(false);
```

Replace with:

```typescript
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [myChannelRoles, setMyChannelRoles] = useState<Record<number, ChannelRole>>({});
```

Add `ChannelRole` to the existing types import — find:

```typescript
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate,
    type EditUpdate, type DeleteUpdate, type UserProfile,
    type PinnedMessage,
} from "../types";
```

Replace with:

```typescript
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate,
    type EditUpdate, type DeleteUpdate, type UserProfile,
    type PinnedMessage, type ChannelRole,
} from "../types";
```

- [ ] **Step 2: Populate it when the settings modal opens**

Find the `settingsOpen` toggle added in Task 19 (inside the gear-icon `onOpenSettings` callback):

```tsx
                        onOpenSettings={() => setSettingsOpen(true)}
```

Replace with:

```tsx
                        onOpenSettings={() => {
                            setSettingsOpen(true);
                            if (activeChannelId !== null && !(activeChannelId in myChannelRoles)) {
                                getChannelMembers(activeChannelId, token)
                                    .then(members => {
                                        const me = members.find(m => m.user_id === userId);
                                        if (me) setMyChannelRoles(prev => ({ ...prev, [activeChannelId]: me.role }));
                                    })
                                    .catch(() => {});
                            }
                        }}
```

Add `getChannelMembers` to the existing `../api` import — find (as modified in Task 19):

```typescript
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
    joinByCode,
} from "../api";
```

Replace with:

```typescript
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
    joinByCode, getChannelMembers,
} from "../api";
```

- [ ] **Step 3: Use the real role in the modal**

Find (from Task 19):

```tsx
                                myRole="member"
```

Replace with:

```tsx
                                myRole={myChannelRoles[activeChannelId] ?? "member"}
```

- [ ] **Step 4: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/AppShell.tsx
```

Expected: no errors, no lint output.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/AppShell.tsx
git commit -m "feat: fetch and use the caller's real channel role in the settings modal"
```

---

### Task 21: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo test 2>&1 | tail -60
```

Expected: exits 0, all tests pass (requires Postgres and Redis reachable — `docker compose -f /home/richtofen/projects/grovefolder/docker-compose.prod.yml up -d db redis` if not already running).

- [ ] **Step 2: Backend fmt + clippy**

```bash
cd /home/richtofen/projects/grovefolder/chat_server
cargo fmt --check
cargo clippy -- -D warnings 2>&1 | tail -40
```

Expected: both clean.

- [ ] **Step 3: Frontend typecheck, lint, build**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Docker rebuild and full manual walkthrough**

```bash
cd /home/richtofen/projects/grovefolder && docker compose -f docker-compose.prod.yml up --build
```

Walk through every scenario from the design spec in the running app:
- Create a public channel with a description and category — confirm it appears grouped correctly in the palette's "Browse all channels" view.
- Create a private channel — confirm the invite code shows in a toast, and the channel does NOT appear in another (non-member) account's palette browse view or search.
- From a second account, join the private channel via `grove: join private channel` with the correct code — confirm success; try an invalid code — confirm a generic error, not a stack trace or leak.
- Open the gear icon on a channel you own — confirm you can edit description/category, toggle privacy (invite code appears/disappears accordingly), and regenerate the invite code.
- Promote a member to moderator; confirm that account can now delete other members' messages and kick plain members, but the kebab menu (and the server, if bypassed via direct API call) refuses to let them kick the owner or another moderator.
- As a plain member, confirm the settings modal's Overview is read-only and the Members list shows no kebab menu on other members.
- Kick a member; confirm they're removed from the Members list and can no longer post in that channel.
- Confirm no regressions to existing message send/edit/delete/pin/react flows, the reactbits motion pass (message entrance, reaction pop, send spark), or channel creation for a channel with no category/private settings (all fields optional, existing minimal creation flow should still work).

- [ ] **Step 5: Review full diff before handoff**

```bash
cd /home/richtofen/projects/grovefolder && git diff dev --stat
```

Confirm the changed-file list matches this plan's scope: `chat_server/migrations/011_channel_roles.sql`, `chat_server/Cargo.toml`, `chat_server/Cargo.lock`, `chat_server/src/cache/mod.rs`, `chat_server/src/cache/roles.rs`, `chat_server/src/api/mod.rs`, `chat_server/src/api/invite_code.rs`, `chat_server/src/api/messages.rs`, `chat_server/src/api/server.rs`, `chat_server/src/database/messages.rs`, `chat_server/src/websocket/handler.rs`, `chat_server/src/main.rs`, plus `grove_client/src/types.ts`, `grove_client/src/api.ts`, `grove_client/src/components/AppShell.tsx`, `grove_client/src/components/ChatView.tsx`, `grove_client/src/components/ChannelSettingsModal.tsx` (new), `grove_client/src/styles/darkwood.css`.

No further commit here — this task is verification-only. If any step fails, fix forward with a new commit on this branch before considering the plan complete.

Given this feature touches authentication/access-control logic (private channels, roles, permission boundaries), route this branch through a **security-reviewer** pass before merging to `dev`, per this project's standing rule for access-control-adjacent code — do not skip this even though the per-task tests cover the permission-boundary cases.
