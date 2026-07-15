# Nav/Icon-Button Hover-Scale Consistency — Design Spec

**Date:** 2026-07-15
**Branch:** `feature/nav-rail-chip-rollout` (off `dev`)
**Scope:** Three CSS rules in `darkwood.css`. No JSX, no new files, no new tokens.

## Motivation

This was originally scoped as "roll out the chip-button treatment to the nav rail and panel list rows," following the pass-1 plan's rollout order. Investigation before design showed that premise doesn't hold: `NavRail.tsx` is dead code (never imported), there is no persistent side panel (navigation is exclusively the `Ctrl+K` command palette plus the tab bar), and the actual top-bar/icon buttons (`.dw-topbar-logo`, `.dw-topbar-btn`, `.dw-icon-btn`) are already chip-shaped — `border-radius: var(--r-sm)`, background appears on hover/active. What they're missing is the hover-scale micro-interaction pass 1 added to the message-action chips and the send button. User chose the narrow scope: finish that one piece of consistency, nothing broader.

## Change

Add `transform: scale(1.05)` on hover to:
- `.dw-topbar-logo:hover` (darkwood.css ~1899)
- `.dw-topbar-btn:hover` (darkwood.css ~2006)
- `.dw-icon-btn:hover` (darkwood.css ~657)

Each rule's `transition` property gains `, transform var(--dur-fast)` so the scale animates rather than snapping.

## Explicitly excluded

`.dw-topbar-avatar` — circular, already has its own established hover language (`box-shadow: 0 0 0 2px var(--leaf)` ring glow, matching `.dw-msg-avatar:hover` from pass 1). Adding scale here would mix two different hover idioms on the same class of element; the ring glow already reads as "designed," per the project's design-quality checklist.

Tab bar (`.dw-tabitem`), command palette (`.dw-palette-item`) — out of scope per the user's chosen narrow option. Not chip-shaped buttons in the same sense (tabs have their own active-indicator-bar language; palette items are full-width list rows, not compact icon buttons) — bundling them in would be scope creep beyond what was approved.

## Testing / verification

No test framework in `grove_client` (established in pass 1). Verification: `tsc -b`, `eslint` on `darkwood.css`-adjacent changed files (N/A here, CSS-only — the check is really just visual), `npm run build`, and a manual hover check in the running app on all three button families.
