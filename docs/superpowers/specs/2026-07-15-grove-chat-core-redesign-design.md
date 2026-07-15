# Grove Chat-Core Redesign — Design Spec

**Date:** 2026-07-15
**Branch:** `feature/chat-core-redesign` (off `dev`)
**Scope:** Visual + structural redesign of the chat message surface only — `MessageList.tsx`, a new `MessageActions.tsx`, and `MessageInput.tsx`. Nothing else.

## Motivation

The app "still doesn't look too good." The user supplied a Dribbble reference ("Intuitive Web Chat Design") as visual inspiration, and reactbits.dev as a component source for future polish. Grove already has a documented design system (Darkwood, in `GROVE_HANDOFF.md`) and an explicit long-term UI philosophy: no Discord/Slack-style persistent sidebar, `Ctrl+K` command palette as primary nav. This redesign must take *visual* cues from the mockup — spacing, card treatment, chip buttons, rich content cards — without adopting its 3-column-sidebar skeleton or its WhatsApp-style gradient message bubbles.

Target users are developers pairing/collaborating and gamers in voice/chat together: the bar is "fast, functional, low-noise, not decorative," not maximal visual richness.

## What this pass explicitly does NOT do

- No changes to `AppShell.tsx` or `NavRail.tsx` (nav rail / chip-button rollout to other surfaces is a separate future pass, done after this one is verified working end-to-end).
- No link-preview cards (depends on a not-yet-built backend unfurl endpoint — separate future work, tracked in `GROVE_HANDOFF.md` section 3).
- No read receipts / delivery tracking (needs new backend state — explicitly deferred by the user pending seeing how the timestamp-on-hover treatment looks first).
- No reactbits components. The reactbits MCP server is connected but its tools were not reachable in the session that produced this spec (newly-added MCP servers appear to need a fresh session to register). Motion in this pass is CSS-only; reactbits-driven entrance/motion is deferred to a later pass once verified reachable.
- No new colors/tokens. Everything is drawn from the existing Darkwood token set in `darkwood.css` (`--leaf`, `--leaf-bright`, `--surface-0/1/2/3`, `--text-primary/secondary/muted`, `--dur-fast`, `--ease-out`, etc.).

## Layout & positioning

Message rows split into two lanes within the message list column:

- **Incoming bursts** (not the current user): avatar pinned to the outer-left edge, text block left-aligned immediately to its right. This matches current behavior.
- **Outgoing bursts** (current user): avatar pinned to the outer-right edge, text block right-aligned immediately to its left. This is the new behavior — mirrored, not just recolored.
- Each lane's text block caps at **~70% of the content-area width**, leaving a visible gutter between the two lanes at all viewport widths. This gutter is what makes the left/right split legible at a glance, especially on wide aside-collapsed layouts.
- Burst grouping is unchanged: consecutive messages from the same sender within the existing time/gap threshold collapse into one avatar, shown once at the top of the burst. This logic already exists in `MessageList.tsx` and is reused, not rewritten — only the side it renders on changes for outgoing bursts.
- No message bubbles. No background pill/rounded container behind message text, for either side. This is a deliberate rejection of the Dribbble mockup's WhatsApp-style gradient bubble treatment, per explicit user direction ("techies," not WhatsApp).

## Labels

- Incoming bursts: keep the existing username header (`text-sm weight-medium`, `text-primary`) above the first message of the burst.
- Outgoing bursts: **no username label.** It's redundant (it's always the current user) — just the avatar and the message text, mirroring how Messenger/iMessage-style split layouts drop the sender name on the self column. This reduces visual clutter on the side the user looks at most often (their own outgoing history).

## Timestamps (this pass — no read receipts)

Two timestamp mechanisms coexist:

1. **Burst-header timestamp** — unchanged from current behavior: shown once per burst, next to the username on incoming bursts, or alone (right-aligned) on outgoing bursts.
2. **Per-message hover timestamp (new)** — hovering *any individual message row* within a multi-message burst reveals a small `text-muted`, `font-mono`, `text-xs` timestamp at the row's outer margin (the side opposite the avatar). This mirrors Slack's continuation-row hover-timestamp pattern, requested explicitly by the user. Implementation is pure CSS: the timestamp element is always in the DOM with `opacity: 0; transition: opacity var(--dur-fast) var(--ease-out);`, flipped to `opacity: 1` on `.dw-msg-row:hover`. No new component state, no new data — the timestamp value is already available on every message object.

Read receipts (checkmarks) are explicitly deferred. The user wants to see the timestamp-only treatment first before deciding whether the backend delivery/read-state work is worth doing.

## Hover action bar → chip buttons

The existing per-message hover action bar (react, reply, edit, delete — visible on `.dw-msg-row:hover`) is restyled from bare icons to **rounded-square chip buttons**: `surface-2` background at rest, `surface-3` on hover, using the existing `--r-sm` radius token, with a fade/scale-in transition (`opacity` + `transform: scale()`, `--dur-fast`, `--ease-out` — compositor-friendly properties only, per the project's CSS animation rules). This is extracted into its own `MessageActions.tsx` component (see below) so it can be reused verbatim by both `IncomingRow` and `OutgoingRow`.

`MessageInput.tsx`'s send button gets the same chip treatment for visual consistency within this pass's surface. Note: attach/emoji buttons do not exist in the current input (the handoff lists an attachment button as a future item) — this pass does not add them, only restyles what's already there (send button, mention-suggestion list items).

## Component structure

Current state: `MessageList.tsx` is 460 lines and already mixes burst-grouping logic, markdown rendering, edit-mode state, reaction rendering, and pin display inside a single `MsgRow` function. This pass splits it:

```
grove_client/src/components/
  MessageList.tsx      — burst-grouping, pagination, scroll logic (unchanged responsibilities,
                          now delegates row rendering to IncomingRow/OutgoingRow instead of MsgRow)
  MessageRow/
    MessageBody.tsx     — side-agnostic: markdown text, reactions display, edit-mode input/textarea,
                          pin indicator. Takes no knowledge of which side it renders on.
    IncomingRow.tsx     — thin wrapper: avatar-left layout, username header, renders MessageBody
    OutgoingRow.tsx     — thin wrapper: avatar-right layout, no username header, renders MessageBody
                          (mirrored via flex-direction/justify-content, not duplicated CSS)
    MessageActions.tsx  — the hover chip action bar (react/reply/edit/delete), shared by both rows
```

`MessageBody` owns everything that doesn't care about side (markdown parsing via the existing `parseMarkdown`, reaction pills, edit textarea swap, pin badge). `IncomingRow`/`OutgoingRow` own only positioning: which side the avatar sits on, whether the username header renders, and the mirrored flex layout. This keeps each file focused on one concern and sets up a clean seam for later passes (e.g. adding read receipts only touches `OutgoingRow` + `MessageBody`, not layout logic).

`MessageList.tsx` itself keeps its current responsibilities (IntersectionObserver pagination, scroll-position preservation, `forwardRef`/`useImperativeHandle` for `startEdit()`) — those aren't touched by this pass, just delegate to the new row components instead of inline-rendering `MsgRow`.

## Colors / tokens

No new tokens are introduced. All treatment (chip backgrounds, hover states, timestamp color, gutter spacing) uses existing `darkwood.css` custom properties. This sidesteps the two-accent-color pattern in the Dribbble mockup (purple bubbles + lime CTAs) entirely — Grove's single `--leaf` family stays the only accent, per the project's existing "Do" rule.

## Motion

CSS-only for this pass, all on compositor-friendly properties (`opacity`, `transform`) per the project's animation-performance rules:

- Hover chip bar: fade + scale-in on row hover.
- Per-message timestamp: opacity fade on row hover.
- No entrance/stagger animations, no reactbits components. These are explicitly deferred to a later pass (see "What this pass explicitly does NOT do").

## Testing / verification

- Manual verification in the running dev app (`npm run dev`) covering: single messages, multi-message bursts from both self and others, mixed conversation with rapid back-and-forth (to confirm the left/right split stays legible), narrow and wide viewport widths (confirm the 70% lane cap holds the gutter), hover states for both the chip action bar and the per-message timestamp, and edit-mode (confirm `MessageBody`'s edit textarea still works identically on both sides).
- `npm run build` (tsc) and `npm run lint` must stay clean relative to the pre-existing baseline (the 8 pre-existing lint errors in `AppShell.tsx`/`MessageList.tsx` documented in this session are out of scope for this pass and should not be "fixed" as a side effect — only new code must be lint-clean).
- No backend changes in this pass, so no backend test surface.

## Rollout

This is pass 1 of an explicitly multi-pass redesign (per the user: "first pass can be the chat core and then the second pass can be nav rail etc, each pass after we verify everything works properly"). Follow-on passes, each to be brainstormed and speced separately once this one is verified:

1. Nav rail + panel list rows → chip-button rollout beyond chat core.
2. Link-preview cards (depends on the backend unfurl endpoint from `GROVE_HANDOFF.md` section 3).
3. reactbits-driven motion, once the MCP server's tools are confirmed reachable.
4. Read receipts, if the timestamp-only treatment turns out to not be enough.
