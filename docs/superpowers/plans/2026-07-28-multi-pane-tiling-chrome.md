# Multi-Pane Tiling & Unified Chrome (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Grove a persistent, three-state "chrome" object (full floating bar / left pill / tiny circle) plus a Dynamic-Island-style command surface, and let users tile up to 4 panes (channels/DMs/notifications/a new "Details" satellite pane) Hyprland-dwindle-style — with zero calling/screen-share work (that is Plan B, scoped separately later).

**Architecture:** A new pure-logic module (`paneLayout.ts`) owns the dwindle-tree data structure and every tree operation (split/remove/rebalance) plus the chrome-state derivation — this is the one part of the frontend complex and error-prone enough to warrant real unit tests (vitest, added as a dev dependency scoped to this module only; every other task still verifies via `tsc -b` + `eslint` + `npm run build` + manual browser check, per Grove's existing convention). `AppShell.tsx` keeps its existing single-active-channel/`openTabs` model completely intact for the 0/1-pane case (`paneRoot === null`, "State 1") — the new pane-tree state (`paneRoot`) only comes into existence the moment a second pane is created, and is torn back down the moment the tree collapses to one leaf. Chrome state is derived from the count of **non-Details** leaves, not raw `paneRoot` nullness — this is a direct, deliberate reading of the spec's "opening/closing [Details] never triggers a chrome-state transition on its own": a Details pane can be tiled alongside a single conversation without moving the chrome out of State 1. `ChatView`/`MessageList`/`socket.ts` are already fully props-driven and safe to instantiate N times simultaneously (confirmed by reading `ChatView.tsx` in full — every field is either a prop or transient local UI state keyed by `channelId`); the one exception is a single new optional `onOpenDetails?: () => void` prop added to `ChatView.tsx` in Task 13, needed because the spec explicitly puts the new "ⓘ Details" icon in the chat header itself ("the single visible pane keeps its own header (name + existing gear icon + a new 'ⓘ Details' icon)") — this is additive and optional, so it doesn't affect multi-instance safety. Animations (chrome morph, island expand/collapse) are plain CSS transitions/keyframes on `transform`/`opacity`/`clip-path`, not a new animation library — Grove already has this precedent: `useDecryptReveal.ts` explicitly ports a reactbits idea "stripped of its framer-motion dependency... a plain setInterval character-swap, framer-motion was never load-bearing there." Grove has zero motion-library dependency today (checked `package.json`); introducing one just for this feature would work against the user's explicit "respond way faster than Slack/Discord" performance goal, so this plan continues the existing plain-CSS convention instead.

**Tech Stack:** React 19.2.6 + TypeScript 6.0 (`grove_client`), Vite 8, existing Darkwood CSS design system (`darkwood.css`). New dev dependency: `vitest` (scoped to `paneLayout.ts` only).

## Global Constraints

- No backend changes anywhere in this plan — this is a pure `grove_client` feature. (Spec: "no backend changes" for Plan A per the user's split-into-two-plans decision.)
- Max simultaneous panes: **4** (spec, "Pane Kinds" section). Never exceeded, never silently dropped — split operations that would exceed it are a no-op.
- Pane kind sizing weights (spec, "Pane Kinds" table): Channel `1.0`, DM `1.0`, Notification `0.6`, Details `0.6`.
- State cycling is exactly as specified: dropping to 1 pane **always** auto-reverts to State 1; State 2 ↔ State 3 is **only** ever manual (spec, "Split Mechanics — State cycling").
- Keybind defaults (spec, "Keybind Summary" table) — implement exactly these unless a step below says otherwise:
  - Create split: `Ctrl+Shift+Enter`
  - Directional split: `Ctrl+Shift+<Arrow>` (targets the hovered pane)
  - Collapse chrome (State 2→3): `Ctrl+Shift+[` (also: click the pill)
  - Expand chrome (State 3→2): `Ctrl+Shift+]` (also: click the circle)
  - Open command island: `Ctrl+Shift+Space`
  - Close focused/hovered pane: `Ctrl+W`
  - Switch pane / switch tab (mode-dependent): `Ctrl+1`–`8`
- Every new keybind has a non-keybind (click) fallback where the spec calls for one — never keybind-only for state-cycling actions.
- No calls, no screen-share, no WebRTC changes anywhere in this plan (deferred to Plan B).
- Frontend verification convention (all tasks except the vitest-covered ones): `tsc -b` + `eslint .` + `npm run build`, then a manual browser check.
- `cargo fmt`/`cargo clippy` are not relevant here — this plan touches no Rust code.

---

## File Structure

**New files:**
- `grove_client/vitest.config.ts` — minimal vitest config, `environment: "node"`, scoped to `src/**/*.test.ts`.
- `grove_client/src/paneLayout.ts` — pure logic: pane-tree types, tree operations (`splitAuto`, `splitDirectional`, `removePane`, `rebalance`), chrome-state helpers. No React, no DOM — this is what vitest covers.
- `grove_client/src/paneLayout.test.ts` — vitest suite for the above.
- `grove_client/src/hooks/usePaneKeybinds.ts` — the new pane-related `keydown` listener, using the same "latest-value ref, `[]`-dep effect" convention already established in `AppShell.tsx:184-203` for `paletteModeRef`.
- `grove_client/src/components/panes/PaneChrome.tsx` — the one persistent chrome element (State 1 floating box / State 2 pill / State 3 circle).
- `grove_client/src/components/panes/CommandIsland.tsx` — the Dynamic-Island-style command surface.
- `grove_client/src/components/panes/DetailsPane.tsx` — the satellite Details pane (Shared Links real implementation; Files/Photos honest empty states).
- `grove_client/src/components/panes/PaneGrid.tsx` — the recursive dwindle-tree renderer (chrome-free in State 2, headers in State 3). Purely presentational — receives a `renderContent(pane)` prop from `AppShell` rather than importing `ChatView` itself, matching the existing container/presentational split.

**Modified files:**
- `grove_client/package.json` — add `vitest` devDependency + `"test": "vitest run"` script.
- `grove_client/tsconfig.node.json` — add `vitest.config.ts` to `include` (editor/type-check consistency only; `tsc -b`'s production build graph is unaffected either way since `tsconfig.app.json` never includes it).
- `grove_client/src/components/AppShell.tsx` — new pane state (`paneRoot`, `focusedPaneId`, `hoveredPaneId`, `lastMultiPaneState`, `islandOpen`, `settingsChannelId`), a `renderPaneContent` dispatcher, an `openOrFill` router replacing direct `openChannel` calls at every "navigate to a conversation" call site, a shared `openDetailsForPane` helper, the background-message-check fix, and the render-tree swap (`PaneChrome` + `PaneGrid`/single-`ChatView` + `CommandIsland` replacing today's `<header>`'s logo/location + `<TabBar/>` + the `<main>` ternary).
- `grove_client/src/components/ChatView.tsx` — one small additive change: a new optional `onOpenDetails?: () => void` prop, rendered as a second icon button next to the existing settings gear (spec: State 1's single pane header gets "the existing gear icon + a new 'ⓘ Details' icon"). Every existing prop, and every other consumer's behavior, is unaffected.
- `grove_client/src/styles/darkwood.css` — four new sections (`PANE CHROME`, `PANE GRID`, `COMMAND ISLAND`, `DETAILS PANE`), inserted after the existing `TAB BAR` section (currently ending at line 2466), following the established 3-line `/* === NAME === */` header convention.

---

### Task 1: Vitest scaffolding

**Files:**
- Create: `grove_client/vitest.config.ts`
- Modify: `grove_client/package.json`
- Modify: `grove_client/tsconfig.node.json`
- Create: `grove_client/src/paneLayout.ts` (stub only, real logic in Task 2+)
- Create: `grove_client/src/paneLayout.test.ts` (smoke test only, real coverage in Task 2+)

**Interfaces:**
- Produces: `npm run test` runs vitest once (CI-friendly, non-watch).

- [ ] **Step 1: Add the vitest dev dependency**

Run:
```bash
cd grove_client && npm install --save-dev vitest@^4.1.10
```

- [ ] **Step 2: Add the `test` script**

In `grove_client/package.json`, in the `"scripts"` block:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Create the vitest config**

Create `grove_client/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
```

- [ ] **Step 4: Register the config file with tsconfig.node.json**

In `grove_client/tsconfig.node.json`, change:

```json
  "include": ["vite.config.ts"]
```

to:

```json
  "include": ["vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 5: Create a stub pane-layout module and smoke test**

Create `grove_client/src/paneLayout.ts`:

```ts
export const PANE_LAYOUT_MODULE_LOADED = true;
```

Create `grove_client/src/paneLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PANE_LAYOUT_MODULE_LOADED } from "./paneLayout";

describe("paneLayout module", () => {
    it("loads", () => {
        expect(PANE_LAYOUT_MODULE_LOADED).toBe(true);
    });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `cd grove_client && npm run test`
Expected: 1 passed test, `PANE_LAYOUT_MODULE_LOADED`.

- [ ] **Step 7: Commit**

```bash
git add grove_client/package.json grove_client/package-lock.json grove_client/tsconfig.node.json grove_client/vitest.config.ts grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "chore: scaffold vitest, scoped to pane-layout logic"
```

---

### Task 2: Pane-tree types and traversal helpers

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Produces: `PaneKind`, `PaneContent`, `SplitAxis`, `LeafNode`, `SplitNode`, `PaneTreeNode`, `makeLeaf(pane: PaneContent): LeafNode`, `countLeaves(node: PaneTreeNode | null): number`, `getLeaves(node: PaneTreeNode | null): LeafNode[]`, `findLeafById(node: PaneTreeNode | null, paneId: string): LeafNode | null`. These are the exact names every later task (and `AppShell.tsx`) will import — do not rename downstream.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `grove_client/src/paneLayout.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
    makeLeaf, countLeaves, getLeaves, findLeafById,
    type PaneContent, type PaneTreeNode, type SplitNode,
} from "./paneLayout";

function pane(paneId: string, channelId: number | null = 1): PaneContent {
    return { paneId, kind: "channel", channelId, channelName: `chan-${channelId}` };
}

function split(a: PaneTreeNode, b: PaneTreeNode): SplitNode {
    return { type: "split", axis: "row", ratio: 0.5, a, b };
}

describe("countLeaves", () => {
    it("returns 0 for a null tree", () => {
        expect(countLeaves(null)).toBe(0);
    });

    it("returns 1 for a single leaf", () => {
        expect(countLeaves(makeLeaf(pane("p1")))).toBe(1);
    });

    it("counts leaves across nested splits", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(countLeaves(tree)).toBe(3);
    });
});

describe("getLeaves", () => {
    it("returns leaves in left-to-right, depth-first order", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(getLeaves(tree).map(l => l.pane.paneId)).toEqual(["p1", "p2", "p3"]);
    });

    it("returns an empty array for a null tree", () => {
        expect(getLeaves(null)).toEqual([]);
    });
});

describe("findLeafById", () => {
    it("finds a leaf anywhere in the tree", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(findLeafById(tree, "p3")?.pane.paneId).toBe("p3");
    });

    it("returns null when the id is not present", () => {
        const tree = makeLeaf(pane("p1"));
        expect(findLeafById(tree, "nope")).toBeNull();
    });

    it("returns null for a null tree", () => {
        expect(findLeafById(null, "p1")).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `paneLayout.ts` does not export `makeLeaf`/`countLeaves`/`getLeaves`/`findLeafById` yet.

- [ ] **Step 3: Implement the types and traversal helpers**

Replace the contents of `grove_client/src/paneLayout.ts` with:

```ts
/**
 * Pure pane-tiling logic (dwindle tree + chrome-state derivation). No React,
 * no DOM — kept this way so it can be unit tested directly (see
 * paneLayout.test.ts). AppShell.tsx is the only consumer.
 */

export type PaneKind = "channel" | "dm" | "notification" | "details";

/**
 * `channelId` is null for a pane created via split that hasn't been filled
 * yet (Ctrl+K assigns it). For "notification" panes it's always null — that
 * pane isn't scoped to one channel, it lists unreads across all channels.
 */
export interface PaneContent {
    paneId:      string;
    kind:        PaneKind;
    channelId:   number | null;
    channelName: string;
}

export type SplitAxis = "row" | "column";
export type SplitDirection = "left" | "right" | "up" | "down";

export interface LeafNode {
    type: "leaf";
    pane: PaneContent;
}

export interface SplitNode {
    type:  "split";
    axis:  SplitAxis;
    ratio: number;
    a:     PaneTreeNode;
    b:     PaneTreeNode;
}

export type PaneTreeNode = LeafNode | SplitNode;

export const MAX_PANES = 4;

export function makeLeaf(pane: PaneContent): LeafNode {
    return { type: "leaf", pane };
}

export function makeEmptyPaneContent(paneId: string): PaneContent {
    return { paneId, kind: "channel", channelId: null, channelName: "" };
}

export function countLeaves(node: PaneTreeNode | null): number {
    if (node === null) return 0;
    if (node.type === "leaf") return 1;
    return countLeaves(node.a) + countLeaves(node.b);
}

export function getLeaves(node: PaneTreeNode | null): LeafNode[] {
    if (node === null) return [];
    if (node.type === "leaf") return [node];
    return [...getLeaves(node.a), ...getLeaves(node.b)];
}

export function findLeafById(node: PaneTreeNode | null, paneId: string): LeafNode | null {
    if (node === null) return null;
    if (node.type === "leaf") return node.pane.paneId === paneId ? node : null;
    return findLeafById(node.a, paneId) ?? findLeafById(node.b, paneId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — all `countLeaves`/`getLeaves`/`findLeafById` tests green.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: pane-tree types and traversal helpers"
```

---

### Task 3: Kind weights and rebalance

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Consumes: `PaneTreeNode`, `LeafNode`, `SplitNode` from Task 2.
- Produces: `PANE_KIND_WEIGHT: Record<PaneKind, number>`, `rebalance(node: PaneTreeNode): PaneTreeNode`. `rebalance` is called by every tree-mutating operation in Tasks 4–6 — it must return a **new** tree (immutability, per project convention), not mutate its input.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/paneLayout.test.ts`:

```ts
import { rebalance, type SplitNode as _SplitNode } from "./paneLayout";

describe("rebalance", () => {
    it("leaves a single leaf untouched", () => {
        const leaf = makeLeaf(pane("p1"));
        expect(rebalance(leaf)).toEqual(leaf);
    });

    it("gives equal-weight kinds a 0.5 ratio", () => {
        const tree = split(makeLeaf(pane("p1")), makeLeaf(pane("p2"))) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        expect(result.ratio).toBeCloseTo(0.5);
    });

    it("weights a channel pane heavier than a notification pane", () => {
        const notifPane: PaneContent = { paneId: "p2", kind: "notification", channelId: null, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), makeLeaf(notifPane)) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        // channel weight 1.0, notification weight 0.6 -> 1.0 / (1.0 + 0.6) = 0.625
        expect(result.ratio).toBeCloseTo(0.625, 3);
    });

    it("weights a details pane the same as a notification pane", () => {
        const detailsPane: PaneContent = { paneId: "p2", kind: "details", channelId: 1, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), makeLeaf(detailsPane)) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        expect(result.ratio).toBeCloseTo(0.625, 3);
    });

    it("recurses into nested splits", () => {
        const notifPane: PaneContent = { paneId: "p3", kind: "notification", channelId: null, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(notifPane)));
        const result = rebalance(tree) as SplitNode;
        const inner = result.b as SplitNode;
        expect(inner.ratio).toBeCloseTo(0.625, 3);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `rebalance` is not exported yet.

- [ ] **Step 3: Implement kind weights and rebalance**

Add to `grove_client/src/paneLayout.ts` (after the `MAX_PANES` constant):

```ts
export const PANE_KIND_WEIGHT: Record<PaneKind, number> = {
    channel:      1.0,
    dm:           1.0,
    notification: 0.6,
    details:      0.6,
};

function weightOf(node: PaneTreeNode): number {
    if (node.type === "leaf") return PANE_KIND_WEIGHT[node.pane.kind];
    return (weightOf(node.a) + weightOf(node.b)) / 2;
}

export function rebalance(node: PaneTreeNode): PaneTreeNode {
    if (node.type === "leaf") return node;
    const a  = rebalance(node.a);
    const b  = rebalance(node.b);
    const wa = weightOf(a);
    const wb = weightOf(b);
    return { ...node, a, b, ratio: wa / (wa + wb) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — all `rebalance` tests green.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: kind-weighted pane rebalancing"
```

---

### Task 4: splitAuto (dwindle)

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Consumes: `PaneTreeNode`, `countLeaves`, `findLeafById`, `rebalance`, `MAX_PANES` from Tasks 2–3.
- Produces: `splitAuto(root: PaneTreeNode, targetPaneId: string, newPane: PaneContent): PaneTreeNode`. Returns the **same** `root` reference, unchanged, if `targetPaneId` isn't found or the tree is already at `MAX_PANES` — callers can check `result === root` to detect a no-op, but should prefer calling `countLeaves(root) < MAX_PANES` themselves before calling.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/paneLayout.test.ts`:

```ts
import { splitAuto } from "./paneLayout";

describe("splitAuto", () => {
    it("splits a single leaf into a 2-leaf tree", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitAuto(root, "p1", pane("p2", 2)) as SplitNode;
        expect(result.type).toBe("split");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("alternates split axis with each additional split", () => {
        const root = makeLeaf(pane("p1"));
        const afterFirst = splitAuto(root, "p1", pane("p2", 2)) as SplitNode;
        expect(afterFirst.axis).toBe("row");

        const afterSecond = splitAuto(afterFirst, "p2", pane("p3", 3));
        const secondSplit = findSplitContaining(afterSecond, "p2");
        expect(secondSplit?.axis).toBe("column");
    });

    it("is a no-op once at MAX_PANES", () => {
        let root: PaneTreeNode = makeLeaf(pane("p1"));
        root = splitAuto(root, "p1", pane("p2", 2));
        root = splitAuto(root, "p2", pane("p3", 3));
        root = splitAuto(root, "p3", pane("p4", 4));
        expect(countLeaves(root)).toBe(4);
        const attempt = splitAuto(root, "p4", pane("p5", 5));
        expect(attempt).toBe(root);
        expect(countLeaves(attempt)).toBe(4);
    });

    it("is a no-op when the target id does not exist", () => {
        const root = makeLeaf(pane("p1"));
        const attempt = splitAuto(root, "missing", pane("p2", 2));
        expect(attempt).toBe(root);
    });
});

function findSplitContaining(node: PaneTreeNode, paneId: string): SplitNode | null {
    if (node.type === "leaf") return null;
    if (findLeafById(node, paneId) === null) return null;
    if (findLeafById(node.a, paneId) !== null && node.a.type === "leaf") return node;
    if (findLeafById(node.b, paneId) !== null && node.b.type === "leaf") return node;
    return findSplitContaining(node.a, paneId) ?? findSplitContaining(node.b, paneId);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `splitAuto` is not exported yet.

- [ ] **Step 3: Implement splitAuto**

Add to `grove_client/src/paneLayout.ts` (at the end of the file):

```ts
function nextAxis(depth: number): SplitAxis {
    return depth % 2 === 0 ? "row" : "column";
}

function replaceLeaf(
    node: PaneTreeNode,
    targetId: string,
    depth: number,
    build: (leaf: LeafNode, depth: number) => PaneTreeNode,
): PaneTreeNode {
    if (node.type === "leaf") {
        return node.pane.paneId === targetId ? build(node, depth) : node;
    }
    return {
        ...node,
        a: replaceLeaf(node.a, targetId, depth + 1, build),
        b: replaceLeaf(node.b, targetId, depth + 1, build),
    };
}

export function splitAuto(root: PaneTreeNode, targetPaneId: string, newPane: PaneContent): PaneTreeNode {
    if (countLeaves(root) >= MAX_PANES) return root;
    if (findLeafById(root, targetPaneId) === null) return root;
    const next = replaceLeaf(root, targetPaneId, 0, (leaf, depth) => ({
        type: "split",
        axis: nextAxis(depth),
        ratio: 0.5,
        a: leaf,
        b: makeLeaf(newPane),
    }));
    return rebalance(next);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — all `splitAuto` tests green.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: dwindle auto-split"
```

---

### Task 5: splitDirectional

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Consumes: `PaneTreeNode`, `SplitDirection`, `countLeaves`, `findLeafById`, `rebalance`, `MAX_PANES`, `replaceLeaf` (internal) from Tasks 2–4.
- Produces: `splitDirectional(root: PaneTreeNode, targetPaneId: string, newPane: PaneContent, direction: SplitDirection): PaneTreeNode`. Same no-op contract as `splitAuto`.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/paneLayout.test.ts`:

```ts
import { splitDirectional } from "./paneLayout";

describe("splitDirectional", () => {
    it("places the new pane to the left (row axis, new pane first)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "left") as SplitNode;
        expect(result.axis).toBe("row");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p2", "p1"]);
    });

    it("places the new pane to the right (row axis, new pane second)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "right") as SplitNode;
        expect(result.axis).toBe("row");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("places the new pane above (column axis, new pane first)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "up") as SplitNode;
        expect(result.axis).toBe("column");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p2", "p1"]);
    });

    it("places the new pane below (column axis, new pane second)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "down") as SplitNode;
        expect(result.axis).toBe("column");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("is a no-op once at MAX_PANES", () => {
        let root: PaneTreeNode = makeLeaf(pane("p1"));
        root = splitAuto(root, "p1", pane("p2", 2));
        root = splitAuto(root, "p2", pane("p3", 3));
        root = splitAuto(root, "p3", pane("p4", 4));
        const attempt = splitDirectional(root, "p4", pane("p5", 5), "right");
        expect(attempt).toBe(root);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `splitDirectional` is not exported yet.

- [ ] **Step 3: Implement splitDirectional**

Add to `grove_client/src/paneLayout.ts` (at the end of the file):

```ts
export function splitDirectional(
    root: PaneTreeNode,
    targetPaneId: string,
    newPane: PaneContent,
    direction: SplitDirection,
): PaneTreeNode {
    if (countLeaves(root) >= MAX_PANES) return root;
    if (findLeafById(root, targetPaneId) === null) return root;

    const axis: SplitAxis = (direction === "left" || direction === "right") ? "row" : "column";
    const newPaneFirst = direction === "left" || direction === "up";

    const next = replaceLeaf(root, targetPaneId, 0, leaf => ({
        type: "split",
        axis,
        ratio: 0.5,
        a: newPaneFirst ? makeLeaf(newPane) : leaf,
        b: newPaneFirst ? leaf : makeLeaf(newPane),
    }));
    return rebalance(next);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — all `splitDirectional` tests green.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: directional pane splitting"
```

---

### Task 6: removePane

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Consumes: `PaneTreeNode`, `rebalance` from Tasks 2–3.
- Produces: `removePane(root: PaneTreeNode, paneId: string): PaneTreeNode | null`. Returns `null` if `root` itself was the single matching leaf (caller's responsibility to then fall back to State 1 — see Task 13/14). Returns `root` unchanged if `paneId` isn't found.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/paneLayout.test.ts`:

```ts
import { removePane } from "./paneLayout";

describe("removePane", () => {
    it("returns null when removing the only leaf", () => {
        const root = makeLeaf(pane("p1"));
        expect(removePane(root, "p1")).toBeNull();
    });

    it("collapses a 2-leaf split down to the surviving leaf", () => {
        const root = split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2)));
        const result = removePane(root, "p1");
        expect(result?.type).toBe("leaf");
        expect((result as { type: "leaf"; pane: PaneContent } | null)?.pane.paneId).toBe("p2");
    });

    it("collapses a nested split, keeping the rest of the tree", () => {
        const root = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2", 2)), makeLeaf(pane("p3", 3))));
        const result = removePane(root, "p2");
        expect(countLeaves(result)).toBe(2);
        expect(getLeaves(result!).map(l => l.pane.paneId)).toEqual(["p1", "p3"]);
    });

    it("leaves the tree unchanged when the id is not found", () => {
        const root = split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2)));
        const result = removePane(root, "missing");
        expect(getLeaves(result!).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `removePane` is not exported yet.

- [ ] **Step 3: Implement removePane**

Add to `grove_client/src/paneLayout.ts` (at the end of the file):

```ts
export function removePane(root: PaneTreeNode, paneId: string): PaneTreeNode | null {
    if (root.type === "leaf") {
        return root.pane.paneId === paneId ? null : root;
    }
    const a = removePane(root.a, paneId);
    const b = removePane(root.b, paneId);
    if (a === null) return b;
    if (b === null) return a;
    return rebalance({ type: "split", axis: root.axis, ratio: root.ratio, a, b });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — all `removePane` tests green.

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: pane removal with tree collapse"
```

---

### Task 7: Chrome-state helpers

**Files:**
- Modify: `grove_client/src/paneLayout.ts`
- Modify: `grove_client/src/paneLayout.test.ts`

**Interfaces:**
- Consumes: `PaneTreeNode`, `getLeaves` from Task 2.
- Produces: `ChromeState = "state1" | "state2" | "state3"`, `MultiPaneChromeState = "state2" | "state3"`, `countNonDetailsLeaves(node: PaneTreeNode | null): number`, `deriveChromeState(paneRoot: PaneTreeNode | null, lastMultiPaneState: MultiPaneChromeState): ChromeState`, `toggleMultiPaneState(state: MultiPaneChromeState): MultiPaneChromeState`. `AppShell.tsx` (Task 13) uses `deriveChromeState` every render instead of storing chrome state directly — this is what makes "dropping to 1 pane always reverts to State 1" automatic rather than a bug waiting to happen.

**Important:** chrome state is derived from the count of **non-Details** leaves, not raw `paneRoot` nullness. Per spec ("Pane Kinds" table, Details row): "opening/closing it never triggers a chrome-state transition on its own. Only the dedicated split action moves the chrome from State 1 to State 2." A Details pane can be tiled next to a single conversation (2 leaves total, 1 non-Details) without the chrome leaving State 1 — only an actual second *conversation* pane (2+ non-Details leaves) moves it to State 2/3.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/paneLayout.test.ts`:

```ts
import { countNonDetailsLeaves, deriveChromeState, toggleMultiPaneState } from "./paneLayout";

describe("countNonDetailsLeaves", () => {
    it("is 0 for a null tree", () => {
        expect(countNonDetailsLeaves(null)).toBe(0);
    });

    it("counts a single channel leaf", () => {
        expect(countNonDetailsLeaves(makeLeaf(pane("p1")))).toBe(1);
    });

    it("excludes details leaves from the count", () => {
        const detailsPane: PaneContent = { paneId: "p2", kind: "details", channelId: 1, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), makeLeaf(detailsPane));
        expect(countNonDetailsLeaves(tree)).toBe(1);
    });

    it("counts two ordinary panes even alongside a details pane", () => {
        const detailsPane: PaneContent = { paneId: "p3", kind: "details", channelId: 1, channelName: "" };
        const tree = split(split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2))), makeLeaf(detailsPane));
        expect(countNonDetailsLeaves(tree)).toBe(2);
    });
});

describe("deriveChromeState", () => {
    it("is state1 whenever paneRoot is null, regardless of lastMultiPaneState", () => {
        expect(deriveChromeState(null, "state2")).toBe("state1");
        expect(deriveChromeState(null, "state3")).toBe("state1");
    });

    it("mirrors lastMultiPaneState once 2+ non-details panes are tiled", () => {
        const root = split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2)));
        expect(deriveChromeState(root, "state2")).toBe("state2");
        expect(deriveChromeState(root, "state3")).toBe("state3");
    });

    it("stays state1 when only a details pane accompanies a single conversation", () => {
        const detailsPane: PaneContent = { paneId: "p2", kind: "details", channelId: 1, channelName: "" };
        const root = split(makeLeaf(pane("p1")), makeLeaf(detailsPane));
        expect(deriveChromeState(root, "state2")).toBe("state1");
        expect(deriveChromeState(root, "state3")).toBe("state1");
    });
});

describe("toggleMultiPaneState", () => {
    it("toggles state2 to state3", () => {
        expect(toggleMultiPaneState("state2")).toBe("state3");
    });

    it("toggles state3 to state2", () => {
        expect(toggleMultiPaneState("state3")).toBe("state2");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npm run test`
Expected: FAIL — `countNonDetailsLeaves`/`deriveChromeState`/`toggleMultiPaneState` are not exported yet.

- [ ] **Step 3: Implement the chrome-state helpers**

Add to `grove_client/src/paneLayout.ts` (at the end of the file):

```ts
export type ChromeState = "state1" | "state2" | "state3";
export type MultiPaneChromeState = "state2" | "state3";

export function countNonDetailsLeaves(node: PaneTreeNode | null): number {
    return getLeaves(node).filter(leaf => leaf.pane.kind !== "details").length;
}

export function deriveChromeState(
    paneRoot: PaneTreeNode | null,
    lastMultiPaneState: MultiPaneChromeState,
): ChromeState {
    return countNonDetailsLeaves(paneRoot) <= 1 ? "state1" : lastMultiPaneState;
}

export function toggleMultiPaneState(state: MultiPaneChromeState): MultiPaneChromeState {
    return state === "state2" ? "state3" : "state2";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npm run test`
Expected: PASS — full suite green (Tasks 2–7 combined).

- [ ] **Step 5: Commit**

```bash
git add grove_client/src/paneLayout.ts grove_client/src/paneLayout.test.ts
git commit -m "feat: chrome-state derivation helpers"
```

---

### Task 8: usePaneKeybinds hook

**Files:**
- Create: `grove_client/src/hooks/usePaneKeybinds.ts`

**Interfaces:**
- Consumes: nothing from `paneLayout.ts` directly (works purely in terms of IDs/booleans/callbacks — `AppShell.tsx` in Task 13 does the tree lookups).
- Produces: `usePaneKeybinds(actions: PaneKeybindActions): void`, where:

```ts
export interface PaneKeybindActions {
    isPaneModeActive:   () => boolean;
    getFocusedPaneId:   () => string | null;
    getHoveredPaneId:   () => string | null;
    onCreateSplit:      () => void;
    onDirectionalSplit: (direction: "left" | "right" | "up" | "down") => void;
    onCollapseChrome:   () => void;
    onExpandChrome:     () => void;
    onToggleIsland:     () => void;
    onClosePane:        (paneId: string) => void;
    onSwitchToPaneIndex: (index: number) => void;
}
```

This is a plain window-level `keydown` listener, following the exact "latest-value ref, `[]`-dep effect" pattern already used for `paletteModeRef` at `AppShell.tsx:184-203` — the hook takes the *actions object* fresh every render (closures over current state), stores it in a ref, and the actual listener (registered once) always reads through the ref so it never needs to re-subscribe.

- [ ] **Step 1: Implement the hook**

Create `grove_client/src/hooks/usePaneKeybinds.ts`:

```ts
import { useEffect, useRef } from "react";

export interface PaneKeybindActions {
    isPaneModeActive:    () => boolean;
    getFocusedPaneId:    () => string | null;
    getHoveredPaneId:    () => string | null;
    onCreateSplit:       () => void;
    onDirectionalSplit:  (direction: "left" | "right" | "up" | "down") => void;
    onCollapseChrome:    () => void;
    onExpandChrome:      () => void;
    onToggleIsland:      () => void;
    onClosePane:         (paneId: string) => void;
    onSwitchToPaneIndex: (index: number) => void;
}

const ARROW_DIRECTION: Record<string, "left" | "right" | "up" | "down"> = {
    ArrowLeft:  "left",
    ArrowRight: "right",
    ArrowUp:    "up",
    ArrowDown:  "down",
};

/**
 * Registers the pane-tiling keybinds (Ctrl+Shift+Enter, Ctrl+Shift+<Arrow>,
 * Ctrl+Shift+[ / ], Ctrl+Shift+Space, Ctrl+W, Ctrl+1-8) once, for the
 * lifetime of the component. `actions` is read through a ref so this never
 * needs to re-register the listener — same convention as the paletteModeRef
 * effect in AppShell.tsx.
 */
export function usePaneKeybinds(actions: PaneKeybindActions): void {
    const actionsRef = useRef(actions);
    actionsRef.current = actions;

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const a = actionsRef.current;

            if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
                e.preventDefault();
                a.onCreateSplit();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key in ARROW_DIRECTION) {
                e.preventDefault();
                a.onDirectionalSplit(ARROW_DIRECTION[e.key]);
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key === "[") {
                e.preventDefault();
                a.onCollapseChrome();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key === "]") {
                e.preventDefault();
                a.onExpandChrome();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.code === "Space") {
                e.preventDefault();
                a.onToggleIsland();
                return;
            }

            if (!a.isPaneModeActive()) return;

            if (e.ctrlKey && !e.shiftKey && e.key === "w") {
                const targetId = a.getHoveredPaneId() ?? a.getFocusedPaneId();
                if (targetId === null) return;
                e.preventDefault();
                a.onClosePane(targetId);
                return;
            }

            const n = parseInt(e.key, 10);
            if (e.ctrlKey && !e.shiftKey && !e.altKey && n >= 1 && n <= 8) {
                e.preventDefault();
                a.onSwitchToPaneIndex(n - 1);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []); // safe — reads only actionsRef; every action is looked up fresh on each keypress
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd grove_client && npx tsc -b`
Expected: no errors (this file has no consumer yet — it will be wired into `AppShell.tsx` in Task 13, but it must type-check standalone now).

- [ ] **Step 3: Commit**

```bash
git add grove_client/src/hooks/usePaneKeybinds.ts
git commit -m "feat: pane-tiling keybind hook"
```

---

### Task 9: PaneChrome component

**Files:**
- Create: `grove_client/src/components/panes/PaneChrome.tsx`
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Consumes: `LeafNode` from `paneLayout.ts` (Task 2).
- Produces:

```ts
export interface PaneChromeProps {
    mode:          "state1" | "state2" | "state3";
    tabs:          { id: number; name: string; kind: "channel" | "dm" }[];
    activeTabId:   number | null;
    onSelectTab:   (id: number, name: string, kind: "channel" | "dm") => void;
    onCloseTab:    (id: number) => void;
    paneLeaves:    LeafNode[];
    focusedPaneId: string | null;
    onFocusPane:   (paneId: string) => void;
    onPillHoverChange: (hovered: boolean) => void;
    totalUnread:   number;
    onLogoClick:   () => void;
    onToggleMultiPaneState: () => void;
}
export function PaneChrome(props: PaneChromeProps): React.ReactElement;
```

This replaces the existing `dw-topbar-logo` button + `dw-topbar-location` + `<TabBar/>` in `AppShell.tsx` (wired in Task 14). The right-side actions cluster (`dw-topbar-actions` — call indicator, connection dot, notifications, friends, avatar) is untouched by this plan; only the left/center "where am I, what's open" portion becomes this one floating/pill/circle chrome object, per spec ("State 1... is the reference point for the entire app's new aesthetic going forward").

`onPillHoverChange` matters because of exactly how the State 2 hover-reveal was approved during brainstorming (`state2-fix.html` in the visual companion session): hovering the pill fades **the panes themselves** and overlays each with its number + label in place — not a tooltip floating next to the pill. `PaneChrome` only reports the hover boolean; `PaneGrid` (Task 12) is what actually renders the per-pane dim + reveal, since the pill and the panes are siblings under `AppShell`.

- [ ] **Step 1: Implement the component**

Create `grove_client/src/components/panes/PaneChrome.tsx`:

```tsx
import type { LeafNode } from "../../paneLayout";

export interface PaneChromeProps {
    mode:          "state1" | "state2" | "state3";
    tabs:          { id: number; name: string; kind: "channel" | "dm" }[];
    activeTabId:   number | null;
    onSelectTab:   (id: number, name: string, kind: "channel" | "dm") => void;
    onCloseTab:    (id: number) => void;
    paneLeaves:    LeafNode[];
    focusedPaneId: string | null;
    onFocusPane:   (paneId: string) => void;
    totalUnread:   number;
    onLogoClick:   () => void;
    onToggleMultiPaneState: () => void;
}

export function PaneChrome({
    mode, tabs, activeTabId, onSelectTab, onCloseTab,
    paneLeaves, focusedPaneId, onFocusPane, onPillHoverChange,
    totalUnread, onLogoClick, onToggleMultiPaneState,
}: PaneChromeProps) {
    return (
        <div className={`pane-chrome pane-chrome-${mode}`} role="toolbar" aria-label="Grove navigation">
            <button className="pane-chrome-logo" onClick={onLogoClick} aria-label="Open command palette" title="Ctrl+K">
                <ChromeLeafIcon />
            </button>

            {mode === "state1" && (
                <div className="pane-chrome-tabs" role="tablist" aria-label="Open channels">
                    {tabs.length === 0 && (
                        <span className="pane-chrome-hint">Press <kbd>Ctrl K</kbd> to navigate</span>
                    )}
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            role="tab"
                            className={`pane-chrome-tab${tab.id === activeTabId ? " active" : ""}`}
                            aria-selected={tab.id === activeTabId}
                        >
                            <button className="pane-chrome-tab-main" onClick={() => onSelectTab(tab.id, tab.name, tab.kind)} title={tab.name}>
                                <span className="pane-chrome-tab-prefix">{tab.kind === "dm" ? "@" : "#"}</span>
                                <span className="pane-chrome-tab-name">{tab.name}</span>
                            </button>
                            <button className="pane-chrome-tab-close" onClick={e => { e.stopPropagation(); onCloseTab(tab.id); }} aria-label={`Close ${tab.name}`}>
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {mode === "state2" && (
                <button
                    className="pane-chrome-pill"
                    onClick={onToggleMultiPaneState}
                    onMouseEnter={() => onPillHoverChange(true)}
                    onMouseLeave={() => onPillHoverChange(false)}
                    aria-label="Expand pane labels"
                    title="Ctrl+Shift+]"
                >
                    {paneLeaves.map((leaf, i) => (
                        <span
                            key={leaf.pane.paneId}
                            className={`pane-chrome-pill-num${leaf.pane.paneId === focusedPaneId ? " active" : ""}`}
                            onMouseDown={e => { e.stopPropagation(); onFocusPane(leaf.pane.paneId); }}
                        >
                            {i + 1}
                        </span>
                    ))}
                </button>
            )}

            {mode === "state3" && (
                <button className="pane-chrome-circle" onClick={onToggleMultiPaneState} aria-label="Collapse pane labels" title="Ctrl+Shift+[" />
            )}

            {totalUnread > 0 && (
                <span className="pane-chrome-unread" aria-label={`${totalUnread} unread`}>
                    {totalUnread > 99 ? "99+" : totalUnread}
                </span>
            )}
        </div>
    );
}

function ChromeLeafIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
    );
}
```

- [ ] **Step 2: Add the CSS section**

In `grove_client/src/styles/darkwood.css`, insert a new section immediately after the `TAB BAR` section (which currently ends right before the `NOTIFICATION PANEL` header at line 2467):

```css
/* ============================================================
   PANE CHROME — persistent floating bar / pill / circle
   ============================================================ */

.pane-chrome {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 6px 8px;
  transition: gap var(--dur-normal) var(--ease-out), padding var(--dur-normal) var(--ease-out);
}

.pane-chrome-logo {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--leaf-bright);
  cursor: pointer;
  flex-shrink: 0;
}

.pane-chrome-logo:hover { background: var(--leaf-glow); }
.pane-chrome-logo svg   { width: 17px; height: 17px; }

/* State 1 — full floating box, ~5px from every edge via the shell's own padding */
.pane-chrome-state1 {
  background: var(--surface-0);
  border: 1px solid rgba(106, 184, 112, 0.12);
  border-radius: var(--r-md);
  padding: 4px 8px;
  height: 36px;
}

.pane-chrome-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  min-width: 0;
}

.pane-chrome-hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
  white-space: nowrap;
}

.pane-chrome-tab {
  display: flex;
  align-items: center;
  border-radius: var(--r-xs);
  padding: 2px 4px;
  gap: 4px;
  flex-shrink: 0;
}

.pane-chrome-tab.active { background: var(--leaf-glow); }

.pane-chrome-tab-main {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
}

.pane-chrome-tab.active .pane-chrome-tab-main { color: var(--leaf-bright); }
.pane-chrome-tab-prefix { color: var(--text-muted); font-family: var(--font-mono); }

.pane-chrome-tab-close {
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}

.pane-chrome-tab-close:hover { color: var(--text-primary); }

/* State 2 — narrow pill, numbers only, hover reveals labels */
.pane-chrome-pill {
  width: 26px;
  min-height: 60px;
  border-radius: var(--r-md);
  background: var(--surface-0);
  border: 1px solid rgba(106, 184, 112, 0.15);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 0;
  cursor: pointer;
  position: relative;
}

.pane-chrome-pill-num {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
}

.pane-chrome-pill-num.active { color: var(--leaf-bright); }

/* State 3 — tiny circle, maximal room for panes */
.pane-chrome-circle {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid rgba(106, 184, 112, 0.2);
  cursor: pointer;
  transition: transform var(--dur-fast);
}

.pane-chrome-circle:hover { transform: scale(1.3); background: var(--leaf-glow); }

.pane-chrome-unread {
  min-width: 16px;
  height: 16px;
  background: var(--leaf-bright);
  color: var(--text-inverse);
  font-size: 9px;
  font-weight: 700;
  border-radius: var(--r-full);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/panes/PaneChrome.tsx`
Expected: no errors (no consumer yet — wired into `AppShell.tsx` in Task 14).

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/panes/PaneChrome.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: PaneChrome component (state1/2/3 chrome object)"
```

---

### Task 10: CommandIsland component

**Files:**
- Create: `grove_client/src/components/panes/CommandIsland.tsx`
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Produces:

```ts
export type IslandAction = "settings" | "channels" | "messages" | "users" | "notifications" | "activity" | "more";
export interface CommandIslandProps {
    open:     boolean;
    onSelect: (action: IslandAction) => void;
    onClose:  () => void;
}
export function CommandIsland(props: CommandIslandProps): React.ReactElement | null;
```

`IslandAction` is the exact type `AppShell.tsx` (Task 14) switches on to dispatch `handleIslandAction`.

- [ ] **Step 1: Implement the component**

Create `grove_client/src/components/panes/CommandIsland.tsx`:

```tsx
import { useEffect, useState } from "react";

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

export interface CommandIslandProps {
    open:     boolean;
    onSelect: (action: IslandAction) => void;
    onClose:  () => void;
}

export function CommandIsland({ open, onSelect, onClose }: CommandIslandProps) {
    const [focusIdx, setFocusIdx] = useState(0);

    useEffect(() => {
        if (open) setFocusIdx(0);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setFocusIdx(i => Math.min(i + 1, ISLAND_ITEMS.length - 1));
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setFocusIdx(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const item = ISLAND_ITEMS[focusIdx];
                if (!item.inert) onSelect(item.action);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, focusIdx, onSelect, onClose]);

    if (!open) return null;

    return (
        <div className="command-island-backdrop" onClick={onClose} aria-hidden="true">
            <div
                className="command-island"
                role="menu"
                aria-label="Command island"
                onClick={e => e.stopPropagation()}
            >
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
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add the CSS section**

In `grove_client/src/styles/darkwood.css`, insert a new section immediately after the `PANE CHROME` section added in Task 9:

```css
/* ============================================================
   COMMAND ISLAND — Dynamic-Island-style morph
   ============================================================ */

.command-island-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: center;
  padding-top: 12px;
}

.command-island {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 14px;
  background: #000;
  border-radius: var(--r-full);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: command-island-grow var(--dur-normal) var(--ease-out);
  transform-origin: center;
}

@keyframes command-island-grow {
  from { clip-path: circle(0% at 50% 50%); opacity: 0; }
  to   { clip-path: circle(75% at 50% 50%); opacity: 1; }
}

.command-island-item {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: color var(--dur-fast), background var(--dur-fast), transform var(--dur-fast);
}

.command-island-item.focused {
  color: var(--leaf-bright);
  background: rgba(106, 184, 112, 0.18);
  transform: scale(1.08);
}

.command-island-item.inert {
  cursor: default;
  opacity: 0.4;
}
```

`--ease-out` (already `cubic-bezier(0.16, 1, 0.3, 1)`, darkwood.css line 67) and `--z-modal` (`40`, line 64) are both existing tokens — no new tokens needed here.

- [ ] **Step 3: Verify it compiles**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/panes/CommandIsland.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/panes/CommandIsland.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: CommandIsland component"
```

---

### Task 11: DetailsPane component

**Files:**
- Create: `grove_client/src/components/panes/DetailsPane.tsx`
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Consumes: `DisplayMessage` type from `grove_client/src/components/MessageList.tsx` (already exported, used today by `ChatView.tsx:5`).
- Produces:

```ts
export interface DetailsPaneProps {
    channelId: number | null;
    messages:  DisplayMessage[];
}
export function DetailsPane(props: DetailsPaneProps): React.ReactElement;
```

Per spec ("What This Spec Does Not Resolve" is silent on Files/Photos because there's no upload feature; per the user's "Honest empty states" decision) — Shared Links is a real client-side URL scan over the already-loaded `messages` array; Files and Photos & Videos are explicit, honest "not available yet" states, not fake placeholders pretending to load.

- [ ] **Step 1: Implement the component**

Create `grove_client/src/components/panes/DetailsPane.tsx`:

```tsx
import type { DisplayMessage } from "../MessageList";

export interface DetailsPaneProps {
    channelId: number | null;
    messages:  DisplayMessage[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

function extractLinks(messages: DisplayMessage[]): string[] {
    const found: string[] = [];
    for (const m of messages) {
        if (m.deleted) continue;
        const matches = m.text.match(URL_PATTERN);
        if (matches) found.push(...matches);
    }
    // newest first, de-duplicated
    return [...new Set(found.reverse())];
}

export function DetailsPane({ channelId, messages }: DetailsPaneProps) {
    if (channelId === null) {
        return (
            <div className="details-pane details-pane-empty">
                <p>No channel selected.</p>
            </div>
        );
    }

    const links = extractLinks(messages);

    return (
        <div className="details-pane">
            <section className="details-pane-section">
                <h3 className="details-pane-heading">Shared Links</h3>
                {links.length === 0 ? (
                    <p className="details-pane-empty-text">No links shared yet.</p>
                ) : (
                    <ul className="details-pane-link-list">
                        {links.map((url, i) => (
                            <li key={i} className="details-pane-link-item">
                                <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="details-pane-section">
                <h3 className="details-pane-heading">Files</h3>
                <p className="details-pane-empty-text">Grove doesn't support file uploads yet.</p>
            </section>

            <section className="details-pane-section">
                <h3 className="details-pane-heading">Photos &amp; Videos</h3>
                <p className="details-pane-empty-text">Grove doesn't support media uploads yet.</p>
            </section>
        </div>
    );
}
```

`href={url}` is safe here without an explicit scheme allowlist: `URL_PATTERN` only ever matches strings starting with the literal `https?://`, so every value passed to `href` is already guaranteed to be `http:` or `https:` — there's no path through which an arbitrary scheme (e.g. `javascript:`) can reach this prop.

- [ ] **Step 2: Add the CSS section**

In `grove_client/src/styles/darkwood.css`, insert a new section immediately after the `COMMAND ISLAND` section added in Task 10:

```css
/* ============================================================
   DETAILS PANE — satellite pane (links/files/photos)
   ============================================================ */

.details-pane {
  height: 100%;
  overflow-y: auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.details-pane-empty {
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.details-pane-section { border-top: 1px solid var(--border); padding-top: var(--sp-3); }
.details-pane-section:first-child { border-top: none; padding-top: 0; }

.details-pane-heading {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: var(--sp-2);
}

.details-pane-empty-text { color: var(--text-muted); font-size: var(--text-sm); }

.details-pane-link-list { display: flex; flex-direction: column; gap: 6px; }

.details-pane-link-item a {
  font-size: var(--text-sm);
  color: var(--leaf-bright);
  word-break: break-all;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/panes/DetailsPane.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/panes/DetailsPane.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: DetailsPane component"
```

---

### Task 12: PaneGrid component

**Files:**
- Create: `grove_client/src/components/panes/PaneGrid.tsx`
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Consumes: `PaneTreeNode`, `LeafNode`, `PaneContent`, `getLeaves` from `paneLayout.ts` (Task 2).
- Produces:

```ts
export interface PaneGridProps {
    root:              PaneTreeNode;
    chromeState:       "state2" | "state3";
    focusedPaneId:     string | null;
    pillHovered:       boolean;
    onFocusPane:       (paneId: string) => void;
    onHoverPane:       (paneId: string | null) => void;
    onOpenDetails:     (paneId: string) => void;
    renderContent:     (pane: PaneContent) => React.ReactNode;
}
export function PaneGrid(props: PaneGridProps): React.ReactElement;
```

Purely presentational — no `ChatView`/socket/API imports. `AppShell.tsx` (Task 14) supplies `renderContent` and `pillHovered` (from `PaneChrome`'s `onPillHoverChange`, Task 9). `pillHovered` is what makes the State 2 hover-identify interaction match the approved `state2-fix.html` visual-companion mockup: hovering the pill dims **every pane** and shows each one's own number + label centered in place, not a tooltip near the pill.

- [ ] **Step 1: Implement the component**

Create `grove_client/src/components/panes/PaneGrid.tsx`:

```tsx
import { getLeaves, type PaneContent, type PaneTreeNode } from "../../paneLayout";

const KIND_ACCENT: Record<PaneContent["kind"], string> = {
    channel:      "var(--leaf-bright)",
    dm:           "#5a9bd8",
    notification: "#d8a545",
    details:      "#a56ad8",
};

export interface PaneGridProps {
    root:          PaneTreeNode;
    chromeState:   "state2" | "state3";
    focusedPaneId: string | null;
    pillHovered:   boolean;
    onFocusPane:   (paneId: string) => void;
    onHoverPane:   (paneId: string | null) => void;
    onOpenDetails: (paneId: string) => void;
    renderContent: (pane: PaneContent) => React.ReactNode;
}

type PaneNodeProps = {
    node:      PaneTreeNode;
    indexById: Map<string, number>;
} & Omit<PaneGridProps, "root">;

export function PaneGrid({
    root, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, renderContent,
}: PaneGridProps) {
    const indexById = new Map(getLeaves(root).map((leaf, i) => [leaf.pane.paneId, i + 1]));
    return (
        <div className={`pane-grid-root${pillHovered ? " pane-grid-dimmed" : ""}`}>
            <PaneNode
                node={root}
                indexById={indexById}
                chromeState={chromeState}
                focusedPaneId={focusedPaneId}
                pillHovered={pillHovered}
                onFocusPane={onFocusPane}
                onHoverPane={onHoverPane}
                onOpenDetails={onOpenDetails}
                renderContent={renderContent}
            />
        </div>
    );
}

function PaneNode({
    node, indexById, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, renderContent,
}: PaneNodeProps) {
    if (node.type === "split") {
        return (
            <div className={`pane-split pane-split-${node.axis}`}>
                <div className="pane-split-cell" style={{ flex: node.ratio }}>
                    <PaneNode node={node.a} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} renderContent={renderContent} />
                </div>
                <div className="pane-split-cell" style={{ flex: 1 - node.ratio }}>
                    <PaneNode node={node.b} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} renderContent={renderContent} />
                </div>
            </div>
        );
    }

    const { pane } = node;
    const isFocused = pane.paneId === focusedPaneId;
    const paneIndex = indexById.get(pane.paneId) ?? 0;

    return (
        <div
            className={`pane-leaf${isFocused ? " focused" : ""}`}
            onMouseEnter={() => onHoverPane(pane.paneId)}
            onMouseLeave={() => onHoverPane(null)}
            onMouseDown={() => onFocusPane(pane.paneId)}
        >
            {chromeState === "state3" && (
                <div className="pane-leaf-header" style={{ borderLeftColor: KIND_ACCENT[pane.kind] }}>
                    <span className="pane-leaf-header-icon">{pane.kind === "dm" ? "@" : pane.kind === "channel" ? "#" : pane.kind === "details" ? "ⓘ" : "🔔"}</span>
                    <span className="pane-leaf-header-name">{pane.channelName || "Empty pane"}</span>
                    {pane.kind !== "details" && pane.channelId !== null && (
                        <button
                            className="pane-leaf-header-details-btn"
                            onClick={() => onOpenDetails(pane.paneId)}
                            aria-label="Open details"
                            title="Details"
                        >
                            ⓘ
                        </button>
                    )}
                </div>
            )}
            <div className="pane-leaf-content">
                {renderContent(pane)}
            </div>
            {chromeState === "state2" && pillHovered && (
                <div className="pane-leaf-reveal" aria-hidden="true">
                    <span className="pane-leaf-reveal-num">{paneIndex}</span>
                    <span className="pane-leaf-reveal-label">{pane.channelName || "empty"}</span>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Add the CSS section**

In `grove_client/src/styles/darkwood.css`, insert a new section immediately after the `DETAILS PANE` section added in Task 11:

```css
/* ============================================================
   PANE GRID — dwindle-tree tiling renderer
   ============================================================ */

.pane-grid-root {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 5px;
}

.pane-grid-root > * { flex: 1; min-width: 0; min-height: 0; }

.pane-split {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 5px;
}

.pane-split-row    { flex-direction: row; }
.pane-split-column { flex-direction: column; }

.pane-split-cell {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.pane-leaf {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface-1);
}

.pane-leaf.focused {
  box-shadow: 0 0 0 1px rgba(106, 184, 112, 0.35) inset;
}

/* State 2 pill-hover — dim every pane, reveal number + label in place */
.pane-grid-dimmed .pane-leaf-content {
  opacity: 0.35;
  transition: opacity var(--dur-fast);
}

.pane-leaf-reveal {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(10, 14, 10, 0.35);
}

.pane-leaf-reveal-num   { font-size: 1.8em; font-weight: 700; color: var(--text-primary); }
.pane-leaf-reveal-label { font-size: var(--text-sm); color: var(--text-secondary); margin-top: 4px; }

.pane-leaf-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-left: 3px solid var(--leaf-bright);
  background: var(--surface-2);
  flex-shrink: 0;
}

.pane-leaf-header-icon { color: var(--text-muted); font-size: var(--text-sm); }
.pane-leaf-header-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-leaf-header-details-btn {
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-sm);
}

.pane-leaf-header-details-btn:hover { color: var(--leaf-bright); }

.pane-leaf-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.pane-leaf-content > * { flex: 1; min-width: 0; min-height: 0; }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd grove_client && npx tsc -b && npx eslint src/components/panes/PaneGrid.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add grove_client/src/components/panes/PaneGrid.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: PaneGrid recursive tiling renderer"
```

---

### Task 13: AppShell — pane state, helper refactors, and the background-message fix

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx`
- Modify: `grove_client/src/components/ChatView.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2–12 (`paneLayout.ts` exports, `usePaneKeybinds`, `PaneChrome`, `CommandIsland`, `DetailsPane`, `PaneGrid`).
- Produces: `openOrFill(channelId, name, kind)`, `fillFocusedPane(channelId, name, kind)`, `ensureChannelLoaded(channelId, kind)`, `renderPaneContent(pane)`, `handleIslandAction(action)`, `openDetailsForPane(channelId, channelName, sourcePaneId)` — all used by Task 14's render-tree swap. `ChatView`'s new `onOpenDetails?: () => void` prop — used by Task 14's State-1 `ChatView` instance. This task does **not** touch the JSX render tree yet (that's Task 14) — it only adds state, refactors `openChannel`, adds the one new `ChatView` prop, and fixes the background-message check, all of which must work correctly with the *existing* State-1-only render tree before Task 14 changes what's on screen.

- [ ] **Step 1: Add the new imports**

In `grove_client/src/components/AppShell.tsx`, replace the import block (lines 1–22) with:

```tsx
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
    joinByCode, getChannelMembers,
} from "../api";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate,
    type EditUpdate, type DeleteUpdate, type UserProfile,
    type PinnedMessage, type ChannelRole,
} from "../types";
import type { DisplayMessage } from "./MessageList";
import { ChatView } from "./ChatView";
import { useWebRTC } from "../useWebRTC";
import { packMessage } from "../protocol";
import type { ActivityStatus } from "./ProfileMenu";
import { DecryptReveal } from "./motion/DecryptReveal";
import {
    makeLeaf, makeEmptyPaneContent, countLeaves, getLeaves, findLeafById,
    splitAuto, splitDirectional, removePane, deriveChromeState, toggleMultiPaneState,
    MAX_PANES,
    type PaneTreeNode, type PaneContent, type SplitDirection,
} from "../paneLayout";
import { usePaneKeybinds } from "../hooks/usePaneKeybinds";
import { PaneChrome } from "./panes/PaneChrome";
import { PaneGrid } from "./panes/PaneGrid";
import { CommandIsland, type IslandAction } from "./panes/CommandIsland";
import { DetailsPane } from "./panes/DetailsPane";
```

- [ ] **Step 2: Add the new pane state**

In `grove_client/src/components/AppShell.tsx`, immediately after the `settingsOpen`/`myChannelRoles` lines (currently `AppShell.tsx:91-92`):

```tsx
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [myChannelRoles, setMyChannelRoles] = useState<Record<number, ChannelRole>>({});

    /* Pane tiling */
    const [paneRoot, setPaneRoot]                     = useState<PaneTreeNode | null>(null);
    const [focusedPaneId, setFocusedPaneId]           = useState<string | null>(null);
    const [hoveredPaneId, setHoveredPaneId]           = useState<string | null>(null);
    const [lastMultiPaneState, setLastMultiPaneState] = useState<"state2" | "state3">("state2");
    const [islandOpen, setIslandOpen]                 = useState(false);
    const [settingsChannelId, setSettingsChannelId]   = useState<number | null>(null);
    const [pillHovered, setPillHovered]               = useState(false);
```

- [ ] **Step 3: Add a ref for the pane-mode guard used by the existing tab-shortcuts effect**

In `grove_client/src/components/AppShell.tsx`, in the refs block (currently `AppShell.tsx:134-141`), add one ref:

```tsx
    /* Latest-value refs — updated inline each render for keyboard handler */
    const tabsForKeys   = useRef<{ id: number; name: string; kind: "channel" | "dm" }[]>([]);
    const activeForKeys = useRef<number | null>(null);
    const paletteModeRef = useRef<"default" | "browse" | "join-code" | "create-options">("default");
    const paneRootRef     = useRef<PaneTreeNode | null>(null);
    const visibleChannelIdsRef = useRef<number[]>([]);
```

- [ ] **Step 4: Guard the existing tab-shortcuts effect against pane mode**

In `grove_client/src/components/AppShell.tsx`, at the top of `onTabKey` (currently `AppShell.tsx:225-228`), add an early return:

```tsx
        function onTabKey(e: KeyboardEvent) {
            if (paneRootRef.current !== null) return; // pane mode active — usePaneKeybinds owns these keys instead
            const tabs  = tabsForKeys.current;
            const actId = activeForKeys.current;
```

- [ ] **Step 5: Fix the background-message check to cover every visible pane**

In `grove_client/src/components/AppShell.tsx`, replace line 391:

```tsx
                    const isBackground = activeForKeys.current !== msg.channelId;
```

with:

```tsx
                    const isBackground = !visibleChannelIdsRef.current.includes(msg.channelId);
```

- [ ] **Step 6: Factor `openChannel`'s load-once side effect out of the tab-focused parts**

In `grove_client/src/components/AppShell.tsx`, replace the entire `openChannel` function (currently lines 466–520) with:

```tsx
    async function ensureChannelLoaded(channelId: number, kind: "channel" | "dm") {
        // Populate the caller's role for this channel lazily, the first time it's
        // opened — needed so Delete's moderator gating works even before the
        // settings modal has ever been opened.
        if (kind === "channel" && !(channelId in myChannelRoles)) {
            getChannelMembers(channelId, token)
                .then(members => {
                    const me = members.find(m => m.user_id === userId);
                    if (me) setMyChannelRoles(prev => ({ ...prev, [channelId]: me.role }));
                })
                .catch(() => {});
        }

        if (loadedRef.current.has(channelId)) return;
        loadedRef.current.add(channelId);

        try {
            if (kind === "channel") await joinChannel(channelId, token);
            const [history, rxData] = await Promise.all([
                getHistory(channelId, token),
                getChannelReactions(channelId, token),
            ]);
            setMessages(prev => ({
                ...prev,
                [channelId]: history.slice().reverse().map(m => ({
                    id: m.id, userId: m.user_id, text: m.text,
                    timestamp: m.timestamp, edited: m.edited, deleted: m.deleted,
                })),
            }));
            if (history.length > 0) oldestIdRef.current[channelId] = history[history.length - 1].id;
            setHasMore(prev => ({ ...prev, [channelId]: history.length >= 50 }));
            if (rxData.length > 0) {
                const rxMap: ReactionsMap = {};
                for (const r of rxData) {
                    if (!rxMap[r.message_id]) rxMap[r.message_id] = {};
                    rxMap[r.message_id][r.emoji] = { count: r.count, byMe: r.by_me };
                }
                setReactions(prev => ({ ...prev, [channelId]: rxMap }));
            }
            [...new Set(history.map(m => m.user_id))].forEach(uid => resolveUsername(uid));
            getChannelPins(channelId, token)
                .then(list => { if (list.length) setPins(prev => ({ ...prev, [channelId]: list })); })
                .catch(() => {});
        } catch { /* already member */ }
    }

    function markRecentAndClearUnread(channelId: number) {
        dismissChannelToasts(channelId);
        setUnread(prev => { const n = { ...prev }; delete n[channelId]; return n; });
        setRecentIds(prev => [channelId, ...prev.filter(id => id !== channelId)].slice(0, 10));
    }

    async function openChannel(channelId: number, displayName: string, kind: "channel" | "dm" = "channel") {
        markRecentAndClearUnread(channelId);
        setActiveCh(channelId);
        setActiveKind(kind);
        setActiveName(displayName);
        setActivePage("chat");
        setOpenTabs(prev => prev.find(t => t.id === channelId) ? prev : [...prev, { id: channelId, name: displayName, kind }]);
        setPaletteOpen(false);
        await ensureChannelLoaded(channelId, kind);
    }

    async function fillFocusedPane(channelId: number, displayName: string, kind: "channel" | "dm") {
        markRecentAndClearUnread(channelId);
        setPaletteOpen(false);
        if (focusedPaneId !== null) {
            setPaneRoot(prev => prev === null ? prev : replacePaneContent(prev, focusedPaneId, {
                paneId: focusedPaneId, kind, channelId, channelName: displayName,
            }));
        }
        await ensureChannelLoaded(channelId, kind);
    }

    /** Routes "navigate to this conversation" to the right place depending on
        whether pane mode is active — State 1 keeps today's single-active-channel
        behavior; pane mode fills whichever pane currently has focus. */
    function openOrFill(channelId: number, displayName: string, kind: "channel" | "dm") {
        if (paneRoot === null) openChannel(channelId, displayName, kind);
        else fillFocusedPane(channelId, displayName, kind);
    }

    function replacePaneContent(root: PaneTreeNode, paneId: string, content: PaneContent): PaneTreeNode {
        if (root.type === "leaf") {
            return root.pane.paneId === paneId ? makeLeaf(content) : root;
        }
        return { ...root, a: replacePaneContent(root.a, paneId, content), b: replacePaneContent(root.b, paneId, content) };
    }
```

- [ ] **Step 7: Update every existing `openChannel(...)` call site that means "navigate here" to call `openOrFill` instead**

In `grove_client/src/components/AppShell.tsx`:

In `closeTab` (currently line 527), replace:
```tsx
            if (adj) openChannel(adj.id, adj.name, adj.kind);
```
with:
```tsx
            if (adj) openOrFill(adj.id, adj.name, adj.kind);
```

In `openDmWith` (currently lines 567–576), replace the whole function:
```tsx
    async function openDmWith(partnerId: number) {
        const existing = dms.find(d => d.partner_id === partnerId);
        if (existing) { openChannel(existing.channel_id, existing.partner_name, "dm"); return; }
        try {
            const { channel_id } = await openDm(partnerId, token);
            const name = usernames[partnerId] ?? `user ${partnerId}`;
            setDms(prev => [{ channel_id, partner_id: partnerId, partner_name: name }, ...prev]);
            openChannel(channel_id, name, "dm");
        } catch { /* ignore */ }
    }
```
with:
```tsx
    async function openDmWith(partnerId: number) {
        const existing = dms.find(d => d.partner_id === partnerId);
        if (existing) { openOrFill(existing.channel_id, existing.partner_name, "dm"); return; }
        try {
            const { channel_id } = await openDm(partnerId, token);
            const name = usernames[partnerId] ?? `user ${partnerId}`;
            setDms(prev => [{ channel_id, partner_id: partnerId, partner_name: name }, ...prev]);
            openOrFill(channel_id, name, "dm");
        } catch { /* ignore */ }
    }
```

In `handleCreateChannel` (currently line 608), replace:
```tsx
            openChannel(res.channel_id, name, "channel");
```
with:
```tsx
            openOrFill(res.channel_id, name, "channel");
```

In `handleJoinByCode` (currently line 622), replace:
```tsx
            openChannel(res.channel_id, res.name, "channel");
```
with:
```tsx
            openOrFill(res.channel_id, res.name, "channel");
```

In `selectPaletteItem` (currently lines 729–744), replace the `channel`/`dm` branches:
```tsx
    function selectPaletteItem(item: PaletteItem) {
        if (item.kind === "channel") {
            openChannel(item.id, item.name, "channel");
        } else if (item.kind === "dm") {
            if (item.id < 0) {
                openDmWith(item.partnerId);
            } else {
                openChannel(item.id, item.name, "dm");
            }
        } else if (item.kind === "action") {
```
with:
```tsx
    function selectPaletteItem(item: PaletteItem) {
        if (item.kind === "channel") {
            openOrFill(item.id, item.name, "channel");
        } else if (item.kind === "dm") {
            if (item.id < 0) {
                openDmWith(item.partnerId);
            } else {
                openOrFill(item.id, item.name, "dm");
            }
        } else if (item.kind === "action") {
```

- [ ] **Step 8: Keep the latest-value refs in sync**

In `grove_client/src/components/AppShell.tsx`, in the ref-sync block (currently lines 766–772), add the two new refs:

```tsx
    /* Keep latest-value refs in sync (runs every render, before any effect) */
    tabsForKeys.current   = openTabs;
    activeForKeys.current = activeChannelId;
    channelsRef.current   = channels;
    dmsRef.current        = dms;
    usernamesRef.current  = usernames;
    paletteModeRef.current = paletteMode;
    paneRootRef.current    = paneRoot;
    visibleChannelIdsRef.current = paneRoot === null
        ? (activeChannelId !== null ? [activeChannelId] : [])
        : getLeaves(paneRoot).map(l => l.pane.channelId).filter((id): id is number => id !== null);
```

- [ ] **Step 9: Wire up `usePaneKeybinds`**

In `grove_client/src/components/AppShell.tsx`, immediately after the "Tab keyboard shortcuts" `useEffect` block (which now ends at the closing `}, []);` that used to be line 281), add:

```tsx
    /* ── Pane-tiling keyboard shortcuts ──────────────────── */

    usePaneKeybinds({
        isPaneModeActive: () => paneRootRef.current !== null,
        getFocusedPaneId: () => focusedPaneId,
        getHoveredPaneId: () => hoveredPaneId,
        onCreateSplit: () => {
            // paneRoot/focusedPaneId/activeChannelId below are always the
            // current render's values — usePaneKeybinds refreshes its actions
            // ref every render (Task 8), so this closure is never stale.
            if (paneRoot === null) {
                if (activeChannelId === null) return; // nothing to split from yet
                const newPaneId = crypto.randomUUID();
                const firstLeaf = makeLeaf({
                    paneId: crypto.randomUUID(),
                    kind: activeChannelKind,
                    channelId: activeChannelId,
                    channelName: activeDisplayName,
                });
                setPaneRoot(splitAuto(firstLeaf, firstLeaf.pane.paneId, makeEmptyPaneContent(newPaneId)));
                setFocusedPaneId(newPaneId);
                return;
            }
            if (focusedPaneId === null || countLeaves(paneRoot) >= MAX_PANES) return;
            const newPaneId = crypto.randomUUID();
            setPaneRoot(splitAuto(paneRoot, focusedPaneId, makeEmptyPaneContent(newPaneId)));
            setFocusedPaneId(newPaneId);
        },
        onDirectionalSplit: (direction: SplitDirection) => {
            if (paneRoot === null) {
                if (activeChannelId === null) return;
                const newPaneId = crypto.randomUUID();
                const firstLeaf = makeLeaf({
                    paneId: crypto.randomUUID(),
                    kind: activeChannelKind,
                    channelId: activeChannelId,
                    channelName: activeDisplayName,
                });
                setPaneRoot(splitDirectional(firstLeaf, firstLeaf.pane.paneId, makeEmptyPaneContent(newPaneId), direction));
                setFocusedPaneId(newPaneId);
                return;
            }
            const targetId = hoveredPaneId ?? focusedPaneId;
            if (targetId === null || countLeaves(paneRoot) >= MAX_PANES) return;
            const newPaneId = crypto.randomUUID();
            setPaneRoot(splitDirectional(paneRoot, targetId, makeEmptyPaneContent(newPaneId), direction));
            setFocusedPaneId(newPaneId);
        },
        onCollapseChrome: () => setLastMultiPaneState(prev => prev === "state2" ? "state3" : prev),
        onExpandChrome:   () => setLastMultiPaneState(prev => prev === "state3" ? "state2" : prev),
        onToggleIsland:   () => setIslandOpen(v => !v),
        onClosePane: (paneId: string) => {
            if (paneRoot === null) return;
            const result = removePane(paneRoot, paneId);
            if (result === null || result.type === "leaf") {
                const survivor = result?.type === "leaf" ? result.pane : null;
                setPaneRoot(null);
                if (survivor && survivor.channelId !== null) {
                    const channelId = survivor.channelId;
                    const kind = survivor.kind === "dm" ? "dm" : "channel";
                    setActiveCh(channelId);
                    setActiveName(survivor.channelName);
                    setActiveKind(kind);
                    // Restore this channel to the State 1 tab list — it may have
                    // been filled into a pane mid-tiling without ever going
                    // through openChannel/setOpenTabs.
                    setOpenTabs(prev => prev.find(t => t.id === channelId)
                        ? prev
                        : [...prev, { id: channelId, name: survivor.channelName, kind }]);
                } else {
                    setActiveCh(null);
                    setActiveName("");
                }
                setFocusedPaneId(null);
                return;
            }
            setPaneRoot(result);
            const remaining = getLeaves(result);
            if (!remaining.some(l => l.pane.paneId === focusedPaneId)) {
                setFocusedPaneId(remaining[0]?.pane.paneId ?? null);
            }
        },
        onSwitchToPaneIndex: (index: number) => {
            if (paneRoot === null) return;
            const leaves = getLeaves(paneRoot);
            const target = leaves[index];
            if (target) setFocusedPaneId(target.pane.paneId);
        },
    });
```

- [ ] **Step 10: Add `handleIslandAction` and `renderPaneContent`**

In `grove_client/src/components/AppShell.tsx`, immediately before the `/* ── Derived values ─────────────────── */` comment (currently line 774), add:

```tsx
    /* ── Command island actions ─────────────────────────── */

    function handleIslandAction(action: IslandAction) {
        setIslandOpen(false);
        if (action === "channels") {
            setPaletteOpen(true); setPaletteMode("browse"); setPaletteQuery(""); setPaletteIdx(0);
        } else if (action === "messages") {
            setPaletteOpen(true); setPaletteMode("default"); setPaletteQuery(""); setPaletteIdx(0);
        } else if (action === "users") {
            setActivePage("friends");
        } else if (action === "notifications") {
            setNotifOpen(true);
        } else if (action === "settings") {
            const focusedChannelId = focusedPaneId !== null
                ? (findLeafById(paneRoot, focusedPaneId)?.pane.channelId ?? null)
                : activeChannelId;
            if (focusedChannelId !== null) {
                setSettingsChannelId(focusedChannelId);
                setSettingsOpen(true);
            }
        }
        // "activity" and "more" are reserved for future icons — no action yet.
    }

    /* ── Per-pane content dispatch ───────────────────────── */

    function sendToChannel(channelId: number, text: string) {
        const now = Math.floor(Date.now() / 1000);
        const clientId = crypto.randomUUID();
        setMessages(prev => ({
            ...prev,
            [channelId]: [...(prev[channelId] ?? []), { userId, text, timestamp: now, pending: true, clientId }],
        }));
        socketRef.current?.sendText(channelId, text);
    }

    async function pinInChannel(channelId: number, msgId: number) {
        await pinMessage(msgId, token).catch(() => {});
        const list = await getChannelPins(channelId, token).catch(() => [] as PinnedMessage[]);
        setPins(prev => ({ ...prev, [channelId]: list }));
    }

    async function unpinInChannel(channelId: number, msgId: number) {
        await unpinMessage(msgId, token).catch(() => {});
        setPins(prev => ({ ...prev, [channelId]: (prev[channelId] ?? []).filter(p => p.message_id !== msgId) }));
    }

    function renderPaneContent(pane: PaneContent) {
        if (pane.kind === "notification") {
            return (
                <NotifPanel
                    channels={channels}
                    dms={dms}
                    unreads={unreadByChannel}
                    onNavigate={(id, name, kind) => openOrFill(id, name, kind)}
                    onClose={() => {}}
                />
            );
        }
        if (pane.kind === "details") {
            return <DetailsPane channelId={pane.channelId} messages={pane.channelId !== null ? (messages[pane.channelId] ?? []) : []} />;
        }
        if (pane.channelId === null) {
            return (
                <div className="pane-empty-content">
                    <p>Press <kbd>Ctrl K</kbd> to fill this pane.</p>
                </div>
            );
        }
        const channelId = pane.channelId;
        const role: ChannelRole = myChannelRoles[channelId] ?? "member";
        return (
            <ChatView
                channelId={channelId}
                channelName={pane.channelName}
                isDm={pane.kind === "dm"}
                myRole={role}
                onOpenSettings={pane.kind === "channel" ? () => { setSettingsChannelId(channelId); setSettingsOpen(true); } : undefined}
                messages={messages[channelId] ?? []}
                usernames={usernames}
                currentUserId={userId}
                myUsername={myName}
                typingNames={[...(typingUsers[channelId] ?? new Map()).keys()].map(uid => usernames[uid] ?? `user ${uid}`)}
                connected={connected}
                hasMore={hasMore[channelId] ?? false}
                loadingMore={loadingMore.has(channelId)}
                reactions={reactions[channelId] ?? {}}
                pins={pins[channelId] ?? []}
                mentionUsers={mentionUsers}
                onSend={text => sendToChannel(channelId, text)}
                onTyping={() => socketRef.current?.sendTyping(channelId)}
                onLoadMore={() => loadMoreMessages(channelId)}
                onReact={(msgId, emoji) => socketRef.current?.sendReaction(channelId, msgId, emoji)}
                onEdit={(msgId, text) => socketRef.current?.sendEdit(channelId, msgId, text)}
                onDelete={msgId => socketRef.current?.sendDelete(channelId, msgId)}
                onPin={msgId => pinInChannel(channelId, msgId)}
                onUnpin={msgId => unpinInChannel(channelId, msgId)}
                onUserClick={uid => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
            />
        );
    }
```

- [ ] **Step 11: Add the "ⓘ Details" icon to ChatView, and a shared `openDetailsForPane` helper in AppShell**

In `grove_client/src/components/ChatView.tsx`, add the new optional prop to `ChatViewProps` (currently lines 11–37), right after `onOpenSettings?: () => void;`:

```tsx
    onOpenSettings?: () => void;
    onOpenDetails?:  () => void;
```

Destructure it in the component signature (currently line 40):
```tsx
export function ChatView({
    channelId, channelName, isDm, myRole, onOpenSettings, onOpenDetails,
    messages, usernames, currentUserId, myUsername,
```

Render it next to the existing settings button (currently lines 92–100):
```tsx
                {!isDm && onOpenSettings && (
                    <button
                        className="dw-chat-settings-btn"
                        onClick={onOpenSettings}
                        aria-label="Channel settings"
                    >
                        ⚙
                    </button>
                )}
                {onOpenDetails && (
                    <button
                        className="dw-chat-details-btn"
                        onClick={onOpenDetails}
                        aria-label="Open details"
                        title="Details"
                    >
                        ⓘ
                    </button>
                )}
```

In `grove_client/src/styles/darkwood.css`, in the `CHAT VIEW` section, add one rule reusing the existing settings-button styling (find `.dw-chat-settings-btn` and add a sibling selector immediately after its rule):
```css
.dw-chat-settings-btn,
.dw-chat-details-btn {
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-base);
}

.dw-chat-details-btn:hover { color: var(--leaf-bright); }
```
(If `.dw-chat-settings-btn` already has its own hover rule, leave it untouched and only add the two rules above.)

In `grove_client/src/components/AppShell.tsx`, add `openDetailsForPane` immediately after `handleIslandAction` (added in Step 10):

```tsx
    /** Opens (or reuses) a Details pane for `channelId`, tiled beside
        `sourcePaneId` — or, if pane mode isn't active yet, beside a
        synthesized first leaf built from the current State-1 conversation.
        Per spec, this never changes chromeState on its own — deriveChromeState
        already guarantees that by ignoring "details" leaves. */
    function openDetailsForPane(channelId: number, channelName: string, sourcePaneId: string | null) {
        if (countLeaves(paneRoot) >= MAX_PANES) return;
        const detailsContent: PaneContent = {
            paneId: crypto.randomUUID(), kind: "details", channelId,
            channelName: `${channelName} details`,
        };
        if (paneRoot === null) {
            const firstLeaf = makeLeaf({
                paneId: sourcePaneId ?? crypto.randomUUID(),
                kind: activeChannelKind, channelId, channelName,
            });
            setPaneRoot(splitDirectional(firstLeaf, firstLeaf.pane.paneId, detailsContent, "right"));
            return;
        }
        if (sourcePaneId === null) return;
        setPaneRoot(prev => prev === null ? prev : splitDirectional(prev, sourcePaneId, detailsContent, "right"));
    }
```

- [ ] **Step 12: Verify it compiles (expect unused-variable warnings — resolved in Task 14)**

Run: `cd grove_client && npx tsc -b`
Expected: errors about `PaneChrome`, `PaneGrid`, `CommandIsland`, `handleIslandAction`, `renderPaneContent`, `openDetailsForPane`, `mentionUsers` (already used elsewhere so that one is fine) being unused, because Task 14 hasn't wired them into JSX yet. This is expected and resolved by the next task — do not attempt to silence these here.

- [ ] **Step 13: Commit**

```bash
git add grove_client/src/components/AppShell.tsx grove_client/src/components/ChatView.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: AppShell pane state, keybind wiring, background-message fix, and Details entry point"
```

---

### Task 14: AppShell — render-tree swap

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `openOrFill`, `fillFocusedPane`, `renderPaneContent`, `handleIslandAction`, and all pane state from Task 13.
- Produces: the final on-screen behavior — this is the task where State 1/2/3 actually become visible and interactive.

- [ ] **Step 1: Replace the top-bar's logo + location button with `PaneChrome`, and remove the standalone `<TabBar/>` call**

In `grove_client/src/components/AppShell.tsx`, add one derived const right before the `/* ── Render ─────────────────────────────────────────── */` comment (currently line 797), alongside the existing `totalUnread`/`myRole` derived values:

```tsx
    const chromeState = deriveChromeState(paneRoot, lastMultiPaneState);
```

`chromeState` is the true 3-way state (`"state1" | "state2" | "state3"`) — used directly by `PaneChrome` below, and mapped down to a 2-way "are headers shown" value for `PaneGrid` in Step 2, since a lone conversation-plus-Details tiling (chrome still `"state1"` per Task 7's non-Details-leaf-count rule) should render its tiles **with** headers, same as `"state3"` — State 1 has never hidden the single pane's header, so there is no reason for a Details satellite to hide it either. Only `"state2"` (2+ genuine conversation panes, not yet collapsed to headers) is chrome-free.

Then replace the header's opening portion (currently lines 803–839, i.e. from `<header className="dw-topbar" role="banner">` through the closing `</button>` of `dw-topbar-location`, but keeping the unread-badge span removed since `PaneChrome` now renders its own):

```tsx
            <header className="dw-topbar" role="banner">
                <PaneChrome
                    mode={chromeState}
                    tabs={openTabs}
                    activeTabId={activeChannelId}
                    onSelectTab={(id, name, kind) => openOrFill(id, name, kind)}
                    onCloseTab={closeTab}
                    paneLeaves={paneRoot !== null ? getLeaves(paneRoot) : []}
                    focusedPaneId={focusedPaneId}
                    onFocusPane={setFocusedPaneId}
                    onPillHoverChange={setPillHovered}
                    totalUnread={totalUnread}
                    onLogoClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); setPaletteMode("default"); }}
                    onToggleMultiPaneState={() => setLastMultiPaneState(toggleMultiPaneState)}
                />

                <div className="dw-topbar-actions">
```

Then delete the old `<TabBar/>` call block (currently lines 900–907):

```tsx
            {/* ── Tab bar ─────────────────────────────── */}
            <TabBar
                tabs={openTabs}
                activeId={activeChannelId}
                unreads={unreadByChannel}
                onSelect={openChannel}
                onClose={closeTab}
            />

```

Delete it entirely — `PaneChrome`'s State 1 mode now renders the tab list inline.

- [ ] **Step 2: Replace the `<main>` content ternary to branch on pane mode**

In `grove_client/src/components/AppShell.tsx`, replace the entire `<main>` block (currently lines 910–986, from `<main className="dw-content" aria-label="Main content">` through its closing `</main>`) with:

```tsx
            {/* ── Content ─────────────────────────────── */}
            <main className="dw-content" aria-label="Main content">
                {activePage === "friends" ? (
                    <FriendsPage
                        friends={friendList}
                        onlineFriends={onlineFriends}
                        tab={friendTab}
                        onTab={setFriendTab}
                        showAdd={showAddFriend}
                        addFriendId={addFriendId}
                        onAddFriendId={setAddFriendId}
                        onToggleAdd={() => setShowAddFriend(v => !v)}
                        onAddFriend={handleAddFriend}
                        onRemoveFriend={handleRemoveFriend}
                        onDm={uid => { openDmWith(uid); setActivePage("chat"); }}
                        onCall={initiateCall}
                        onUserClick={uid => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
                    />
                ) : paneRoot !== null ? (
                    <PaneGrid
                        root={paneRoot}
                        chromeState={chromeState === "state2" ? "state2" : "state3"}
                        focusedPaneId={focusedPaneId}
                        pillHovered={pillHovered}
                        onFocusPane={setFocusedPaneId}
                        onHoverPane={setHoveredPaneId}
                        onOpenDetails={paneId => {
                            const leaf = findLeafById(paneRoot, paneId);
                            if (!leaf || leaf.pane.channelId === null) return;
                            openDetailsForPane(leaf.pane.channelId, leaf.pane.channelName, paneId);
                        }}
                        renderContent={renderPaneContent}
                    />
                ) : activeChannelId !== null ? (
                    <ChatView
                        channelId={activeChannelId}
                        channelName={activeDisplayName}
                        isDm={activeChannelKind === "dm"}
                        myRole={myRole}
                        onOpenSettings={() => { setSettingsChannelId(activeChannelId); setSettingsOpen(true); }}
                        onOpenDetails={() => openDetailsForPane(activeChannelId, activeDisplayName, null)}
                        messages={activeMessages}
                        usernames={usernames}
                        currentUserId={userId}
                        myUsername={myName}
                        typingNames={activeTyping}
                        connected={connected}
                        hasMore={hasMore[activeChannelId] ?? false}
                        loadingMore={loadingMore.has(activeChannelId)}
                        reactions={activeReactions}
                        pins={activePins}
                        mentionUsers={mentionUsers}
                        onSend={text => sendToChannel(activeChannelId, text)}
                        onTyping={() => socketRef.current?.sendTyping(activeChannelId)}
                        onLoadMore={() => loadMoreMessages(activeChannelId)}
                        onReact={(msgId, emoji) => socketRef.current?.sendReaction(activeChannelId, msgId, emoji)}
                        onEdit={(msgId, text) => socketRef.current?.sendEdit(activeChannelId, msgId, text)}
                        onDelete={msgId => socketRef.current?.sendDelete(activeChannelId, msgId)}
                        onPin={msgId => pinInChannel(activeChannelId, msgId)}
                        onUnpin={msgId => unpinInChannel(activeChannelId, msgId)}
                        onUserClick={(uid, _e) => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
                    />
                ) : (
                    <EmptyContent />
                )}
            </main>

            <CommandIsland open={islandOpen} onSelect={handleIslandAction} onClose={() => setIslandOpen(false)} />
```

Note: `myRole`/`activeMessages`/`activeReactions`/`activePins`/`activeTyping` (the existing derived consts at lines 781–788) are used only by this now-State-1-only `ChatView` branch — they stay exactly as they are today, no changes needed to their derivation. `onOpenSettings` no longer does its own inline role-fetch (the old version fetched `getChannelMembers` directly if `!(activeChannelId in myChannelRoles)`) — that fetch is now always already covered by `ensureChannelLoaded` (Task 13, Step 6), which runs the identical `!(channelId in myChannelRoles)` check every time a channel is navigated to, and navigating to a channel is a prerequisite for ever seeing its settings gear. This is a de-duplication, not a behavior loss.

- [ ] **Step 3: Point the Channel Settings modal at `settingsChannelId` instead of `activeChannelId`**

In `grove_client/src/components/AppShell.tsx`, replace the settings-modal block (currently lines 988–1007):

```tsx
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
                        myRole={myChannelRoles[activeChannelId] ?? "member"}
                        onClose={() => setSettingsOpen(false)}
                        onUpdated={updates => setChannels(prev => prev.map(c => (
                            c.id === activeChannelId ? { ...c, ...updates } : c
                        )))}
                    />
                );
            })()}
```

with:

```tsx
            {settingsOpen && settingsChannelId !== null && (() => {
                const settingsChannel = channels.find(c => c.id === settingsChannelId);
                if (!settingsChannel) return null;
                return (
                    <ChannelSettingsModal
                        channelId={settingsChannelId}
                        channelName={settingsChannel.name}
                        description={settingsChannel.description}
                        category={settingsChannel.category}
                        isPrivate={settingsChannel.is_private}
                        token={token}
                        currentUserId={userId}
                        myRole={myChannelRoles[settingsChannelId] ?? "member"}
                        onClose={() => setSettingsOpen(false)}
                        onUpdated={updates => setChannels(prev => prev.map(c => (
                            c.id === settingsChannelId ? { ...c, ...updates } : c
                        )))}
                    />
                );
            })()}
```

This condition now correctly excludes DMs from ever opening the modal (a DM's `settingsChannelId` would not be found in `channels`, so `settingsChannel` is `undefined` and the block renders `null`) — the old `activeChannelKind === "channel"` guard is subsumed by that lookup.

- [ ] **Step 4: Remove the now-dead `TabBar` function**

`TabBar` (currently `AppShell.tsx:1536-1579`) is no longer called anywhere — `PaneChrome`'s State 1 mode replaced it in Step 1. Delete the entire `TabBar` function definition and its section comment (`/* ── Tab bar ─────────────────────────────── */`).

- [ ] **Step 5: Type-check, lint, and build**

Run:
```bash
cd grove_client && npx tsc -b && npx eslint . && npm run build
```
Expected: no errors. If `tsc` flags an unused `PaneKind`/`SplitDirection` import or similar, check whether that type is actually referenced in the file you're editing (some imports in Task 13's Step 1 are only used inside callback bodies added across both tasks) — do not add an `eslint-disable` comment; the fix is always either using the import or removing it.

- [ ] **Step 6: Manual browser verification**

Run: `cd grove_client && npm run dev`, then in the browser:
1. Log in, open a channel — confirm it renders exactly as before (State 1, now inside the floating `pane-chrome-state1` box instead of the old two-row header+tabbar).
2. Open a second and third tab — confirm they still appear as inline items in the floating box and Ctrl+Tab/Ctrl+W/Ctrl+1-3 still work exactly as before.
3. Press `Ctrl+Shift+Enter` — confirm a second pane appears side-by-side with the first, chrome collapses to the State 2 pill on the left, and the new pane shows "Press Ctrl K to fill this pane."
4. Press `Ctrl+K`, pick a different channel — confirm it fills the focused (new) pane, not the first one.
5. Hover the State 2 pill — confirm every pane dims slightly and shows its own number + label centered in place (not a tooltip next to the pill).
6. Press `Ctrl+Shift+[` — confirm panes now show header strips with accent/icon/name (State 3), and the pill has shrunk to a small circle.
7. Press `Ctrl+Shift+]` — confirm it returns to the numbered pill (State 2).
8. Press `Ctrl+W` while hovering a pane — confirm that pane closes; closing down to 1 pane confirms the chrome automatically returns to the full State 1 floating box.
9. Press `Ctrl+Shift+Space` — confirm the command island grows open from center with 7 icons; arrow keys move focus; Enter on "channels" opens the palette in browse mode; Escape closes the island back to whatever chrome state was active.
10. Click the "ⓘ Details" icon on a pane header (State 3) — confirm a Details pane opens beside it showing Shared Links (if the channel has any URLs in its loaded history) or the empty state, plus the honest Files/Photos empty states.
11. With only a single conversation open (no split ever created), click the new "ⓘ" icon in `ChatView`'s own header — confirm a Details pane tiles in beside it (both panes show headers, since they map to `"state3"`-style rendering per Step 1's note) **while the chrome stays the full State 1 floating box** — it must not collapse to the State 2 pill, since Details alone should never trigger a chrome-state transition.
12. Confirm total pane count never exceeds 4 (the 5th split attempt is a silent no-op).

- [ ] **Step 7: Commit**

```bash
git add grove_client/src/components/AppShell.tsx
git commit -m "feat: wire pane chrome, grid, and command island into AppShell"
```

---

### Task 15: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `cd grove_client && npm run test`
Expected: all `paneLayout.test.ts` tests pass (Tasks 2–7's suite, ~20+ assertions).

- [ ] **Step 2: Run the full type-check, lint, and build**

Run: `cd grove_client && npx tsc -b && npx eslint . && npm run build`
Expected: no errors, no warnings introduced by this plan's files.

- [ ] **Step 3: Re-run the Task 14 Step 6 manual browser checklist once more, end to end, in one sitting**

This catches interaction bugs between steps that isolated testing per-task can miss (e.g., opening the command island while a Details pane is open, or closing panes down to 1 while the palette is also open).

- [ ] **Step 4: Confirm no dead code remains**

Run:
```bash
grep -n "TabBar" grove_client/src/components/AppShell.tsx
```
Expected: no matches (confirms Task 14 Step 4's removal was complete — no stray references left behind).

- [ ] **Step 5: Commit (only if Steps 1-4 turned up fixes)**

If everything already passed, there is nothing to commit — this task is a gate, not guaranteed to produce a diff. If a fix was needed:

```bash
git add -A
git commit -m "fix: address issues found in final Plan A verification pass"
```
