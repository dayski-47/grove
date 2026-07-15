# Grove Chat-Core Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Grove's chat message rendering into a left/right (incoming/outgoing) layout with no message bubbles, chip-styled hover actions, and hover-revealed per-message timestamps — while extracting `MessageList.tsx`'s 460-line monolithic `MsgRow` into focused, side-agnostic pieces.

**Architecture:** `MessageList.tsx` keeps ownership of pagination, scroll preservation, and burst-grouping (unchanged). It delegates single-row rendering to two new thin layout components, `IncomingRow` and `OutgoingRow`, which both wrap a shared `MessageBody` (text/edit/reactions — side-agnostic) and a shared `MessageActions` (edit/delete/pin chip bar). All four new files live under `grove_client/src/components/MessageRow/`, alongside a `shared.tsx` holding the formatting/markdown utilities both rows need.

**Tech Stack:** React 19 + TypeScript (Vite), no new dependencies. Styling via existing `darkwood.css` custom properties only — no new colors/tokens, no CSS-in-JS, no component library.

## Global Constraints

- No new colors or CSS custom properties — every rule uses existing tokens from `darkwood.css` (`--leaf`, `--leaf-bright`, `--surface-0/1/2/3`, `--text-*`, `--r-*`, `--sp-*`, `--dur-fast`, `--ease-out`).
- No message bubbles (no background pill/rounded container behind message text), per explicit user direction.
- No reactbits components and no entrance/stagger animation — deferred to a later pass (its MCP tools were unreachable when this plan was written).
- No changes to `AppShell.tsx` or `NavRail.tsx` — nav rail/chip rollout is a separate future pass.
- No read receipts, no link-preview cards — explicitly deferred, tracked in `GROVE_HANDOFF.md`.
- `grove_client` has **no test framework** (`package.json` has no `test` script, no vitest/jest/testing-library dependency). Per the approved design spec, verification for this plan is: `npx tsc -b --pretty false` (must be clean), `npx eslint <changed files>` (must introduce zero *new* errors — 8 pre-existing errors in `AppShell.tsx`/`MessageList.tsx`, documented separately, are baseline and out of scope), and a manual check in the running dev app (`npm run dev`) per the checklist in Task 5. Do not add a test framework as a side effect of this plan — that's a separate decision the user hasn't made.
- Commits: no Claude attribution in commit messages (project convention). Every commit in this plan must be preceded by a clean `tsc -b` and `eslint` run on the changed files.
- Branch: all work happens on `feature/chat-core-redesign` (already checked out, based on `dev`). Do not merge or push without being asked.

---

### Task 1: Extract shared formatting/markdown utilities

Pure refactor — moves code that four upcoming components will need out of `MessageList.tsx` into a new shared module, with zero behavior change. `MsgRow` stays in `MessageList.tsx` for now (still working, just importing from the new location) so this task is independently verifiable before any layout change happens.

**Files:**
- Create: `grove_client/src/components/MessageRow/shared.tsx`
- Modify: `grove_client/src/components/MessageList.tsx`

**Interfaces:**
- Produces (from `shared.tsx`, consumed by Tasks 2–4): `avatarBg(uid: number): string`, `initial(name: string): string`, `formatTime(ts: number): string`, `parseMarkdown(text: string, myUsername: string): ReactNode[]`, `QUICK_EMOJIS: string[]`, `type ReactionInfo = { count: number; byMe: boolean }`, `type ReactionsMap = Record<number, Record<string, ReactionInfo>>`, `interface MessageRowProps` (the full prop shape `MsgRow` currently takes, minus `isOwn` — `IncomingRow`/`OutgoingRow` in Task 4 each know their own side and won't need it as a prop).

- [ ] **Step 1: Create `grove_client/src/components/MessageRow/shared.tsx`**

```tsx
import type { ReactNode } from "react";
import type { DisplayMessage } from "../MessageList";

export type ReactionInfo = { count: number; byMe: boolean };
export type ReactionsMap = Record<number, Record<string, ReactionInfo>>;

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

const AVATAR_COLORS = [
    "#1a5e2a", "#1a4a7d", "#5e1a5e", "#7d3a1a",
    "#1a6e6e", "#6e1a2a", "#2a4a7d", "#2a6e3a",
];

export function avatarBg(uid: number): string {
    return AVATAR_COLORS[uid % AVATAR_COLORS.length];
}

export function initial(name: string): string {
    return name.slice(0, 1).toUpperCase();
}

export function formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Inline markdown parser ──────────────────────────────── */

type Check = { regex: RegExp; type: string };

const CHECKS: Check[] = [
    { regex: /\*\*(.+?)\*\*/s, type: "bold"    },
    { regex: /~~(.+?)~~/s,     type: "strike"  },
    { regex: /\*(.+?)\*/s,     type: "italic"  },
    { regex: /`([^`\n]+)`/,   type: "code"    },
    { regex: /@(\w+)/,         type: "mention" },
    { regex: /\n/,             type: "newline" },
];

export function parseMarkdown(text: string, myUsername: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        let earliest: { index: number; type: string; match: RegExpExecArray } | null = null;

        for (const { regex, type } of CHECKS) {
            const m = regex.exec(remaining);
            if (!m || m.index === undefined) continue;
            if (!earliest || m.index < earliest.index) {
                earliest = { index: m.index, type, match: m };
            }
        }

        if (!earliest) { nodes.push(remaining); break; }

        if (earliest.index > 0) nodes.push(remaining.slice(0, earliest.index));

        const { type, match } = earliest;
        if (type === "bold")    nodes.push(<strong key={key++}>{match[1]}</strong>);
        else if (type === "strike")  nodes.push(<del key={key++}>{match[1]}</del>);
        else if (type === "italic")  nodes.push(<em key={key++}>{match[1]}</em>);
        else if (type === "code")    nodes.push(<code key={key++} className="dw-code-inline">{match[1]}</code>);
        else if (type === "mention") {
            const name = match[1];
            const isMe = name.toLowerCase() === myUsername.toLowerCase();
            nodes.push(<span key={key++} className={`dw-mention${isMe ? " me" : ""}`}>{match[0]}</span>);
        }
        else if (type === "newline") nodes.push(<br key={key++} />);

        remaining = remaining.slice(earliest.index + match[0].length);
    }

    return nodes;
}

/* ── Shared row props ────────────────────────────────────── */

export interface MessageRowProps {
    m:            DisplayMessage;
    name:         string;
    myUsername:   string;
    isCont:       boolean;
    isPinned:     boolean;
    reactions:    Record<string, ReactionInfo> | undefined;
    editingId:    number | null;
    editText:     string;
    onEditChange: (t: string) => void;
    onEditSubmit: () => void;
    onEditCancel: () => void;
    onStartEdit:  (id: number, text: string) => void;
    onDelete:     (id: number) => void;
    onReact:      (id: number, emoji: string) => void;
    onPin:        (id: number) => void;
    onUnpin:      (id: number) => void;
    onUserClick:  (event: React.MouseEvent) => void;
}
```

- [ ] **Step 2: Update `MessageList.tsx` to import from `shared.tsx` instead of defining locally**

In `grove_client/src/components/MessageList.tsx`, replace the top of the file (imports through the end of the `parseMarkdown` function, i.e. everything from the `import` block down through the closing `}` of `parseMarkdown`, roughly current lines 1–116) with:

```tsx
import {
    forwardRef,
    Fragment,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from "react";
import {
    avatarBg, formatTime, initial, parseMarkdown,
    QUICK_EMOJIS, type ReactionInfo, type ReactionsMap,
} from "./MessageRow/shared";

export interface DisplayMessage {
    id?:       number;
    userId:    number;
    text:      string;
    timestamp: number;
    edited?:   boolean;
    deleted?:  boolean;
}

export interface MessageListHandle {
    startEdit: (id: number, text: string) => void;
}

function formatDay(ts: number): string {
    const d         = new Date(ts * 1000);
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString())     return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function isContinuation(prev: DisplayMessage, curr: DisplayMessage): boolean {
    return prev.userId === curr.userId && curr.timestamp - prev.timestamp < 300;
}

function sameDay(a: DisplayMessage, b: DisplayMessage): boolean {
    return (
        new Date(a.timestamp * 1000).toDateString() ===
        new Date(b.timestamp * 1000).toDateString()
    );
}
```

This removes the now-duplicated `avatarBg`, `initial`, `formatTime`, `parseMarkdown`, `QUICK_EMOJIS`, `AVATAR_COLORS`, `ReactionInfo`, `ReactionsMap`, and the `Check`/`CHECKS` markdown-parser internals from `MessageList.tsx` (they now live only in `shared.tsx`), and adds the import. `MsgRow` (further down the file) is untouched in this step — it still compiles because the imported names are identical to what it used before. `type ReactNode` is no longer used at file scope by this block, but `MsgRow` still needs `KeyboardEvent` — keep that import.

- [ ] **Step 3: Type-check and lint**

Run: `cd grove_client && npx tsc -b --pretty false`
Expected: no output (clean).

Run: `npx eslint src/components/MessageList.tsx`
Expected: same errors as the pre-existing baseline only (the `_e` unused var and ref-during-render errors already documented as out of scope) — no new errors.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open the app, open any channel with messages. Confirm messages render identically to before (no visual change expected — this step only moved code, `MsgRow` still renders the same way).

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/shared.tsx grove_client/src/components/MessageList.tsx
git commit -m "refactor: extract message formatting utils to MessageRow/shared.tsx

Pure extraction, no behavior change — moves avatarBg/initial/formatTime/
parseMarkdown/QUICK_EMOJIS/ReactionInfo/ReactionsMap/MessageRowProps out
of MessageList.tsx so the upcoming row-split components can share them."
```

---

### Task 2: Extract `MessageActions.tsx` and apply chip styling

Pulls the floating edit/delete/pin hover bar out of `MsgRow` into its own component with a `side` prop (`"left" | "right"`) so it can be positioned correctly once rows split by sender in Task 4. Also applies the chip-button visual treatment (the user's "yes, adopt chips" answer) to this action bar and to `MessageInput`'s send button.

**Files:**
- Create: `grove_client/src/components/MessageRow/MessageActions.tsx`
- Modify: `grove_client/src/components/MessageList.tsx` (wire `MsgRow` to use it — same visual position as today, `side="right"` always, since rows don't split until Task 4)
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Produces: `MessageActions({ isOwn, isPinned, side, onEdit, onDelete, onPin, onUnpin }: { isOwn: boolean; isPinned: boolean; side: "left" | "right"; onEdit: () => void; onDelete: () => void; onPin: () => void; onUnpin: () => void }): JSX.Element`
- Consumes: nothing new from Task 1.

- [ ] **Step 1: Create `grove_client/src/components/MessageRow/MessageActions.tsx`**

```tsx
interface MessageActionsProps {
    isOwn:    boolean;
    isPinned: boolean;
    side:     "left" | "right";
    onEdit:   () => void;
    onDelete: () => void;
    onPin:    () => void;
    onUnpin:  () => void;
}

export function MessageActions({ isOwn, isPinned, side, onEdit, onDelete, onPin, onUnpin }: MessageActionsProps) {
    return (
        <div className={`dw-msg-actions ${side}`} aria-label="Message actions">
            {isOwn && (
                <>
                    <button className="dw-msg-action" title="Edit" onClick={onEdit} aria-label="Edit message">
                        <EditIcon />
                    </button>
                    <button
                        className="dw-msg-action danger"
                        title="Delete"
                        onClick={() => { if (window.confirm("Delete this message?")) onDelete(); }}
                        aria-label="Delete message"
                    >
                        <TrashIcon />
                    </button>
                </>
            )}
            <button
                className={`dw-msg-action${isPinned ? " active" : ""}`}
                title={isPinned ? "Unpin" : "Pin"}
                onClick={isPinned ? onUnpin : onPin}
                aria-label={isPinned ? "Unpin message" : "Pin message"}
            >
                <PinIcon />
            </button>
        </div>
    );
}

function EditIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
    );
}

function PinIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/>
        </svg>
    );
}
```

- [ ] **Step 2: Wire it into `MsgRow` in `MessageList.tsx`**

In `MessageList.tsx`, add the import:

```tsx
import { MessageActions } from "./MessageRow/MessageActions";
```

Replace the entire `<div className="dw-msg-actions" ...>...</div>` block at the end of `MsgRow`'s JSX (the block starting `{m.id !== undefined && !m.deleted && !isEditing && (` that renders edit/delete/pin buttons) with:

```tsx
{m.id !== undefined && !m.deleted && !isEditing && (
    <MessageActions
        isOwn={isOwn}
        isPinned={isPinned}
        side="right"
        onEdit={() => onStartEdit(m.id!, m.text)}
        onDelete={() => onDelete(m.id!)}
        onPin={() => onPin(m.id!)}
        onUnpin={() => onUnpin(m.id!)}
    />
)}
```

Delete the now-unused `EditIcon`, `TrashIcon`, `PinIcon` function definitions at the bottom of `MessageList.tsx` (they moved into `MessageActions.tsx`).

- [ ] **Step 3: Update `darkwood.css` — chip styling + side-aware positioning**

Find this block (around line 970):

```css
/* Message action bar (hover) */
.dw-msg-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  position: absolute;
  right: var(--sp-4);
  top: 50%;
  transform: translateY(-50%);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 2px;
  transition: opacity var(--dur-fast);
  z-index: 2;
}

.dw-msg-row:hover .dw-msg-actions { opacity: 1; }

.dw-msg-action {
  width: 28px;
  height: 28px;
  border-radius: var(--r-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color var(--dur-fast), background var(--dur-fast);
}
```

Replace with:

```css
/* Message action bar (hover) */
.dw-msg-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  position: absolute;
  top: 50%;
  transform: translateY(-50%) scale(0.94);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 2px;
  transition: opacity var(--dur-fast), transform var(--dur-fast);
  z-index: 2;
}

.dw-msg-actions.right { right: var(--sp-4); }
.dw-msg-actions.left  { left: var(--sp-4); }

.dw-msg-row:hover .dw-msg-actions { opacity: 1; transform: translateY(-50%) scale(1); }

.dw-msg-action {
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color var(--dur-fast), background var(--dur-fast);
}
```

(The `right: var(--sp-4);` positioning moved out of the base rule and into the new `.right` modifier class; `.dw-msg-action`'s radius changed from `var(--r-xs)` to `var(--r-sm)` for the chip look. Everything else in that section — `.dw-msg-action:hover`, `.dw-msg-action.danger:hover`, `.dw-msg-action.active` — is unchanged, leave as-is.)

- [ ] **Step 4: Chip-polish the `MessageInput` send button**

Find this block in `darkwood.css` (around line 1199):

```css
.dw-send-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--leaf);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: background var(--dur-fast), opacity var(--dur-fast);
  border: none;
}

.dw-send-btn.show { opacity: 1; pointer-events: all; }
.dw-send-btn:hover { background: var(--leaf-bright); }
```

Replace with:

```css
.dw-send-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--leaf);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: background var(--dur-fast), opacity var(--dur-fast), transform var(--dur-fast);
  border: none;
}

.dw-send-btn.show { opacity: 1; pointer-events: all; }
.dw-send-btn:hover { background: var(--leaf-bright); transform: scale(1.05); }
```

- [ ] **Step 5: Type-check and lint**

Run: `cd grove_client && npx tsc -b --pretty false`
Expected: clean.

Run: `npx eslint src/components/MessageList.tsx src/components/MessageRow/MessageActions.tsx`
Expected: no new errors vs. baseline.

- [ ] **Step 6: Manual smoke check**

`npm run dev` → open a channel → hover a message → confirm the edit/delete/pin chip bar still appears at the right edge, still functions (edit, delete with confirm, pin/unpin toggle). Confirm the chips now have slightly more rounded corners and a subtle scale-in on hover. Confirm the send button in the input box scales up slightly on hover once text is typed.

- [ ] **Step 7: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/MessageActions.tsx grove_client/src/components/MessageList.tsx grove_client/src/styles/darkwood.css
git commit -m "refactor: extract MessageActions chip bar, apply chip styling

Pulls the edit/delete/pin hover bar into its own component with a side
prop (left/right) so it can be repositioned once rows split by sender.
Bumps action-button radius to r-sm and adds a hover scale-in; matches
send button with the same hover-scale treatment. No layout change yet —
side is hardcoded to 'right' until Task 4."
```

---

### Task 3: Extract `MessageBody.tsx`

Pulls the side-agnostic content (message text/edit-mode swap, edited tag, reactions, quick-emoji picker) out of `MsgRow` into its own component. Still no layout change — `MsgRow` renders identically, just via composition.

**Files:**
- Create: `grove_client/src/components/MessageRow/MessageBody.tsx`
- Modify: `grove_client/src/components/MessageList.tsx`

**Interfaces:**
- Produces: `MessageBody({ m, myUsername, isEditing, editText, onEditChange, onEditSubmit, onEditCancel, reactions, onReact }): JSX.Element`
- Consumes: `parseMarkdown`, `QUICK_EMOJIS`, `ReactionInfo` from `./shared` (Task 1); `DisplayMessage` type from `../MessageList`.

- [ ] **Step 1: Create `grove_client/src/components/MessageRow/MessageBody.tsx`**

```tsx
import type { KeyboardEvent } from "react";
import { parseMarkdown, QUICK_EMOJIS, type ReactionInfo } from "./shared";
import type { DisplayMessage } from "../MessageList";

interface MessageBodyProps {
    m:            DisplayMessage;
    myUsername:   string;
    isEditing:    boolean;
    editText:     string;
    onEditChange: (t: string) => void;
    onEditSubmit: () => void;
    onEditCancel: () => void;
    reactions:    Record<string, ReactionInfo> | undefined;
    onReact:      (id: number, emoji: string) => void;
}

export function MessageBody({
    m, myUsername, isEditing, editText,
    onEditChange, onEditSubmit, onEditCancel,
    reactions, onReact,
}: MessageBodyProps) {
    const msgReactions = reactions ? Object.entries(reactions) : [];

    function handleEditKey(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter")  { e.preventDefault(); onEditSubmit(); }
        if (e.key === "Escape") onEditCancel();
    }

    return (
        <>
            <div>
                {m.deleted ? (
                    <span className="dw-msg-deleted">message deleted</span>
                ) : isEditing ? (
                    <div className="dw-edit-wrap">
                        <input
                            className="dw-edit-input"
                            value={editText}
                            onChange={e => onEditChange(e.target.value)}
                            onKeyDown={handleEditKey}
                            autoFocus
                            aria-label="Edit message"
                        />
                        <span className="dw-edit-hint">Enter to save · Esc to cancel</span>
                    </div>
                ) : (
                    <span className="dw-msg-text">
                        {parseMarkdown(m.text, myUsername)}
                    </span>
                )}
                {m.edited && !m.deleted && !isEditing && (
                    <span className="dw-msg-edited-tag">(edited)</span>
                )}
            </div>

            {msgReactions.length > 0 && (
                <div className="dw-reactions" aria-label="Reactions">
                    {msgReactions.map(([emoji, info]) => (
                        <button
                            key={emoji}
                            className={`dw-reaction${info.byMe ? " mine" : ""}`}
                            onClick={() => m.id !== undefined && onReact(m.id, emoji)}
                            title={info.byMe ? `You reacted ${emoji}` : `React with ${emoji}`}
                        >
                            {emoji}
                            <span className="dw-reaction-count">{info.count}</span>
                        </button>
                    ))}
                </div>
            )}

            {m.id !== undefined && !m.deleted && !isEditing && (
                <div className="dw-emoji-pick" aria-label="Quick react">
                    {QUICK_EMOJIS.map(e => (
                        <button key={e} className="dw-emoji-btn" title={`React ${e}`} onClick={() => onReact(m.id!, e)}>
                            {e}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
```

- [ ] **Step 2: Wire it into `MsgRow` in `MessageList.tsx`**

Add the import:

```tsx
import { MessageBody } from "./MessageRow/MessageBody";
```

Inside `MsgRow`'s JSX, replace everything between the `.dw-msg-meta` block and the `<MessageActions .../>` call (i.e. the `<div>...text/edit/edited-tag...</div>`, the `.dw-reactions` block, and the `.dw-emoji-pick` block) with:

```tsx
<MessageBody
    m={m} myUsername={myUsername} isEditing={isEditing} editText={editText}
    onEditChange={onEditChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel}
    reactions={reactions} onReact={onReact}
/>
```

`MsgRow` no longer needs `parseMarkdown` or `QUICK_EMOJIS` directly — remove those two names from its import of `./MessageRow/shared` if `MsgRow` (or anything else still in `MessageList.tsx`) doesn't otherwise reference them. `msgReactions` local variable inside `MsgRow` is also now dead — remove it (it moved into `MessageBody`).

- [ ] **Step 3: Type-check and lint**

Run: `cd grove_client && npx tsc -b --pretty false`
Expected: clean.

Run: `npx eslint src/components/MessageList.tsx src/components/MessageRow/MessageBody.tsx`
Expected: no new errors vs. baseline.

- [ ] **Step 4: Manual smoke check**

`npm run dev` → open a channel → verify: message text renders with markdown (bold/italic/code/mentions), editing a message swaps to the input field and Enter/Escape still work, reactions display and quick-emoji picker still adds a reaction on click, deleted messages show "message deleted".

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/MessageBody.tsx grove_client/src/components/MessageList.tsx
git commit -m "refactor: extract MessageBody (text/edit/reactions/quick-react)

Side-agnostic message content pulled out of MsgRow into its own
component. No behavior or layout change — same DOM output, now
composed instead of inlined."
```

---

### Task 4: Split into `IncomingRow`/`OutgoingRow`, apply the split-lane layout

The core visual change. Replaces `MsgRow` with two side-specific wrappers and updates `darkwood.css` so outgoing bursts render mirrored on the right with no username label, while incoming bursts keep today's left-aligned layout with the username header.

**Files:**
- Create: `grove_client/src/components/MessageRow/IncomingRow.tsx`
- Create: `grove_client/src/components/MessageRow/OutgoingRow.tsx`
- Modify: `grove_client/src/components/MessageList.tsx` (remove `MsgRow`/`MsgRowProps` entirely, render `IncomingRow`/`OutgoingRow` conditionally)
- Modify: `grove_client/src/styles/darkwood.css`

**Interfaces:**
- Consumes: `MessageRowProps` from `./shared` (Task 1), `MessageBody` (Task 3), `MessageActions` (Task 2).
- Produces: `IncomingRow(props: MessageRowProps): JSX.Element`, `OutgoingRow(props: MessageRowProps): JSX.Element` — both take the exact same prop shape (no `isOwn` needed; each component is inherently one side).

- [ ] **Step 1: Create `grove_client/src/components/MessageRow/IncomingRow.tsx`**

```tsx
import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function IncomingRow({
    m, name, myUsername, isCont, isPinned, reactions,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    const rowClass    = ["dw-msg-row", isCont ? "cont" : ""].filter(Boolean).join(" ");
    const showActions = m.id !== undefined && !m.deleted && !isEditing;

    return (
        <div className={rowClass}>
            {isCont ? (
                <div className="dw-cont-space" aria-hidden="true">
                    <span className="dw-cont-time">{formatTime(m.timestamp)}</span>
                </div>
            ) : (
                <button
                    className="dw-msg-avatar"
                    style={{ background: avatarBg(m.userId) }}
                    onClick={onUserClick}
                    aria-label={`View ${name}'s profile`}
                >
                    {initial(name)}
                </button>
            )}

            <div className="dw-msg-body">
                {!isCont && (
                    <div className="dw-msg-meta">
                        <button className="dw-msg-author" onClick={onUserClick} aria-label={`View ${name}'s profile`}>
                            {name}
                        </button>
                        <span className="dw-msg-time">{formatTime(m.timestamp)}</span>
                    </div>
                )}

                <MessageBody
                    m={m} myUsername={myUsername} isEditing={isEditing} editText={editText}
                    onEditChange={onEditChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel}
                    reactions={reactions} onReact={onReact}
                />
            </div>

            {showActions && (
                <MessageActions
                    isOwn={false} isPinned={isPinned} side="right"
                    onEdit={() => onStartEdit(m.id!, m.text)}
                    onDelete={() => onDelete(m.id!)}
                    onPin={() => onPin(m.id!)}
                    onUnpin={() => onUnpin(m.id!)}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 2: Create `grove_client/src/components/MessageRow/OutgoingRow.tsx`**

```tsx
import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function OutgoingRow({
    m, name, myUsername, isCont, isPinned, reactions,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    const rowClass    = ["dw-msg-row", "own", isCont ? "cont" : ""].filter(Boolean).join(" ");
    const showActions = m.id !== undefined && !m.deleted && !isEditing;

    return (
        <div className={rowClass}>
            {isCont ? (
                <div className="dw-cont-space" aria-hidden="true">
                    <span className="dw-cont-time">{formatTime(m.timestamp)}</span>
                </div>
            ) : (
                <button
                    className="dw-msg-avatar"
                    style={{ background: avatarBg(m.userId) }}
                    onClick={onUserClick}
                    aria-label={`View ${name}'s profile`}
                >
                    {initial(name)}
                </button>
            )}

            <div className="dw-msg-body">
                {!isCont && (
                    <div className="dw-msg-meta">
                        <span className="dw-msg-time">{formatTime(m.timestamp)}</span>
                    </div>
                )}

                <MessageBody
                    m={m} myUsername={myUsername} isEditing={isEditing} editText={editText}
                    onEditChange={onEditChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel}
                    reactions={reactions} onReact={onReact}
                />
            </div>

            {showActions && (
                <MessageActions
                    isOwn={true} isPinned={isPinned} side="left"
                    onEdit={() => onStartEdit(m.id!, m.text)}
                    onDelete={() => onDelete(m.id!)}
                    onPin={() => onPin(m.id!)}
                    onUnpin={() => onUnpin(m.id!)}
                />
            )}
        </div>
    );
}
```

Note: `OutgoingRow` intentionally does not render `.dw-msg-author` — per the approved design spec, outgoing bursts drop the username label since it's redundant on the self column. `name` is still used for the avatar's `aria-label`.

- [ ] **Step 3: Replace `MsgRow` usage in `MessageList.tsx`**

Delete the entire `MsgRow` function and `MsgRowProps` interface from `MessageList.tsx` (everything between the `/* ── Message row ─────... */` comment and the `/* ── MessageList ─────... */` comment).

Add imports:

```tsx
import { IncomingRow } from "./MessageRow/IncomingRow";
import { OutgoingRow } from "./MessageRow/OutgoingRow";
```

Remove the now-unused `avatarBg`, `initial`, `formatTime` names from the `./MessageRow/shared` import in `MessageList.tsx` if nothing else in the file uses them (they're only consumed by `IncomingRow`/`OutgoingRow` now). Keep `type ReactionsMap` (still used in the component's prop types).

In the `.map()` callback, replace:

```tsx
                return (
                    <Fragment key={key}>
                        {newDay && (
                            <div className="dw-day-divider" role="separator">
                                <span className="dw-day-label">{formatDay(m.timestamp)}</span>
                            </div>
                        )}
                        <MsgRow
                            m={m} isOwn={isOwn} name={name} myUsername={myUsername}
                            isCont={cont} isPinned={pinned} reactions={msgRx}
                            editingId={editingId} editText={editText}
                            onEditChange={setEditText}
                            onEditSubmit={submitEdit}
                            onEditCancel={cancelEdit}
                            onStartEdit={startEdit}
                            onDelete={id => onDelete?.(id)}
                            onReact={(id, emoji) => onReact?.(id, emoji)}
                            onPin={id => onPin?.(id)}
                            onUnpin={id => onUnpin?.(id)}
                            onUserClick={e => onUserHover?.(m.userId, e)}
                        />
                    </Fragment>
                );
```

with:

```tsx
                const rowProps = {
                    m, name, myUsername,
                    isCont: cont, isPinned: pinned, reactions: msgRx,
                    editingId, editText,
                    onEditChange: setEditText,
                    onEditSubmit: submitEdit,
                    onEditCancel: cancelEdit,
                    onStartEdit: startEdit,
                    onDelete: (id: number) => onDelete?.(id),
                    onReact: (id: number, emoji: string) => onReact?.(id, emoji),
                    onPin: (id: number) => onPin?.(id),
                    onUnpin: (id: number) => onUnpin?.(id),
                    onUserClick: (e: React.MouseEvent) => onUserHover?.(m.userId, e),
                };

                return (
                    <Fragment key={key}>
                        {newDay && (
                            <div className="dw-day-divider" role="separator">
                                <span className="dw-day-label">{formatDay(m.timestamp)}</span>
                            </div>
                        )}
                        {isOwn ? <OutgoingRow {...rowProps} /> : <IncomingRow {...rowProps} />}
                    </Fragment>
                );
```

- [ ] **Step 4: Update `darkwood.css` for the split-lane layout**

Find (around line 734):

```css
.dw-msg-row:hover { background: rgba(255,255,255,0.015); }
.dw-msg-row.own   { background: rgba(106,184,112,0.018); }
.dw-msg-row.own:hover { background: rgba(106,184,112,0.03); }
```

Replace with:

```css
.dw-msg-row:hover { background: rgba(255,255,255,0.015); }
.dw-msg-row.own   { background: rgba(106,184,112,0.018); flex-direction: row-reverse; }
.dw-msg-row.own:hover { background: rgba(106,184,112,0.03); }
```

Find (around line 795):

```css
.dw-msg-body { flex: 1; min-width: 0; }

.dw-msg-meta {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin-bottom: 2px;
}
```

Replace with:

```css
.dw-msg-body { flex: 1; min-width: 0; max-width: 70%; }

.dw-msg-meta {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin-bottom: 2px;
}

.dw-msg-row.own .dw-msg-meta { justify-content: flex-end; }
```

Find (around line 793, right after the `.dw-cont-time` block):

```css
.dw-msg-row:hover .dw-cont-time { opacity: 1; }
```

Replace with:

```css
.dw-msg-row:hover .dw-cont-time { opacity: 1; }
.dw-msg-row.own .dw-cont-space { justify-content: flex-start; }
```

Find (around line 814):

```css
.dw-msg-author:hover { color: var(--leaf-bright); }
.dw-msg-author.own   { color: var(--leaf); }
```

Replace with:

```css
.dw-msg-author:hover { color: var(--leaf-bright); }
```

(`.dw-msg-author.own` is now dead — `OutgoingRow` never renders `.dw-msg-author`, so the modifier class is removed to avoid stale CSS.)

- [ ] **Step 5: Type-check and lint**

Run: `cd grove_client && npx tsc -b --pretty false`
Expected: clean.

Run: `npx eslint src/components/MessageList.tsx src/components/MessageRow/IncomingRow.tsx src/components/MessageRow/OutgoingRow.tsx`
Expected: no new errors vs. baseline.

- [ ] **Step 6: Manual verification (this is the primary test for this task — no unit tests exist for this codebase)**

Run `npm run dev`, open a channel with existing message history (or send new messages from two different accounts / browser tabs), and verify each of the following:

1. Incoming messages (not yours): avatar on the left, username + timestamp header, text left-aligned, capped around 70% width, gutter visible on the right.
2. Outgoing messages (yours): avatar on the right, **no username** (just a right-aligned timestamp header), text block right-positioned, capped around 70% width, gutter visible on the left.
3. Multi-message burst from the same sender (send 3+ messages quickly): avatar/header show once at the top of the burst; subsequent messages in the burst show the spacer instead of a repeated avatar.
4. Hover any message inside a burst (both incoming and outgoing): the small hover timestamp appears at the outer margin of that row (opposite the avatar side) and fades on mouse-out.
5. Mixed rapid back-and-forth conversation (alternating senders): confirm the left/right split stays legible and rows don't visually collide.
6. Narrow viewport (~375px) and wide viewport (~1600px): confirm the 70% max-width cap holds and the gutter is still visible at both sizes.
7. Hover a message: confirm the edit/delete/pin chip bar appears in the correct empty-gutter side (right gutter for incoming, left gutter for outgoing) and does not overlap the avatar.
8. Start editing one of your own messages (via the pencil icon or the existing "↑ re-edit" shortcut): confirm the edit textarea still renders correctly inside the right-anchored block.
9. React to a message with the quick-emoji picker on both an incoming and an outgoing message: confirm reactions render correctly on both sides.

If any of these fail, fix before moving to Step 7 — do not commit a partially-working layout.

- [ ] **Step 7: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/IncomingRow.tsx grove_client/src/components/MessageRow/OutgoingRow.tsx grove_client/src/components/MessageList.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: split-lane message layout (incoming left / outgoing right)

Replaces MsgRow with IncomingRow/OutgoingRow. Outgoing bursts mirror
via flex-direction: row-reverse and drop the username label; both
lanes cap at 70% width to keep a visible gutter. Hover-revealed
per-message timestamps (dw-cont-time) already existed for continuation
rows and now work symmetrically on both sides. No bubbles, no new
colors — mirrors the approved 2026-07-15 chat-core-redesign spec."
```

---

### Task 5: Final verification pass

No new code — confirms the whole branch is internally consistent after four incremental refactors, and gives the pre-existing-lint-baseline claim one last check.

**Files:** none created; verification only.

- [ ] **Step 1: Full type-check**

Run: `cd grove_client && npx tsc -b --pretty false`
Expected: clean, zero output.

- [ ] **Step 2: Full lint, compare against documented baseline**

Run: `npx eslint src/components/MessageList.tsx src/components/MessageRow/*.tsx`
Expected: exactly the pre-existing errors documented in the design-spec session (the `AppShell.tsx`-adjacent `_e` unused var and the `react-hooks/refs` errors around the `hasMoreRef`/`loadingRef`/`onLoadMoreRef` assignments in `MessageList.tsx`, which are unchanged by this plan) — zero *new* errors introduced by `MessageRow/*.tsx`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: exits 0, produces a `dist/` bundle with no errors.

- [ ] **Step 4: Re-run the full manual checklist from Task 4, Step 6**

Confirm all 9 checks still pass after the intervening lint/build fixes (if any were needed).

- [ ] **Step 5: Confirm branch state**

```bash
cd /home/richtofen/projects/grovefolder
git log --oneline feature/chat-core-redesign ^dev
git status
```

Expected: 5 commits ahead of `dev` (Tasks 1–4 plus this checkpoint if any fixup was needed), clean working tree. Do not merge into `dev` or push — that's a separate decision for the user to make once they've looked at the running app.
