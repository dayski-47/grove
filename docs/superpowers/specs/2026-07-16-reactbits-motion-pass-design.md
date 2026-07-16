# Reactbits-Driven Motion Pass — Design Spec

**Date:** 2026-07-16
**Branch:** `feature/reactbits-motion-pass` (off `dev`), Darkwood V3 Pass 3
**Scope:** New shared motion components/hook + targeted call sites in `AppShell.tsx`, `LoginScreen.tsx`, `MessageList.tsx`, `MessageRow/*`, `MessageInput.tsx`, plus new keyframes/rules in `darkwood.css`. No new npm dependencies.

## Motivation

Pass 3 of the Darkwood V3 redesign (see `GROVE_HANDOFF.md`) was blocked because the reactbits MCP server's tools weren't reachable in the session that connected it. They're reachable now. Grove's motion system today is 100% hand-rolled CSS keyframes/transitions — zero animation dependencies in `grove_client/package.json`. Most reactbits components depend on `framer-motion`, and its flashy background effects (Aurora, Particles, Silk, etc.) depend on WebGL/canvas libraries — neither fits Grove's "faster/lighter than Discord" performance goal or its restrained, single-accent-color Darkwood visual language.

**Decision: port CSS/vanilla-JS only, no new dependencies.** Confirmed feasible by reading two representative reactbits sources via the MCP `get_component` tool: `DecryptedText`'s `motion.span` usage is incidental (a plain `span` does the same job — the reveal logic is a plain `setInterval` character-swap), and `ClickSpark` is already zero-dependency (`<canvas>` + `requestAnimationFrame`, no framer-motion at all). Both port cleanly into Grove's existing keyframe-and-vanilla-hook style.

## Approach chosen

Of three options considered (single anchor motif only / motif + targeted accents / maximal distinct-pattern-per-surface), the user chose **motif + targeted accents**: one coherent decrypt-reveal motif reused for brand/identity text moments, small targeted accents at two action points, and chrome (toasts/palette/notification panel) explicitly left alone rather than layering on a competing motion language right after the Pass 2 hover-scale consistency work finished there.

## Section 1 — Decrypt-reveal brand motif

New shared piece — a `useDecryptReveal(text: string): string` hook (returning the current display string, mount-triggered) plus a thin `DecryptReveal` presentational wrapper for the two call sites, ported from reactbits' `DecryptedText`: mounts static text scrambled with random character-swap noise, then resolves it left-to-right to the real text over ~400-600ms via `setInterval`, no framer-motion. Scrambled glyphs render in `text-muted`/`leaf-dim` tones to stay inside the one-accent-color palette — no rainbow-scramble effect. Respects `prefers-reduced-motion`: reduced-motion users see the final text immediately, no scramble frames rendered.

Applied to exactly two moments (both currently static text, both trigger once per mount):
- **Empty state** (`AppShell.tsx`, `EmptyContent()`): the `gv-empty-brand` "grove" wordmark and the `gv-empty-tagline` line.
- **Login screen** (`LoginScreen.tsx`): the `dw-login-brand-name` "grove" wordmark.

**Explicitly out of scope:** the existing `gv-enter-grove` zoom/brighten/fade-out transition on successful login (`darkwood.css` ~2341-2350) stays untouched — it's already a strong, tuned "walking into the light" moment; layering a second effect on top would fight it, not complement it.

## Section 2 — Message list micro-interactions

**Staggered new-message entrance.** Only genuinely new, live-arrived messages get a subtle entrance (fade + translateY-up, `--ease-out`, ~220ms, ~40ms stagger offset per message within a burst). Never plays on initial channel load (would animate the entire loaded history at once) and never on scroll-up pagination (which already has its own scroll-position-preservation logic in `MessageList.tsx` — animating prepended history would fight that).

Mechanism: `MessageList` keeps a ref of previously-seen message keys. On each `messages` prop change, it diffs the new array against that ref and flags a message as "just arrived" only if its key is new *and* it's appended at the tail *and* this isn't the component's first render. That boolean is passed down to `IncomingRow`/`OutgoingRow` to toggle the entrance class. No cleanup/reset logic needed — a message is flagged once; React won't re-trigger a CSS animation by re-applying an unchanged class string on a later render for an unrelated reason (e.g. a reaction changing elsewhere in the list).

**Reaction pop.** When a reaction's count changes, its chip is keyed on `${emoji}-${count}` so React remounts the DOM node on every count change, which naturally replays a small scale-in entrance. Reuses the existing `--ease-spring` token already defined in `darkwood.css` (the same curve used for the toast entrance) — no new easing curve, no manual animation-restart bookkeeping.

## Section 3 — Action-point accent: send-button spark

On successful message send, a brief burst of thin radiating lines in `--leaf-bright` fires from the send button — a near-direct port of reactbits' `ClickSpark` (already zero-dependency: `<canvas>` overlay sized to the button + `requestAnimationFrame` draw loop). Scoped tightly to stay restrained: ~350ms duration, 6-8 thin lines, fires only on the send button (not a global click-spark on every click in the app, which would be noisy and off-brand for "techies, not consumer chat app"). Skipped entirely under `prefers-reduced-motion`.

Reaction-add already gets its accent from the Section 2 pop — no separate treatment needed there.

## Section 4 — Chrome (nav, toasts, palette, notification panel): no changes

Audited existing chrome animations (`dw-fade-up`, `dw-fade-in`, `dw-slide-in`, `dw-palette-in`, `gv-toast-in`/`gv-toast-out`) against reactbits idioms. Conclusion: leave as-is. They already use consistent, tuned easing curves and are restrained; Pass 2 just finished the hover-scale consistency work on this exact surface. Adding a new reactbits-inspired motif here now would dilute that work and push past Darkwood's "one accent, restrained" discipline for no real gain. This is a deliberate "reviewed, no action needed" outcome, not a skipped section.

## Testing / verification

No test framework in `grove_client` (established in Pass 1). Verification: `tsc -b`, `eslint`, `npm run build`, and manual browser checks covering:
- Empty state and login wordmark/tagline decrypt-reveal on fresh mount
- Reduced-motion (`prefers-reduced-motion: reduce`) shows final text/state immediately, no scramble/spark/stagger
- New live message arrival animates; scrolling up to load history does not; opening a channel with existing history does not
- Reaction count change pops; send button sparks on send
- No regressions to the Pass 1/2 message layout, hover-scale, or the `gv-enter-grove` login transition

Docker rebuild required to see changes in the running app per project convention (`docker compose -f docker-compose.prod.yml up --build`).
