# Multi-Pane Tiling — Hyprland Visual/Motion Polish — Design Spec

**Status:** Approved, pending implementation plan.

**Context:** This amends `2026-07-27-multi-pane-tiling-chrome-design.md` after the feature shipped and was live-tested by the user in a real browser (via `docker compose -f docker-compose.prod.yml up --build`). Live testing surfaced two real functional bugs (fixed separately, see commits `12c6d5e` and `b63452c` on `feature/multi-pane-tiling-chrome`) and a much bigger gap: the original spec named Hyprland as "the aesthetic and interaction touchstone," but the implementation never actually delivered Hyprland's *feel* — no reflow animations, no dynamic-island morph, a flat gray palette, and a chrome-in-a-fixed-topbar structure that doesn't match the spec's own "pill relocates to the left edge" language. This spec closes that gap. It does not re-litigate anything already decided in the original spec (pane kinds, split mechanics, keybinds, State 1/2/3 definitions) — only the visual/motion execution and two pieces of genuinely new scope (manual pane resize, utility-icon placement).

Reference material: two Hyprland rice screenshots the user supplied directly (a Neovim/waybar setup with ASCII-fetch and clock widgets; a purple-themed desktop with Matrix-rain and btop panes) — both showing floating rounded panes with real gaps, blur, and a segmented pill-style status bar. Also carried forward from the original spec: `state2-fix.html` and `pane-states-v3.html` under `.superpowers/brainstorm/79798-1785146797/content/`.

## What's Changing

### 1. Visual system — "Forest Rice"

Grove's Darkwood system is deliberately single-accent (green, `--leaf-bright`). This pass keeps that identity rather than adopting the references' literal purple palette, but pushes the *presence* of that color much further:

- An ambient radial glow (green, with a secondary faint blue tint) sits behind the pane grid at all times, strong enough to be visible through the gaps between panes — this is the direct analog of the references' blurred-wallpaper-through-gaps effect, reinterpreted in Grove's palette instead of copying Hyprland's purple.
- Gap between tiled panes: **8px** (up from the current 5px) — enough for the glow to read, not so much it wastes space.
- Focused pane gets a visible green glow border (a real `box-shadow` glow, not the current barely-visible 1px inset shadow).
- Unfocused panes keep a thin, neutral border — color differentiation lives in the glow/focus state and in per-kind accents (chrome pill dots, minimal-header left-accent), not in per-pane border color.
- Chrome elements (pill, circle, island capsule) get a dark, blurred (`backdrop-filter: blur`), semi-transparent treatment — matching the references' segmented-pill look — with small colored dots per pane kind (channel green / DM blue / details purple) inside the State-2 pill.

### 2. Structural fix — chrome decouples from the fixed top bar

The shipped implementation nests `PaneChrome`'s State-2 pill and State-3 circle inside a fixed 44px-tall `<header>` alongside the notification bell, Friends toggle, and avatar — which is why the pill visually overflowed that bar (a bug flagged in the final review and now confirmed live). The fix:

- **State 1** is unchanged: full floating bar (wordmark + tab list) at the top, same as today, with the notification bell / Friends toggle / avatar still present exactly as they are now.
- **State 2/3**: the pill/circle becomes its own independently-positioned floating element (left edge), no longer a child of any fixed-height bar. The notification bell, Friends toggle, and avatar are removed from view entirely in these states — not hidden-but-present, actually unmounted — reachable only through the Dynamic Island (which already has "notifications" and "users" icons in its set) or `Ctrl+K`. This matches the original spec's own stated intent ("this is the mechanism Grove uses in place of a persistent settings/notifications sidebar") and matches both reference screenshots, where nothing persists on screen except the pill/status bar itself.

### 3. Motion system — Framer Motion (new dependency)

Grove currently has zero animation library dependencies (plain React + hand-written CSS). Implementing real reflow and shared-shape-morph animations by hand (manual FLIP calculations) would be significantly more fragile than using an established primitive built for exactly this. Framer Motion is added as a new dependency — it is styling-agnostic (no Tailwind pulled in), and its `layout`/`layoutId` props are the standard mechanism for both animations below. All animations use only compositor-friendly properties (`transform`/`opacity`) per the standing performance goal (Grove should be meaningfully more optimized than Discord) — nothing tweens `width`/`height`/`top`/`left` directly.

- **New-pane spawn ("push & squeeze")**: when a split is created, existing panes tween their own size smoothly as the new pane grows in from the split point — this is the literal behavior of Hyprland's own compositor when its window tree changes, and was chosen over two alternatives (a center "scale-pop," and an edge "slide-in") after seeing all three animated side by side.
- **Dynamic Island morph ("re-center")**: pressing the island keybind grows whichever chrome shape is currently active (State 1's bar, State 2's pill, or State 3's circle) outward *and* travels it to top-center as it becomes the icon-only capsule — matching real iOS Dynamic Island behavior, where the expanded shape always ends up in the same place regardless of what triggered it. Dismissing the island (Escape, selecting an action, or the same keybind) reverses the exact same animation back into whichever shape and screen position it started from. This was chosen over a simpler "morph in place" alternative (grow without traveling) after seeing both animated.

### 4. New interaction — manual pane resize (new scope, not in the original spec)

The original spec explicitly left manual resize undecided ("not discussed; if wanted, it's an addition to a future spec"). It's wanted now, prompted directly by the reference images showing uneven pane sizes:

- Drag the gap between two sibling panes to resize them live, adjusting the underlying `SplitNode`'s `ratio` (already a first-class field in `paneLayout.ts`'s tree model — this feature reads and writes that value, it doesn't need a new data structure).
- The full 8px gap is the draggable hit-area, but the visible handle (a thin vertical/horizontal bar) only brightens and thickens when the cursor is actually near it, so gaps don't visually announce themselves as interactive everywhere, matching the overall "minimal until you need it" feel of the rest of the chrome.
- Resize is mouse-only for now (matching how the user wants it) — no keybind equivalent is being added in this pass, unlike every other pane-tiling action, which deliberately has both an accessible click/keybind path. This is an intentional, scoped exception, not an oversight.
- A manually-dragged ratio must persist as a durable override on that specific `SplitNode` — opening or closing a pane somewhere else in the tree must not silently reset a resize the user already made. The implementation plan needs to confirm exactly how this interacts with `paneLayout.ts`'s existing weight-based `rebalance()` (used today to assign initial ratios when a split is created) so a later, unrelated structural change doesn't recompute away a manual resize.

### 5. Empty-pane placeholder

Replaces the current bare "Press Ctrl K to fill this pane." text with a dashed-outline icon (a simple rounded square with a centered plus) above a gently, slowly pulsing `Ctrl K` hint (a pure-opacity CSS animation, cheap, non-distracting).

## What This Spec Does Not Resolve

- Exact Framer Motion spring/easing constants — an implementation-time tuning detail, not a design decision (informed by, but not copied verbatim from, reactbits.dev, per the original spec's own framing).
- Per-kind pill dot colors beyond the three already established in `PaneGrid.tsx`'s `KIND_ACCENT` (channel/DM/details) — Notification's accent already exists in that constant and carries over unchanged; this spec doesn't revisit those hex values.
- Desktop-app packaging (Tauri/Electron, etc.) — explicitly noted by the user as future context only, not part of this pass.
- Whether/how a `performance-code-optimizer` tool referenced by the user (`mcpmarket.com/tools/skills/performance-code-optimizer`) gets incorporated — its actual contents could not be retrieved (rate-limited, then blocked by a bot-checkpoint) as of this writing; to be revisited before implementation begins, not blocking this spec.
- Any changes to the already-fixed header/chrome ownership split (`ChatView`'s `headerMode` prop, `PaneGrid`'s header-ownership gating by pane kind) landed in commit `b63452c` — this spec builds on top of that structure, restyling it, not replacing it.

## Relationship to the Original Spec

Everything in `2026-07-27-multi-pane-tiling-chrome-design.md` not explicitly revised above still stands: the three chrome states' structural definitions, split mechanics (dwindle/directional), pane kinds and their sizing weights, the keybind table (including the `Ctrl+W` → `Ctrl+Shift+W` correction made during live-testing bugfixing, since bare `Ctrl+W` collides with the browser's own reserved close-tab shortcut), and everything under "What This Spec Does Not Resolve" there (call/screen-share panes, mobile support, etc.).
