# Channel Structure & Organization — Design Spec

**Status:** Approved, pending implementation plan.

**Context:** This is sub-project 1 of a 4-part "Grove vs Slack/Discord" feature-parity
overhaul (the other three — core messaging depth, presence & awareness, search —
are queued as separate specs afterward). The user confirmed Grove's palette-first,
no-persistent-sidebar navigation stays as-is; this pass closes feature gaps, not
navigation philosophy.

## Motivation

Grove's channel model today is minimal: `channels(id, name, created_at, is_dm)`,
`channel_members(channel_id, user_id, joined_at)`. There is no channel ownership,
no roles, no privacy, no description, no categorization, and — a finding from this
brainstorm — no member-list UI anywhere in the app at all (the "member count pill"
and aside panel described in the old `GROVE_HANDOFF.md` V2 design spec were
aspirational and never built, same as the dead `NavRail.tsx`). Any authenticated
user can create a channel and join any non-DM channel. Message deletion/editing
is already author-only (`database::messages::delete_message`/`edit_message`
both require `user_id = <author>` in their `WHERE` clause) — but pinning is
already open to any member (`pin_message`/`unpin_message` only check channel
membership, not authorship of the pinned message). There's no concept of a
channel "belonging" to anyone, and no way for a member to act on someone
else's message or remove another member.

This spec adds: channel descriptions, freeform categories (for palette browsing),
private channels with invite-code joining, and a three-tier role system
(owner/moderator/member) with corresponding permission checks — the minimum set
needed to let a channel-based community organize and self-moderate the way
Slack/Discord users expect, without introducing a persistent sidebar.

## Data Model

New migration extending the existing schema:

```sql
ALTER TABLE channels
    ADD COLUMN description  VARCHAR(500),
    ADD COLUMN category     VARCHAR(100),       -- freeform, NULL = uncategorized
    ADD COLUMN is_private   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN invite_code  VARCHAR(12) UNIQUE;  -- NULL unless is_private

CREATE INDEX idx_channels_category ON channels(category);

ALTER TABLE channel_members
    ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member'; -- 'owner' | 'moderator' | 'member'
```

- `category` is a plain freeform text column, not a separate table — matches the
  "any user, freeform" decision. The client autocompletes against distinct
  existing category values; there is no admin-curated list.
- `invite_code` is generated (random, URL-safe, e.g. 8-10 chars) only when a
  channel is flipped to private. Regenerating overwrites it in place — the old
  code stops working immediately, no grace period.
- The channel creator's `channel_members` row is inserted with `role='owner'`
  at creation time (today's `create_channel` inserts membership with no role
  concept at all).
- None of this applies to `is_dm` channels — DMs are untouched.

## Backend API Surface

- `POST /api/channels/create` — extended body: `{ name, description?, category?, is_private }`.
  If `is_private`, generates and returns the invite code. Creator inserted as `role='owner'`.
- `PATCH /api/channels/:id` — owner-only. Updates `description`, `category`,
  `is_private` (toggling private→public clears `invite_code`; public→private
  generates one).
- `POST /api/channels/:id/invite-code/regenerate` — owner-only.
- `POST /api/channels/join-by-code` — body `{ code }`. Looks up the channel by
  `invite_code`, adds caller as `role='member'`. `404` (generic "invalid or
  expired code") on no match — never reveals whether a code format was ever
  valid, to avoid enumeration.
- `GET /api/channels` (existing `list_channels`) — extends the existing
  DM-exclusion filter to also exclude `is_private=true` channels the caller
  isn't a member of, via a single indexed
  `WHERE is_private = false OR id IN (<caller's membership set>)` — filtered
  in the query, not fetched-then-filtered in application code.
- `GET /api/channels/:id/members` — returns the member list with roles, for
  the settings modal's Members section. 403 for non-members of a private
  channel. Deliberately uncached (see Performance below) — it's an on-demand,
  low-frequency read.
- `POST /api/channels/:id/members/:user_id/role` — owner-only. Body
  `{ role: 'moderator' | 'member' }` (promote/demote).
- `DELETE /api/channels/:id/members/:user_id` — owner or moderator. A
  moderator cannot kick the owner or another moderator — only the owner can
  remove peers or demote/promote.
- Message deletion gains an owner/moderator bypass: `delete_message` currently
  requires `user_id = <author>`; owner/moderator callers get a second query
  path with no author constraint (still scoped to the given `channel_id`).
  Editing is unaffected — only the author can edit their own message, in
  Slack/Discord too. Pinning is unaffected — it's already open to any member
  and this pass doesn't restrict it.

All role/ownership checks above (`PATCH`, invite-code regeneration, role
changes, kicking, the moderator message-delete bypass) are enforced
**server-side** on every request, regardless of what the client UI currently
offers — the UI hiding
an action (e.g. a moderator's kebab menu not showing "kick" for another
moderator) is a UX convenience, never the actual access boundary.

### Performance

- `invite_code`'s `UNIQUE` constraint gives an indexed O(1) lookup for
  join-by-code.
- `category` gets a plain index since the palette's grouped-browse view
  `GROUP BY category`s on every open (a hot, frequent read).
- Role checks happen on the hottest paths in the app (every message-delete
  or kick action). Rather than a Postgres round-trip per action,
  `role` rides in the **existing Redis membership cache** (the same one
  already reloading `channel_members` into Redis on WS connect) —
  `HGET channel:{id}:members {user_id}` returns the role alongside membership
  in one read, no separate DB hit.
- `GET /api/channels/:id/members` stays a direct indexed Postgres query,
  uncached — it's opened on-demand (not per-message), so caching it isn't
  worth the invalidation complexity.
- List-channels filtering uses one indexed query with an `OR`/`IN` clause,
  not two round-trips.

## Frontend UX

**Channel creation** (existing flow, extended): the current "create channel"
input gains a category field (autocomplete against existing categories,
freeform) and a private toggle. If private, the response's invite code is
shown once in a copyable confirmation ("Channel created — invite code:
`x7k2m9`").

**Browsing channels in the palette:** the empty-query / "channels" filter
view groups results under category headers (uncategorized channels under a
plain "Channels" heading, others under their category name). Active text
search stays a flat fuzzy match across all channels — grouping only applies
to browsing, since a search result grouped by category would be extra visual
noise for a query that's already narrowed things down.

**Joining a private channel:** a new palette command, `grove: join private
channel`, opens a one-field inline prompt for the invite code — reusing the
palette's existing single-input pattern rather than a new modal, since it's
one value, not structured data.

**Channel Settings modal:** opened via a small gear icon in the chat header
(which also gains a member-count display, new to Grove) or the `grove:
channel settings` palette command. Two sections:
- **Overview:** description (textarea, owner/moderator editable), category
  (autocomplete, owner editable), private toggle + invite code
  display/regenerate (owner only).
- **Members:** list of current members with a role badge
  (owner/moderator/member); each row has a kebab menu with role-appropriate
  actions (owner sees promote/demote/kick for everyone but themself;
  moderator sees kick for plain members only).

Non-owners/non-moderators opening the modal see a read-only Overview
(description/category, no privacy controls) and a plain Members list with no
action menu. This modal is also where the member list — which doesn't exist
anywhere in Grove today — gets introduced; it's deliberately not a new
persistent aside panel, to avoid reintroducing sidebar-like permanent chrome.

## Error Handling & Edge Cases

- **Bad/expired invite code:** generic `404`, no enumeration signal.
- **Regenerating an invite code:** old code stops working immediately
  (overwritten, not soft-deleted) — no grace period, matches Discord's
  default invite-revocation behavior.
- **Demoting/removing the owner:** not possible via the role-update endpoint
  — ownership transfer is out of scope for this pass, a known/accepted gap,
  not something to silently allow breaking. If the owner leaves a channel,
  ownership is not reassigned in this pass (channel becomes ownerless — a
  future pass can add explicit transfer).
- **Moderator tries to kick another moderator or the owner:** `403`,
  enforced server-side regardless of what the client UI offers.
- **Private → public toggle:** existing members keep their roles; the
  invite code is cleared. Flipping back to private later generates a fresh
  code.
- **Near-duplicate categories** (e.g. "General" vs "general"): out of scope
  — freeform means freeform, no fuzzy-merge logic in v1. A known minor rough
  edge, not a defect.

## Testing / Verification

- **Frontend** (`grove_client`, no test framework — established convention):
  `tsc -b` + `eslint` + `npm run build` + manual browser check.
- **Backend** (`chat_server`): new endpoints (join-by-code, role changes,
  permission checks) get real `#[tokio::test]` integration tests against a
  test DB, with particular attention to the permission-boundary cases —
  moderator-can't-kick-owner, non-member-can't-see-private-channel-in-list,
  non-owner-can't-toggle-privacy — since these are exactly the kind of thing
  that regresses silently if only covered by manual testing.
- `cargo fmt` + `cargo clippy` before every backend commit, per this
  project's standing rule.
