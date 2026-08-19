# Grove design/craft pass — design doc

Status: approved by user, ready for planning
Date: 2026-08-07

## Why

Standing feedback has been that Grove's UI "reads generic." This pass targets the
token-level foundation (typography, depth, icon language) rather than any single
screen, since components already consume `darkwood.css` tokens.

## Scope

Token-level only: typography pairing, depth/surface treatment, icon language.
No layout changes. No new components. No sidebar — Grove has never had one (see
"Rejected direction" below for why that matters).

## Grove's actual shape (context for every decision below)

Grove is closer to a tiling window manager (Hyprland/Waybar) than a typical chat
app:

- No persistent channel sidebar. Navigation is a Ctrl+K command palette
  (`.dw-palette`) plus a floating tab bar.
- `.dw-topbar` (44px) hosts `PaneChrome` — a small floating pill with a logo
  button (opens the palette) and tabs (`.pane-chrome-tab`).
- `.dw-chat-header` (48px) is the only real "heading" in daily use — channel
  name at 14px/500 Inter, `#` prefix already in `--font-mono`.
- State 2/3 (tiled multi-pane) reserves a rail (`.dw-tiled-rail`) with numbered
  pane pills (`.pane-chrome-pill-num`) — a literal Hyprland-workspace-number
  moment that already exists in the codebase, just under-styled.
- The empty-state "grove" wordmark (`EmptyContent.tsx`, `.gv-empty-brand`) has
  its own bespoke treatment: thin weight (200), 0.38em letter-spacing, soft
  green glow. Distinctive and already good.

## Rejected direction: serif display face

Original idea (from an earlier round of this same conversation) was a second
display typeface — a serif or slab (Fraunces / Zilla Slab / Almendra) — for
headings and the wordmark, paired with Inter for body text.

Dropped because:

1. Grove barely has heading real estate. Outside the wordmark, the only
   candidate was the 48px chat-header channel name — not enough surface to
   justify a whole second type family.
2. The wordmark already has a considered, distinctive treatment (see above).
   Replacing it with a bold serif would trade something specific and good for
   something generic-by-comparison.
3. A literary serif doesn't fit a tiling-WM-inspired app. It imports the wrong
   genre.

## Approved direction: mono-forward identity

Instead of a second display face, lean further into a pairing Grove already
half-does:

- **Inter** — conversational text: messages, author names, body copy.
  Unchanged.
- **JetBrains Mono** — structural/technical labels. Replaces Geist Mono as the
  `--font-mono` token value. Applied consistently to every structural/numeric
  label, including one spot that was inconsistent before:
  - `.pane-chrome-tab-prefix` (already mono — no change)
  - `.dw-chat-prefix` (already mono — no change)
  - `.pane-chrome-pill-num` (**new** — currently inherits `--font-ui`/Inter,
    switch to `--font-mono`; use `font-variant-numeric: tabular-nums`)
  - message timestamps (`.dw-msg-time`) — confirm/apply `--font-mono` +
    `tabular-nums`
- **Wordmark** (`.gv-empty-brand`) — unchanged. Not part of this pass.

Rationale: the tiled-pane rail's numbered pills are already a literal
workspace-indicator pattern (Hyprland/Waybar idiom) — making that number
explicitly monospace is the one place a "second face" earns its keep, because
it reinforces what Grove structurally already is instead of importing an
unrelated convention.

## Approved direction: depth (faint)

Widen surface separation slightly, keep everything else close to current:

```css
--surface-2: #161d16; /* was #141a14 */
--surface-3: #212c21; /* was #1c251c */
--glow-focus: 0 0 0 1px rgba(106,184,112,0.35), 0 0 16px rgba(106,184,112,0.12);
```

`--surface-0` and `--surface-1` stay as-is. `--glow-focus` is new — a faint
focus treatment for input-like surfaces (e.g. message composer), replacing a
harder border with a soft glow. No texture/grain (considered and rejected —
too much atmosphere for a "quiet professional" surface).

## Rejected: structural color hierarchy + section-spacing token

Two ideas from an earlier iteration of this pass — using `--leaf-dim` for
structural dividers (not just interactive states), and a dedicated
`--sp-section` token for gaps between "major regions" — were validated only
against an invented sidebar layout. Once corrected to Grove's real chrome,
neither had an honest home (no sidebar groups to divide; chrome is already
tight — 44px topbar, 48px header). Explicitly dropped rather than forced in.
If a real use case shows up later, revisit then.

## Approved: icon language

Current icon set (`components/appshell/icons.tsx`) is stock Feather-style
shapes (Bell, Friends/Users, Search, Msg, Phone, Remove, Close) that share
nothing visually with Grove's actual mark — a custom asymmetric single-leaf
silhouette used in `PaneChrome`'s logo button:

```
Mark (unchanged), viewBox 0 0 24 24, stroke, currentColor, stroke-width 1.5,
round caps/joins:
  M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z
  M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12
```

Direction: rebuild the icon set from the mark's own curve vocabulary (single
asymmetric silhouette, round caps, "grown not ruled" quality) instead of
generic stroke-icon shapes. Confirmed via mockup at both detail size and
actual in-app size (topbar icons render at ~17-18px).

**Bell** — stroke, matches mark's leaf-silhouette signature directly:

```
viewBox 0 0 24 24, fill none, stroke currentColor, stroke-width 1.5, round caps/joins
M12.5 3c3.6 0.4 5.7 3.2 5.3 7.7c-0.2 3.1 0.9 4.9 2.4 6.3h-15.4c1.6-1.5 2.6-3.3 2.4-6.6c-0.3-4.2 2.1-7 5.3-7.4z
circle cx=11 cy=19.3 r=1.15   (clapper)
```

**Search** — stroke, leaf-shaped (asymmetric) loop instead of a perfect circle:

```
M13.5 4c3 0.5 4.9 2.9 4.5 6.1c-0.3 2.8-2.6 4.5-5.3 4.5c-2.9 0-5.2-2.1-5.2-5.1c0-3.2 2.7-5.7 6-5.5z
M9 15.5 C7.3 17.3 5.4 19.1 4 20.3   (handle)
```

**Close / Remove** — stroke, two gently bowed diagonals instead of straight
lines (echoes the stem stroke's curve tension):

```
M6 6 Q14 10.5 18 18
M6 18 Q10.5 13.5 18 6
```

**Friends — deliberate exception, filled silhouette.** User supplied a
reference image (tree with roots, "family tree" concept) and asked for that
exact image; since it's an unverified-provenance raster asset that can't be
recolored via `currentColor`, it was hand-traced into an owned SVG path
instead — matching the reference's shape (round bushy canopy, tapered trunk,
five fanning roots) as closely as practical. Confirmed via mockup, both at
72px detail and actual 18px topbar size. This is intentionally the **one**
filled icon in an otherwise stroke-only set — not a signal to convert the
rest.

```
viewBox 0 0 24 24, fill currentColor, stroke none
M12 2.2 C13.6 2.1 15 2.9 15.6 4.3 C17.1 4.6 18.2 5.9 18.1 7.5
C19.3 8.4 19.6 10 18.8 11.3 C18.9 12.8 17.6 13.9 16.1 13.8
C15.3 14.9 13.7 15.3 12.3 14.8 C10.9 15.4 9.2 15 8.3 13.9
C6.8 14 5.5 12.9 5.5 11.4 C4.6 10.2 4.8 8.5 6 7.5
C5.8 5.9 6.9 4.5 8.4 4.3 C8.9 2.9 10.3 2.1 12 2.2 Z
M11.3 13.8 C11 15.5 11.2 17.3 10.7 19 C11.5 19.6 12.5 19.6 13.3 19
C12.8 17.3 13 15.5 12.7 13.8 C12.2 13.5 11.8 13.5 11.3 13.8 Z
M10.7 19 C9 19.8 7.2 20 5.3 21.2 C5.6 21.6 6 21.7 6.4 21.5
C8 20.4 9.5 20 10.9 19.6 Z
M11 19.3 C9.8 20.3 8.8 21.4 7.6 23 C8 23.2 8.4 23.1 8.7 22.8
C9.7 21.4 10.5 20.4 11.4 19.6 Z
M11.6 19.5 C11.4 20.8 11.3 22.2 11.1 23.6 C11.5 23.7 11.9 23.7 12.3 23.6
C12.2 22.2 12.2 20.8 12.1 19.5 Z
M13 19.3 C14.2 20.3 15.2 21.4 16.4 23 C16 23.2 15.6 23.1 15.3 22.8
C14.3 21.4 13.5 20.4 12.6 19.6 Z
M13.3 19 C15 19.8 16.8 20 18.7 21.2 C18.4 21.6 18 21.7 17.6 21.5
C16 20.4 14.5 20 13.1 19.6 Z
```

**Not yet designed:** `MsgIcon`, `PhoneIcon`. Both render side by side in
`FriendsPage.tsx`'s per-friend action row (alongside the now-redrawn
`RemoveIcon`) — deferring one without the other wouldn't actually fix that
row's mixed vocabulary, so both stay stock Feather icons together. Should
follow the same stroke-based, mark-derived vocabulary as Bell/Search/Close
when implemented; not blocking this pass.

Exact path coordinates above are from directional mockups, not
pixel-verified production art — expect minor tuning during implementation.

## Approved: Dynamic Island icons (`CommandIsland.tsx`)

Found during review: the island's seven action buttons render literal emoji
glyphs (`⚙ # 💬 👤 🔔 ⚡ …`) via `<span>{{item.icon}}</span>` in
`ISLAND_ITEMS`, not SVGs — missed on first pass because it's text, not
`<svg>`. Emoji ignore `currentColor` and render in full OS color, which is a
bigger mismatch against Grove's monochrome palette than the old stock icons
were. `.command-island-item` already sets `color` for focus/inert states, so
switching to `currentColor`-driven SVGs is a drop-in fit once `IslandItem.icon`
stops being a plain string.

Mapping — reuse where the concept already exists, design where it doesn't:

- **Notifications** (was 🔔) → reuse Bell exactly, no new path.
- **Users** (was 👤) → reuse the Friends tree-with-roots exactly, no new path.
- **Channels** (was `#`) → already plain mono text, not an emoji — unchanged.
- **More** (was `…`) → three plain dots (`<span class="dots">`), stays
  neutral, doesn't need the mark's language. Unchanged in spirit, just no
  longer an emoji character.
- **Messages, Settings, Activity** → new, designed below.

**Messages** — stroke, rounded bubble with a curved tail instead of a sharp
notch:

```
viewBox 0 0 24 24, fill none, stroke currentColor, stroke-width 1.6, round caps/joins
M6 4 C4.9 4 4 4.9 4 6 L4 12 C4 13.1 4.9 14 6 14 L8 14 L8 17.5
C8 17.9 8.5 18.1 8.8 17.8 L12.5 14 L18 14 C19.1 14 20 13.1 20 12
L20 6 C20 4.9 19.1 4 18 4 Z
```

**Settings** — stroke, seed-head: one center node, six satellites on short
spokes (deliberately not a mechanical gear — round nodes instead of teeth,
consistent with the "grown not ruled" quality elsewhere):

```
viewBox 0 0 24 24, fill none, stroke currentColor, stroke-width 1.6, round caps/joins
circle 12,12 r2.0 (center)
circles r1.2 at: 19,12 · 15.5,5.94 · 8.5,5.94 · 5,12 · 8.5,18.06 · 15.5,18.06
spokes (short lines center→each satellite):
M13.9 12.3 L17.2 12.1
M13.1 10.3 L14.7 7.1
M10.9 10.3 L9.3 7.1
M9.9 12 L6.6 12
M10.9 13.7 L9.3 16.9
M13.1 13.7 L14.7 16.9
```

**Activity** — stroke, asymmetric spark: five curved rays of varying length
radiating from center, small dot at each tip (inert — reserved for later):

```
viewBox 0 0 24 24, fill none, stroke currentColor, stroke-width 1.6, round caps/joins
M12 12 C12 9.3 11.7 7 12.3 4.6         + circle 12.3,4.2 r0.9
M12 12 C14 10.6 16 9.6 18 8.1          + circle 18.3,7.8 r0.9
M12 12 C14 13.4 16.4 14.5 18.8 15.6    + circle 19.1,15.9 r0.9
M12 12 C10 13.4 8 15 6.5 17.4          + circle 6.2,17.7 r0.9
M12 12 C9.6 10.1 7.1 9.1 4.9 8.6       + circle 4.5,8.5 r0.9
```

Confirmed via mockup showing all seven live in the actual island component
(44px pill, 34px circular buttons) plus an isolated legend.

## Files this touches (for planning)

- `grove_client/src/styles/darkwood.css` — `--font-mono` value, `--surface-2`/
  `--surface-3`, new `--glow-focus`, `.pane-chrome-pill-num` font-family,
  `.dw-msg-time` font-family/tabular-nums confirmation.
- `grove_client/src/components/appshell/icons.tsx` — `BellIcon`, `FriendsIcon`,
  `CloseIcon`/`RemoveIcon`, `SearchIcon` path data + fill/stroke attributes.
- `grove_client/src/components/panes/CommandIsland.tsx` — `IslandItem.icon`
  changes from `string` (emoji) to a render function/component reference;
  `ISLAND_ITEMS` gets the new Settings/Messages/Activity icons plus reused
  Bell/tree for Notifications/Users; Channels/More stay as they render today.
- Font loading: swap the Google Fonts `@import` (or equivalent) from Geist
  Mono to JetBrains Mono in `darkwood.css`.

## Explicitly out of scope

- Layout/structure changes of any kind (no sidebar, no new components).
- `MsgIcon` / `PhoneIcon` redesign (follow-up, same vocabulary — deferred
  together since they render side by side in `FriendsPage.tsx`).
- Structural color hierarchy and section-spacing tokens (rejected, see above).
- The empty-state wordmark (unchanged).
