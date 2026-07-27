# Multi-Pane Tiling & Unified Chrome — Design Spec

**Status:** Approved, pending implementation plan.

**Context:** This emerged from a 2026-07-27 brainstorm triggered by user feedback that Grove's UI feels safe/generic next to Discord/Slack and needs a genuine creativity pass, not just structural feature work (see `GROVE_HANDOFF.md`'s "Design tension" section, written the same day). It is a new initiative, not one of the four sub-projects already queued under the "Grove vs Slack/Discord" feature-parity overhaul (structure/organization [done], core messaging depth, presence & awareness, search) — this is a UI/UX architecture change that sits alongside that roadmap. **Sequencing this against sub-project 2 (Core messaging depth) and the previously-discussed hierarchy/depth/typography design pass is an open decision for the user, not resolved by this spec.**

Reference material the user supplied: a Discord-style chat-details panel (shared files/links/photos, quick chat-switching), an AI-chat product's tabbed-inbox layout (informational only — not adopted structurally, no top bar in that reference), and a Hyprland (tiling window manager) desktop screenshot as the aesthetic and interaction touchstone — tight gaps between tiled regions, nothing merged together, minimal chrome, clean reflow when the tile layout changes.

## Motivation

Grove today shows exactly one conversation at a time: a tab bar for switching between open channels/DMs, and a single full-width content area below a single full-width top bar. Discord and Slack have the same one-at-a-time limitation — neither supports viewing multiple conversations simultaneously. The user identified this as a genuine differentiation opportunity: a tiling, Hyprland-inspired multi-pane view that lets someone watch two conversations, or a call plus a conversation, side by side — while keeping Grove's existing keyboard-driven, palette-first, chrome-minimal philosophy intact rather than bolting on a traditional split-screen UI.

Three ideas that started as separate feature requests (a Discord-style chat-details panel, a second "app menu" command surface distinct from Ctrl+K, and the split-pane view itself) converged during brainstorming into one unified design: a single persistent chrome element that morphs between shapes depending on how many panes are open, plus a temporary command-surface shape reachable from any of them. Chat details stopped being a separate sidebar concept entirely — it's just another pane.

## The Chrome Object

There is one persistent UI element (not multiple independent overlays) that exists in one of three "pane-count states" at any time, plus a temporary fourth shape for commands. All transitions are animated reflows (Hyprland-style smooth transform, iPhone Dynamic-Island-style expand/collapse for the command shape) — never an instant cut or a fade. Exact easing/spring values are an implementation detail to source from reactbits.dev's relevant primitives during planning, not specified here.

**State 1 — single pane, full bar.** No split is active. The chrome renders as a long floating box (not a pill), offset ~5px from every screen edge — never edge-to-edge, never a hard strapped-in line. It contains the "grove" wordmark plus the open conversations as plain inline items appended into the same box (e.g. `grove   #general   #dev-chat   @sarah ×`) — this replaces today's separate tab-bar styling with the same floating-box treatment. The single visible pane keeps its own header (name + existing gear icon + a new "ⓘ Details" icon). This state's visual layout is the reference point for the *entire app's* new aesthetic going forward — floating/isolated chrome instead of edge-to-edge bars — not just something that only applies once panes exist.

**State 2 — split active, chrome-free panes.** Reached by creating a second pane (see Split Mechanics below). The chrome reflows and relocates to a pill on the left edge, shrunk to just enough width to show a vertical stack of plain numbers (`1`, `2`, `3`...) — not tab names as text (rejected during brainstorming as unreadable when rotated). Panes render with **zero chrome** — no header, no label, nothing but content, matching Hyprland's own window styling exactly. Hovering the pill fades all panes slightly and overlays each with its number (large) and its label (channel/DM name) underneath, for identification — the fade/reveal is the only way to see pane identity in this state; it is not visible by default.

**State 3 — maximally collapsed.** Reached by collapsing further from State 2. The pill shrinks down to a small circle (near-invisible, maximal room for panes). Simultaneously, the numbered labels that lived in the pill animate downward and become each pane's own permanent header (small strip at the top of the pane: left accent color for pane kind, small icon, name — this is the one state where panes DO show a label, unlike State 2).

**Island — temporary morph, any state.** A single dedicated keybind (distinct from `Ctrl+K`'s fuzzy-search palette) morphs whichever of the three shapes is currently active into a horizontal, icon-only capsule — expanding outward from a center point exactly like the iOS Dynamic Island growing for a Live Activity, not a dropdown or fade-in. Initial icon set (extensible, not fixed forever): settings, channels, messages, users, notifications, activity, "more". Arrow keys move focus between icons (with a visible focus ring), Enter or click selects. No text labels anywhere on the icons, no "menu" heading — it is only ever icons. Dismissing it (Escape, selecting an action, or the same keybind again) reverses the same animation back into **whichever pane-count state it was opened from** — State 1's full bar, State 2's numbered pill, or State 3's tiny circle. This is the mechanism Grove uses in place of a persistent settings/notifications sidebar, since the app has deliberately never had one.

## Split Mechanics

- **Creating a split:** a dedicated keybind opens a new, empty pane (moving the app from State 1 to State 2 if this is the first split). `Ctrl+K` then picks what fills it, same palette used for everything else — no new search surface for this.
- **Placement — two keybinds, both needed:**
  - Auto-dwindle: system places the new pane automatically (Hyprland's default dwindle behavior — new pane takes half the space of whichever pane is targeted, alternating split axis each time).
  - Directional: a `Ctrl+Shift+<arrow>`-style keybind places the new pane specifically to that side.
  - For directional splits, **the target pane is whichever pane the mouse cursor is currently hovering**, not keyboard focus — this matters once 2+ panes exist and avoids requiring an extra "focus this pane first" step.
- **State cycling (1↔2↔3):** State 1 is not a manual choice — it is the state that exists *only* when a single pane is open. Going from 1 pane to 2+ always enters State 2 or 3 (whichever was last active); going back down to exactly 1 pane always returns to State 1 automatically, regardless of which of State 2/3 was active beforehand. Between States 2 and 3, while 2+ panes are open, the choice is manual — separate collapse and expand keybinds step between "more headers" (3) and "more space" (2), since that's a preference the user should control (do I want pane labels, or do I want the extra pixels back), not something the pane count should decide for them. To avoid pure keybind-memorization (explicit user concern — "people will forget keybinds"), the pill/circle itself is also clickable to perform the same collapse/expand step. Every new keybind introduced by this spec should have a discoverable non-keybind fallback where one is cheap to provide.
- **`Ctrl+1`–`8`:** once 2+ panes exist, this shortcut switches between *panes* (matching the State 2 pill's own numbering — pane 1, pane 2, etc.), not between conversations within a pane. In State 1 (no split), it keeps its current, existing meaning: switch between open conversation tabs. This is a mode-dependent semantic shift and needs to be implemented as such, not left ambiguous.
- **Closing a pane:** needs its own action (not discussed explicitly during brainstorming) — recommend `Ctrl+W`, unused by Grove today. Closing panes down to exactly 1 remaining pane automatically returns the chrome to State 1 (per the State cycling rule above) — this is the one state transition that is never manual.

## Pane Kinds

Different pane contents have different sizing preferences and (for call/screen-share) different internal behavior. All kinds share the same tiling mechanics (dwindle math, State 2/3 chrome rules, closability) — only sizing preference and the one call/screen-share interaction rule differ.

| Kind | Sizing preference | Accent color (header, State 3 only) | Notes |
|---|---|---|---|
| Channel | Any — can be primary or secondary | `--leaf-bright` (green, matches existing design system) | Default kind |
| DM | Any — can be primary or secondary | Distinct blue-ish accent (exact value TBD during visual design) | Same behavior as Channel, different accent only |
| Notification | Prefers small/secondary, never auto-promoted to primary | Amber/gold | Compact list content, doesn't need room |
| Details (shared files/links/photos) | Prefers small/secondary, never auto-promoted to primary | Purple/violet | A satellite pane opened via the existing chat header's new "ⓘ Details" icon. It counts toward the 4-pane max and participates in the same dwindle sizing math as any other pane — but **opening/closing it never triggers a chrome-state transition on its own.** Only the dedicated split action moves the chrome from State 1 to State 2; Details can be open in either state without changing which one is active. |
| Call (voice only, no share) | **Not a pane at all** — nobody watches a voice call, so it doesn't occupy a pane slot or count toward the 4-pane max. It lives as a small icon/module embedded directly in whichever chrome shape is currently active (the State 1 bar, or the State 2/3 pill) — subtle active/pulsing indicator, hover or click reveals inline controls (mute, end, timer). No separate floating overlay widget — this replaces the old, never-built V2-spec "Voice Call Overlay" concept with something integrated into the chrome instead. | — | |
| Screen-share | **A real pane, created the moment sharing starts** — this is the one case a call becomes an actual pane. It auto-promotes to primary (bumping whatever was primary to secondary); participant video shrinks to a small thumbnail strip within this same pane (Zoom/Discord convention). Closing this pane **only stops the screen-share** — the call itself keeps going, uninterrupted, collapsing back down to the chrome-embedded indicator with no separate pane. Ending the call entirely is a distinct action (via the embedded controls), never a side effect of closing the share pane. | Distinct accent, TBD (only visible while a share pane exists) | |

**Max simultaneous panes: 4.** A voice-only call never counts toward this — it isn't a pane. Sizing among actual panes follows Hyprland's dwindle algorithm as a base, weighted by the kind table above (a Notification or Details pane should end up smaller than a Channel/DM pane even under equal dwindle math) — the exact ratio/weighting formula is implementation-tuning work, not specified here.

**Explicitly out of scope for this spec** (the underlying voice/call infrastructure itself): TURN servers, group-call SFU work, and general WebRTC hardening are a separate, already-queued initiative ("Voice Calling Server" in `GROVE_HANDOFF.md`'s Next Work). This spec only defines how a call's *pane* is sized and behaves once a call exists — not how calls are established or scaled.

## Keybind Summary

New shortcuts introduced by this spec (exact key combinations are a recommended default, not locked in — the implementation plan can adjust them, but every plan/implementation should pick *something* rather than leave them undefined):

| Action | Suggested default |
|---|---|
| Create split (opens empty pane) | `Ctrl+Shift+Enter` |
| Directional split | `Ctrl+Shift+<Arrow>` (targets hovered pane) |
| Collapse chrome, State 2→3 | `Ctrl+Shift+[` (also: click the pill) — only meaningful with 2+ panes open |
| Expand chrome, State 3→2 | `Ctrl+Shift+]` (also: click the circle) — only meaningful with 2+ panes open |
| Open command island | `Ctrl+Shift+Space` |
| Close focused/hovered pane | `Ctrl+W` |
| Switch pane / switch tab (mode-dependent) | `Ctrl+1`–`8` (existing shortcut, new panes-mode meaning) |
| Search / fuzzy palette | `Ctrl+K` (existing, unchanged) |

This is a genuinely large new keybind surface layered onto an already keyboard-heavy app — the user explicitly flagged wanting to avoid keybind bloat. Every state-cycling and pane-targeting action above has a click-based equivalent for this reason; `Ctrl+K` remains the discovery path for anything a new user hasn't memorized yet.

## What This Spec Does Not Resolve

- Exact colors for DM/screen-share pane accents, and the final Darkwood palette overall — folded into the still-pending, separately-scoped "dark grove color palette" refresh the user also raised, not decided here.
- Exact visual treatment of the chrome-embedded call indicator (icon choice, where in the bar/pill it sits, how the inline controls expand) — a visual-design detail for implementation, the mechanic itself (embedded, not a pane, not a separate floating widget) is decided.
- Exact reactbits.dev animation primitives/easing values to build the transforms on — a technical lookup for the implementation plan, not a design decision.
- Exact dwindle sizing ratios/weights per pane kind — implementation-time tuning.
- Manual pane resize (drag a pane border to resize) — not discussed; if wanted, it's an addition to a future spec, not assumed here.
- Whether/how this interacts with mobile or narrow viewports — Grove today has no responsive/mobile design story at all; out of scope.
