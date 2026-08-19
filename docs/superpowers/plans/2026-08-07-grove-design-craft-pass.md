# Grove design/craft pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved token-level design pass to Grove's real UI — swap
the mono typeface, widen depth tokens, and replace every stock/emoji icon
(topbar, command palette, Dynamic Island) with icons drawn from the app's own
mark.

**Architecture:** Pure token/asset substitution. Two files carry almost all of
it: `darkwood.css` (CSS custom properties + a handful of selectors) and
`icons.tsx` (SVG path data on existing exported components). One file,
`CommandIsland.tsx`, changes shape — its `icon` field moves from a raw emoji
string to a component reference so it can render the new SVGs.

**Tech Stack:** React 19 + TypeScript, Vite, plain CSS custom properties (no
CSS-in-JS, no Tailwind). Vitest for unit tests (`environment: "node"`, no
jsdom/React Testing Library installed in this repo).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-07-grove-design-craft-pass-design.md`.
- No layout or component-structure changes. No new components beyond the
  small icon-glyph components needed for `CommandIsland`.
- Every new/changed icon: `viewBox="0 0 24 24"`, `aria-hidden="true"` on the
  `<svg>` root, `currentColor` for stroke or fill (never a hardcoded color).
- Stroke icons: `fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"`, `strokeWidth` as given per icon below (do not standardize to one value — they were tuned per shape).
- Exactly one filled icon in the whole set: the Friends/Users tree. Every
  other icon (existing or new) stays stroke-only. Do not convert others to
  filled "for consistency" — that was explicitly rejected in the spec.
- `--font-mono` becomes JetBrains Mono everywhere it's referenced — do not
  hand-pick a different mono face for any single selector.
- **Testing approach for this plan:** this codebase's Vitest setup
  (`vitest.config.ts`) runs with `environment: "node"` and includes only
  `src/**/*.test.ts` — there is no `@testing-library/react` / jsdom installed,
  and the one existing test file (`src/paneLayout.test.ts`) tests pure logic,
  not component rendering. Nothing in this plan adds business logic (it's CSS
  custom properties and SVG path data, plus one type change with no branching
  logic), so no new `.test.ts` files are introduced. Every task instead
  verifies via `npm run build` (runs `tsc -b && vite build` — catches type
  errors and JSX mistakes), `npm run lint`, and a specific manual check in the
  running dev server, per this project's standing convention of verifying UI
  changes in a real browser before calling them done.

---

## File Structure

- `grove_client/src/styles/darkwood.css` — modified. Font import line, 5
  custom properties (`--font-mono`, `--surface-2`, `--surface-3`, new
  `--glow-focus`), 3 selectors (`.dw-input-box:focus-within`,
  `.pane-chrome-pill-num`, `.dw-msg-time`), plus ~10 lines of new CSS for two
  tiny `CommandIsland` glyphs (`.hashlabel`, `.dots`).
- `grove_client/src/components/appshell/icons.tsx` — modified. `BellIcon`
  splits into `BellGlyph` (bare SVG, new export) + `BellIcon` (existing
  badge wrapper, now composes `BellGlyph`). `SearchIcon`, `CloseIcon`,
  `RemoveIcon`, `FriendsIcon` get new path data in place. Two new zero-prop
  exports: `SettingsIcon`, `MessagesIcon`, `ActivityIcon` (used only by
  `CommandIsland`, defined here alongside the rest of the icon set so all
  icon path data lives in one file).
- `grove_client/src/components/panes/CommandIsland.tsx` — modified.
  `IslandItem.icon` changes from `string` to `React.ComponentType`.
  `ISLAND_ITEMS` updated to reference components instead of emoji. Two new
  local zero-prop components (`HashIcon`, `MoreDotsIcon`) for the two items
  that aren't emoji today and shouldn't become mark-styled icons either.

No files are created. No files are deleted. No test files are added (see
Global Constraints).

---

### Task 1: Swap the mono typeface to JetBrains Mono

**Files:**
- Modify: `grove_client/src/styles/darkwood.css:1-2` (font import),
  `grove_client/src/styles/darkwood.css:46` (`--font-mono` value)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `--font-mono` token now resolves to a face that is actually
  loaded (today's `'Geist Mono'` is never imported anywhere in this file, so
  `--font-mono` has silently been falling through to `'Cascadia Code'` /
  `'Fira Code'` / system monospace this whole time — this task is the first
  time `--font-mono` reliably renders in the intended face). Tasks 3 and 8
  depend on this being loaded before their mono-styled elements are checked
  visually.

- [ ] **Step 1: Update the Google Fonts import to load both families**

Current (`darkwood.css:1-2`):
```css
/* Grove — Darkwood Design System V2 */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
```

Replace with:
```css
/* Grove — Darkwood Design System V2 */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
```

- [ ] **Step 2: Update the `--font-mono` token**

Current (`darkwood.css:46`):
```css
  --font-mono: 'Geist Mono', 'Cascadia Code', 'Fira Code', monospace;
```

Replace with:
```css
  --font-mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
```

- [ ] **Step 3: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0, no CSS syntax errors.

- [ ] **Step 4: Manual visual check**

Run: `cd grove_client && npm run dev`, open the app, log in, open any
channel. Look at a message timestamp (`.dw-msg-time`, e.g. "14:02" under an
author name) — it should render in JetBrains Mono's distinct double-story
`a` / slashed zero, not the browser's default monospace fallback.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/styles/darkwood.css
git commit -m "feat: load JetBrains Mono and make it the --font-mono value"
```

---

### Task 2: Widen depth tokens and apply the new focus glow

**Files:**
- Modify: `grove_client/src/styles/darkwood.css:15-16` (surfaces),
  `grove_client/src/styles/darkwood.css:39-42` (shadows — add new token),
  `grove_client/src/styles/darkwood.css:878-881` (`.dw-input-box:focus-within`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `--surface-2`, `--surface-3`, `--glow-focus` tokens available to
  any later task/selector that wants them (none of the remaining tasks in
  this plan reference them further, but they're now part of the token set
  per the spec).

- [ ] **Step 1: Widen `--surface-2` and `--surface-3`**

Current (`darkwood.css:13-16`):
```css
  --surface-0: #080b08;
  --surface-1: #0e130e;
  --surface-2: #141a14;
  --surface-3: #1c251c;
```

Replace with:
```css
  --surface-0: #080b08;
  --surface-1: #0e130e;
  --surface-2: #161d16;
  --surface-3: #212c21;
```

- [ ] **Step 2: Add the `--glow-focus` token**

Current (`darkwood.css:39-42`):
```css
  /* Shadows */
  --glow-sm:      0 0 10px rgba(106, 184, 112, 0.18);
  --shadow-panel: 0 8px 32px rgba(0, 0, 0, 0.55);
  --shadow-float: 0 24px 72px rgba(0, 0, 0, 0.85);
```

Replace with:
```css
  /* Shadows */
  --glow-sm:      0 0 10px rgba(106, 184, 112, 0.18);
  --shadow-panel: 0 8px 32px rgba(0, 0, 0, 0.55);
  --shadow-float: 0 24px 72px rgba(0, 0, 0, 0.85);
  --glow-focus:   0 0 0 1px rgba(106, 184, 112, 0.35), 0 0 16px rgba(106, 184, 112, 0.12);
```

- [ ] **Step 3: Apply the glow to the message composer's focus state**

Current (`darkwood.css:878-881`):
```css
.dw-input-box:focus-within {
  border-color: rgba(106, 184, 112, 0.22);
  box-shadow: 0 0 0 3px rgba(106, 184, 112, 0.05);
}
```

Replace with:
```css
.dw-input-box:focus-within {
  border-color: rgba(106, 184, 112, 0.22);
  box-shadow: var(--glow-focus);
}
```

- [ ] **Step 4: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0.

- [ ] **Step 5: Manual visual check**

In the running dev server, open any channel and click into the message
input box at the bottom. Confirm: the focus ring is a soft, faint green glow
(not a hard 3px ring), and panels/avatars against the chat background read
as a visibly distinct step lighter than pure background, not near-identical
to it.

- [ ] **Step 6: Commit**

```bash
git add grove_client/src/styles/darkwood.css
git commit -m "feat: widen surface-2/3 contrast and add a faint composer focus glow"
```

---

### Task 3: Make mono usage consistent (pane-pill numbers + timestamps)

**Files:**
- Modify: `grove_client/src/styles/darkwood.css:2015-2019`
  (`.pane-chrome-pill-num`), `grove_client/src/styles/darkwood.css:518-523`
  (`.dw-msg-time`)

**Interfaces:**
- Consumes: `--font-mono` from Task 1 (must be JetBrains Mono for this task's
  visual check to mean anything — do this task after Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Make the tiled-pane rail's numbers monospace**

Current (`darkwood.css:2015-2019`):
```css
.pane-chrome-pill-num {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
}
```

Replace with:
```css
.pane-chrome-pill-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Add tabular-nums to message timestamps**

Current (`darkwood.css:518-523`):
```css
.dw-msg-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
}
```

Replace with:
```css
.dw-msg-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual visual check**

In the dev server, switch to the tiled multi-pane view (open two panes side
by side — the app's existing multi-pane toggle) and confirm the small
`01`/`02` numbers in the reserved rail strip render in JetBrains Mono, matching
the `#` prefixes elsewhere instead of standing out in Inter.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/styles/darkwood.css
git commit -m "fix: make pane-pill numbers monospace, matching tab/header prefixes"
```

---

### Task 4: Redraw Bell — split into `BellGlyph` + `BellIcon`

**Files:**
- Modify: `grove_client/src/components/appshell/icons.tsx:1-15`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `BellGlyph(): JSX.Element` — new, zero-prop, bare SVG (no badge
  wrapper). Consumed by Task 8 (`CommandIsland`'s Notifications action).
  `BellIcon({ count }: { count: number }): JSX.Element` — existing signature,
  unchanged; still what `AppShell.tsx:1227` uses.

- [ ] **Step 1: Replace `BellIcon` with a split `BellGlyph` + `BellIcon`**

Current (`icons.tsx:1-15`):
```tsx
export function BellIcon({ count }: { count: number }) {
    return (
        <div className="dw-bell-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {count > 0 && (
                <span className="dw-bell-badge" aria-hidden="true">
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </div>
    );
}
```

Replace with:
```tsx
export function BellGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.5 3c3.6 0.4 5.7 3.2 5.3 7.7c-0.2 3.1 0.9 4.9 2.4 6.3h-15.4c1.6-1.5 2.6-3.3 2.4-6.6c-0.3-4.2 2.1-7 5.3-7.4z"/>
            <circle cx="11" cy="19.3" r="1.15"/>
        </svg>
    );
}

export function BellIcon({ count }: { count: number }) {
    return (
        <div className="dw-bell-wrap">
            <BellGlyph />
            {count > 0 && (
                <span className="dw-bell-badge" aria-hidden="true">
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0 — confirms `AppShell.tsx`'s existing `<BellIcon count={totalUnread} />` call still type-checks unchanged.

- [ ] **Step 3: Manual visual check**

In the dev server, look at the topbar bell button. Shape should read as an
asymmetric, single-silhouette bell (leaning curve, not a symmetric dome) with
a small round clapper — not the old generic Feather bell. Trigger an unread
notification if possible to confirm the badge still renders correctly
positioned over the new shape.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/appshell/icons.tsx
git commit -m "feat: redraw BellIcon from the mark's curve signature, split out BellGlyph"
```

---

### Task 5: Redraw Search

**Files:**
- Modify: `grove_client/src/components/appshell/icons.tsx` (`SearchIcon`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `SearchIcon(): JSX.Element` — signature unchanged, still what
  `AppShell.tsx:1370` uses in the command palette search row.

- [ ] **Step 1: Replace the path data**

Current:
```tsx
export function SearchIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
```

Replace with:
```tsx
export function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 4c3 0.5 4.9 2.9 4.5 6.1c-0.3 2.8-2.6 4.5-5.3 4.5c-2.9 0-5.2-2.1-5.2-5.1c0-3.2 2.7-5.7 6-5.5z"/>
            <path d="M9 15.5 C7.3 17.3 5.4 19.1 4 20.3"/>
        </svg>
    );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0.

- [ ] **Step 3: Manual visual check**

In the dev server, press Ctrl+K to open the command palette. The search icon
to the left of the input should read as an asymmetric, slightly leaf-shaped
loop instead of a perfect circle, with a short curved handle.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/appshell/icons.tsx
git commit -m "feat: redraw SearchIcon with an asymmetric leaf-shaped loop"
```

---

### Task 6: Redraw Close / Remove

**Files:**
- Modify: `grove_client/src/components/appshell/icons.tsx` (`RemoveIcon`,
  `CloseIcon`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `RemoveIcon(): JSX.Element`, `CloseIcon(): JSX.Element` —
  signatures unchanged. Still used by `FriendsPage.tsx:98` (Remove) and
  `ProfileDrawer.tsx:34` (Close).

- [ ] **Step 1: Replace both path sets with the curved-X**

Current:
```tsx
export function RemoveIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}

export function CloseIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
```

Replace with:
```tsx
export function RemoveIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6 Q14 10.5 18 18"/>
            <path d="M6 18 Q10.5 13.5 18 6"/>
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6 Q14 10.5 18 18"/>
            <path d="M6 18 Q10.5 13.5 18 6"/>
        </svg>
    );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0.

- [ ] **Step 3: Manual visual check**

In the dev server, open a profile drawer (click your own avatar in the
topbar) and confirm the close (×) button is two gently bowed strokes, not a
perfectly straight X. Then open the Friends page and confirm the "Remove"
button next to a friend shows the same bowed X.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/appshell/icons.tsx
git commit -m "feat: redraw Close/Remove as a gently bowed X instead of straight lines"
```

---

### Task 7: Redraw Friends as a filled tree-with-roots silhouette

**Files:**
- Modify: `grove_client/src/components/appshell/icons.tsx` (`FriendsIcon`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `FriendsIcon(): JSX.Element` — signature unchanged, still used by
  `AppShell.tsx:1245` (topbar). Also consumed by Task 8 (`CommandIsland`'s
  Users action reuses this component directly, no wrapper needed since it's
  already zero-prop).

- [ ] **Step 1: Replace the path data and switch to filled**

Current:
```tsx
export function FriendsIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
```

Replace with:
```tsx
export function FriendsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
            <path d="M12 2.2 C13.6 2.1 15 2.9 15.6 4.3 C17.1 4.6 18.2 5.9 18.1 7.5 C19.3 8.4 19.6 10 18.8 11.3 C18.9 12.8 17.6 13.9 16.1 13.8 C15.3 14.9 13.7 15.3 12.3 14.8 C10.9 15.4 9.2 15 8.3 13.9 C6.8 14 5.5 12.9 5.5 11.4 C4.6 10.2 4.8 8.5 6 7.5 C5.8 5.9 6.9 4.5 8.4 4.3 C8.9 2.9 10.3 2.1 12 2.2 Z M11.3 13.8 C11 15.5 11.2 17.3 10.7 19 C11.5 19.6 12.5 19.6 13.3 19 C12.8 17.3 13 15.5 12.7 13.8 C12.2 13.5 11.8 13.5 11.3 13.8 Z M10.7 19 C9 19.8 7.2 20 5.3 21.2 C5.6 21.6 6 21.7 6.4 21.5 C8 20.4 9.5 20 10.9 19.6 Z M11 19.3 C9.8 20.3 8.8 21.4 7.6 23 C8 23.2 8.4 23.1 8.7 22.8 C9.7 21.4 10.5 20.4 11.4 19.6 Z M11.6 19.5 C11.4 20.8 11.3 22.2 11.1 23.6 C11.5 23.7 11.9 23.7 12.3 23.6 C12.2 22.2 12.2 20.8 12.1 19.5 Z M13 19.3 C14.2 20.3 15.2 21.4 16.4 23 C16 23.2 15.6 23.1 15.3 22.8 C14.3 21.4 13.5 20.4 12.6 19.6 Z M13.3 19 C15 19.8 16.8 20 18.7 21.2 C18.4 21.6 18 21.7 17.6 21.5 C16 20.4 14.5 20 13.1 19.6 Z"/>
        </svg>
    );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0.

- [ ] **Step 3: Manual visual check**

In the dev server, look at the topbar Friends button. Should render as a
solid filled silhouette — a rounded canopy, curved trunk, roots fanning at
the base — the one filled icon among otherwise-stroke icons. Confirm it's
legible (not a muddy blob) at the actual ~19px button size, not just when
zoomed in.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/appshell/icons.tsx
git commit -m "feat: redraw FriendsIcon as a filled tree-with-roots silhouette"
```

---

### Task 8: Rebuild the Dynamic Island's icons

**Files:**
- Modify: `grove_client/src/components/appshell/icons.tsx` (add
  `SettingsIcon`, `MessagesIcon`, `ActivityIcon`)
- Modify: `grove_client/src/components/panes/CommandIsland.tsx` (`IslandItem`
  type, `ISLAND_ITEMS`, render loop, local `HashIcon`/`MoreDotsIcon`)
- Modify: `grove_client/src/styles/darkwood.css` (add `.hashlabel`, `.dots`
  rules near `.command-island-item`, around line 2141)

**Interfaces:**
- Consumes: `BellGlyph` from Task 4, `FriendsIcon` from Task 7. Do this task
  after both.
- Produces: nothing consumed by later tasks (this is the last task in the
  plan).

- [ ] **Step 1: Add three new icon exports to `icons.tsx`**

Append to `grove_client/src/components/appshell/icons.tsx`:
```tsx
export function MessagesIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4 C4.9 4 4 4.9 4 6 L4 12 C4 13.1 4.9 14 6 14 L8 14 L8 17.5 C8 17.9 8.5 18.1 8.8 17.8 L12.5 14 L18 14 C19.1 14 20 13.1 20 12 L20 6 C20 4.9 19.1 4 18 4 Z"/>
        </svg>
    );
}

export function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="2.0"/>
            <circle cx="19" cy="12" r="1.2"/>
            <circle cx="15.5" cy="5.94" r="1.2"/>
            <circle cx="8.5" cy="5.94" r="1.2"/>
            <circle cx="5" cy="12" r="1.2"/>
            <circle cx="8.5" cy="18.06" r="1.2"/>
            <circle cx="15.5" cy="18.06" r="1.2"/>
            <path d="M13.9 12.3 L17.2 12.1"/>
            <path d="M13.1 10.3 L14.7 7.1"/>
            <path d="M10.9 10.3 L9.3 7.1"/>
            <path d="M9.9 12 L6.6 12"/>
            <path d="M10.9 13.7 L9.3 16.9"/>
            <path d="M13.1 13.7 L14.7 16.9"/>
        </svg>
    );
}

export function ActivityIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 12 C12 9.3 11.7 7 12.3 4.6"/>
            <circle cx="12.3" cy="4.2" r="0.9"/>
            <path d="M12 12 C14 10.6 16 9.6 18 8.1"/>
            <circle cx="18.3" cy="7.8" r="0.9"/>
            <path d="M12 12 C14 13.4 16.4 14.5 18.8 15.6"/>
            <circle cx="19.1" cy="15.9" r="0.9"/>
            <path d="M12 12 C10 13.4 8 15 6.5 17.4"/>
            <circle cx="6.2" cy="17.7" r="0.9"/>
            <path d="M12 12 C9.6 10.1 7.1 9.1 4.9 8.6"/>
            <circle cx="4.5" cy="8.5" r="0.9"/>
        </svg>
    );
}
```

- [ ] **Step 2: Verify `icons.tsx` builds on its own**

Run: `cd grove_client && npm run build`
Expected: exits 0 (nothing imports these three yet, but they must type-check
standalone).

- [ ] **Step 3: Add the two small in-file glyphs and update the type in `CommandIsland.tsx`**

Current (`CommandIsland.tsx:1-24`):
```tsx
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export type IslandAction = "settings" | "channels" | "messages" | "users" | "notifications" | "activity" | "more";

interface IslandItem {
    action: IslandAction;
    label:  string;
    icon:   string;
    /** "activity" and "more" are reserved for future icons per the design
        spec ("extensible, not fixed forever") — real, inert buttons rather
        than a stubbed promise. */
    inert?: boolean;
}

const ISLAND_ITEMS: IslandItem[] = [
    { action: "settings",      label: "Settings",      icon: "⚙" },
    { action: "channels",      label: "Channels",      icon: "#" },
    { action: "messages",      label: "Messages",      icon: "💬" },
    { action: "users",         label: "Users",         icon: "👤" },
    { action: "notifications", label: "Notifications", icon: "🔔" },
    { action: "activity",      label: "Activity",      icon: "⚡", inert: true },
    { action: "more",          label: "More",          icon: "…",  inert: true },
];
```

Replace with:
```tsx
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BellGlyph, FriendsIcon, MessagesIcon, SettingsIcon, ActivityIcon } from "../appshell/icons";

export type IslandAction = "settings" | "channels" | "messages" | "users" | "notifications" | "activity" | "more";

function HashIcon() {
    return <span aria-hidden="true" className="hashlabel">#</span>;
}

function MoreDotsIcon() {
    return (
        <span aria-hidden="true" className="dots">
            <span /><span /><span />
        </span>
    );
}

interface IslandItem {
    action: IslandAction;
    label:  string;
    icon:   React.ComponentType;
    /** "activity" and "more" are reserved for future icons per the design
        spec ("extensible, not fixed forever") — real, inert buttons rather
        than a stubbed promise. */
    inert?: boolean;
}

const ISLAND_ITEMS: IslandItem[] = [
    { action: "settings",      label: "Settings",      icon: SettingsIcon },
    { action: "channels",      label: "Channels",      icon: HashIcon },
    { action: "messages",      label: "Messages",      icon: MessagesIcon },
    { action: "users",         label: "Users",         icon: FriendsIcon },
    { action: "notifications", label: "Notifications", icon: BellGlyph },
    { action: "activity",      label: "Activity",      icon: ActivityIcon, inert: true },
    { action: "more",          label: "More",          icon: MoreDotsIcon, inert: true },
];
```

- [ ] **Step 4: Update the render loop to render the component instead of a string**

Current (`CommandIsland.tsx:78-91`, inside the `.map`):
```tsx
                {ISLAND_ITEMS.map((item, i) => (
                    <button
                        key={item.action}
                        role="menuitem"
                        className={`command-island-item${i === focusIdx ? " focused" : ""}${item.inert ? " inert" : ""}`}
                        onMouseEnter={() => setFocusIdx(i)}
                        onClick={() => !item.inert && onSelect(item.action)}
                        aria-label={item.label}
                        title={item.inert ? `${item.label} (coming soon)` : item.label}
                        disabled={item.inert}
                    >
                        <span aria-hidden="true">{item.icon}</span>
                    </button>
                ))}
```

Replace with:
```tsx
                {ISLAND_ITEMS.map((item, i) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.action}
                            role="menuitem"
                            className={`command-island-item${i === focusIdx ? " focused" : ""}${item.inert ? " inert" : ""}`}
                            onMouseEnter={() => setFocusIdx(i)}
                            onClick={() => !item.inert && onSelect(item.action)}
                            aria-label={item.label}
                            title={item.inert ? `${item.label} (coming soon)` : item.label}
                            disabled={item.inert}
                        >
                            <Icon />
                        </button>
                    );
                })}
```

- [ ] **Step 5: Add sizing/layout CSS for the two non-SVG glyphs**

Add to `grove_client/src/styles/darkwood.css`, immediately after the
`.command-island-item.inert` rule (around line 2162):
```css
.command-island-item .hashlabel {
  font-family: var(--font-mono);
  font-size: 15px;
}

.command-island-item .dots {
  display: flex;
  gap: 2.5px;
}

.command-island-item .dots span {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  display: block;
}

.command-island-item svg {
  width: 17px;
  height: 17px;
}
```

- [ ] **Step 6: Verify the build**

Run: `cd grove_client && npm run build`
Expected: exits 0. This is the step that actually proves out the
`React.ComponentType` typing — if any `ISLAND_ITEMS` entry doesn't match, `tsc`
fails here.

- [ ] **Step 7: Manual visual check**

In the dev server, open the Dynamic Island (its trigger — check
`AppShell.tsx`'s `onLogoClick`/island-open wiring if not obvious from the UI).
Confirm all seven buttons render icons, not emoji: Settings shows the
seed-head, Channels shows a plain "#", Messages shows the new bubble, Users
shows the filled tree, Notifications shows the bell (no unread badge — that's
expected, the badge is topbar-only), Activity shows the spark (dimmed/inert),
More shows three dots (dimmed/inert). Arrow-key through them and confirm the
focused item still gets the green highlight circle.

- [ ] **Step 8: Commit**

```bash
git add grove_client/src/components/appshell/icons.tsx grove_client/src/components/panes/CommandIsland.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: replace Dynamic Island emoji with mark-derived icons"
```

---

## Self-Review

**Spec coverage:**
- Mono typeface swap → Task 1. ✓
- Depth tokens (surface-2/3, glow-focus) → Task 2. ✓
- Mono consistency (pane-pill numbers, timestamps) → Task 3. ✓
- Bell redesign → Task 4. ✓
- Search redesign → Task 5. ✓
- Close/Remove redesign → Task 6. ✓
- Friends filled-tree redesign → Task 7. ✓
- Dynamic Island icon mapping (Settings/Messages/Activity new, Notifications/
  Users reused, Channels/More unchanged) → Task 8. ✓
- Wordmark unchanged → no task touches `EmptyContent.tsx` or `.gv-empty-brand`. ✓
- Structural color hierarchy / section-spacing token → correctly absent, per
  spec's explicit rejection. ✓
- `MsgIcon` / `PhoneIcon` → correctly absent, per spec's explicit deferral of
  both (they render side by side in `FriendsPage.tsx`; redesigning only one
  wouldn't fix the row's mixed vocabulary) — "not blocking this pass." ✓

**Placeholder scan:** no TBD/TODO, no "add appropriate X", every step has
literal code or an exact runnable command. Clean.

**Type consistency:** `IslandItem.icon: React.ComponentType` (Task 8) is
satisfied by every referenced component — `SettingsIcon`, `HashIcon`,
`MessagesIcon`, `FriendsIcon` (Task 7), `BellGlyph` (Task 4), `ActivityIcon`,
`MoreDotsIcon` all have the shape `() => JSX.Element` / take no props, which
matches `React.ComponentType` with no generic. `BellIcon`'s existing
`{ count: number }` signature is untouched and `AppShell.tsx`'s call site
doesn't change. No naming drift between tasks (`BellGlyph` is named
identically in Task 4's export and Task 8's import).
