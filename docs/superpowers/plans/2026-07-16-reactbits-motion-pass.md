# Reactbits-Driven Motion Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reactbits-inspired motion to Grove (Darkwood V3 Pass 3) — a decrypt-reveal text motif on brand/identity moments, a staggered entrance for genuinely new live messages, a reaction-count "pop," and a send-button spark — all ported to vanilla CSS/TypeScript with zero new npm dependencies.

**Architecture:** Two new small shared pieces (`src/hooks/useDecryptReveal.ts` + `src/components/motion/DecryptReveal.tsx`, and `src/components/motion/SendSpark.tsx`) plumbed into four existing call sites (`AppShell.tsx`, `LoginScreen.tsx`, `MessageList.tsx` + `MessageRow/*`, `MessageInput.tsx`), plus new keyframes/classes appended to `darkwood.css`. Chrome (toasts/palette/notif panel) is explicitly untouched per the design spec.

**Tech Stack:** React 19 + TypeScript, Vite, hand-rolled CSS (no framer-motion, no WebGL/canvas libraries beyond the plain 2D canvas context used for the send spark).

## Global Constraints

- Zero new npm dependencies — verify `grove_client/package.json` is unchanged at the end of this plan.
- Every new motion effect must respect `prefers-reduced-motion`. CSS `@keyframes`/`transition` are already covered for free by the existing global rule at the end of `darkwood.css` (`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`). Anything driven by JS (`setInterval`, `requestAnimationFrame`, imperative canvas draws) needs its own explicit `window.matchMedia("(prefers-reduced-motion: reduce)").matches` check — the CSS rule above does not touch JS timers.
- No test framework exists in `grove_client` (no vitest/jest/testing-library) — this was established in Pass 1 and confirmed still true. Every task below substitutes `tsc -b` + `eslint` + manual browser verification for the write-test/red/green cycle a codebase with a test framework would use. Docker rebuild (`docker compose -f docker-compose.prod.yml up --build`) is required to see changes in the running app — plain `npm run dev` hot reload is a separate dev-server path and is what "manual browser check" below refers to unless stated otherwise.
- Reference design spec: `docs/superpowers/specs/2026-07-16-reactbits-motion-pass-design.md`. Do not add anything to chrome (toasts/palette/notification panel) — Section 4 of that spec is a deliberate "no changes" decision, not an oversight.
- All new/modified CSS rules live in `grove_client/src/styles/darkwood.css` only (not the unused legacy `grove.css`).

---

### Task 0: Create the feature branch

**Files:** none (git operation only)

- [ ] **Step 1: Create and switch to the feature branch**

```bash
cd /home/richtofen/projects/grovefolder
git checkout dev
git pull --ff-only 2>/dev/null || true
git checkout -b feature/reactbits-motion-pass
```

Expected: `Switched to a new branch 'feature/reactbits-motion-pass'`

- [ ] **Step 2: Confirm clean starting state**

```bash
git status
```

Expected: `nothing to commit, working tree clean` (aside from any pre-existing untracked files noted at session start — do not touch those).

---

### Task 1: `useDecryptReveal` hook

**Files:**
- Create: `grove_client/src/hooks/useDecryptReveal.ts`

**Interfaces:**
- Produces: `useDecryptReveal(text: string, durationMs?: number): string` — a hook that returns the current display string, starting scrambled and resolving left-to-right to `text` over `durationMs` (default `500`). Returns `text` immediately and does nothing further if `prefers-reduced-motion: reduce` is set.

- [ ] **Step 1: Create the hooks directory and write the hook**

```bash
mkdir -p /home/richtofen/projects/grovefolder/grove_client/src/hooks
```

Create `grove_client/src/hooks/useDecryptReveal.ts`:

```typescript
import { useEffect, useState } from "react";

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*";

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomChar(): string {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function shuffle(text: string, revealedCount: number): string {
    return text
        .split("")
        .map((char, i) => (char === " " || i < revealedCount ? char : randomChar()))
        .join("");
}

/**
 * Reveals `text` left-to-right over `durationMs`, scrambling unrevealed
 * characters in the meantime. Ported from reactbits' DecryptedText,
 * simplified to a mount-only reveal (no hover/click/view-triggered modes)
 * and stripped of its framer-motion dependency — this is a plain
 * setInterval character-swap, framer-motion was never load-bearing there.
 */
export function useDecryptReveal(text: string, durationMs = 500): string {
    const [display, setDisplay] = useState(text);

    useEffect(() => {
        if (prefersReducedMotion() || text.length === 0) {
            setDisplay(text);
            return;
        }

        const tickMs = Math.max(16, Math.floor(durationMs / text.length));
        let revealed = 0;
        setDisplay(shuffle(text, 0));

        const id = setInterval(() => {
            revealed += 1;
            setDisplay(shuffle(text, revealed));
            if (revealed >= text.length) clearInterval(id);
        }, tickMs);

        return () => clearInterval(id);
    }, [text, durationMs]);

    return display;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npx tsc -b --noEmit 2>&1 | grep -i decryptreveal || echo "no errors in useDecryptReveal.ts"
```

Expected: `no errors in useDecryptReveal.ts`

- [ ] **Step 3: Lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npx eslint src/hooks/useDecryptReveal.ts
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/hooks/useDecryptReveal.ts
git commit -m "feat: add useDecryptReveal hook, ported from reactbits DecryptedText"
```

---

### Task 2: `DecryptReveal` wrapper component

**Files:**
- Create: `grove_client/src/components/motion/DecryptReveal.tsx`

**Interfaces:**
- Consumes: `useDecryptReveal(text, durationMs)` from Task 1.
- Produces: `<DecryptReveal text={string} durationMs?={number} className?={string} />` — renders an `aria-hidden` `<span>` with the scrambling/resolving display text. The **parent element** is responsible for carrying the real accessible name (via its own `aria-label` or text content), since this span is hidden from assistive tech to avoid announcing scramble noise.

- [ ] **Step 1: Create the motion directory and write the component**

```bash
mkdir -p /home/richtofen/projects/grovefolder/grove_client/src/components/motion
```

Create `grove_client/src/components/motion/DecryptReveal.tsx`:

```tsx
import { useDecryptReveal } from "../../hooks/useDecryptReveal";

interface DecryptRevealProps {
    text:        string;
    durationMs?: number;
    className?:  string;
}

/**
 * Visual-only scramble-to-reveal text. The parent element must supply the
 * real accessible name (aria-label or its own text) since this span is
 * aria-hidden — it exists purely as decoration over the parent's content.
 */
export function DecryptReveal({ text, durationMs, className }: DecryptRevealProps) {
    const display = useDecryptReveal(text, durationMs);
    return (
        <span className={className} aria-hidden="true">
            {display}
        </span>
    );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i decryptreveal || echo "no errors"
npx eslint src/components/motion/DecryptReveal.tsx
```

Expected: `no errors` and no lint output.

- [ ] **Step 3: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/motion/DecryptReveal.tsx
git commit -m "feat: add DecryptReveal wrapper component"
```

---

### Task 3: Wire decrypt-reveal into the empty state

**Files:**
- Modify: `grove_client/src/components/AppShell.tsx:18` (import), `:1024-1025` (`EmptyContent`)

**Interfaces:**
- Consumes: `DecryptReveal` from Task 2.

- [ ] **Step 1: Add the import**

In `grove_client/src/components/AppShell.tsx`, after the existing import at line 18 (`import type { ActivityStatus } from "./ProfileMenu";`), add:

```typescript
import { DecryptReveal } from "./motion/DecryptReveal";
```

- [ ] **Step 2: Apply it to the wordmark and tagline**

Find (around line 1024-1025):

```tsx
            <div className="gv-empty-brand" aria-label="Grove">grove</div>
            <p className="gv-empty-tagline">an enchanted place to gather</p>
```

Replace with:

```tsx
            <div className="gv-empty-brand" aria-label="Grove">
                <DecryptReveal text="grove" />
            </div>
            <p className="gv-empty-tagline" aria-label="an enchanted place to gather">
                <DecryptReveal text="an enchanted place to gather" durationMs={700} />
            </p>
```

(The tagline gets a longer `durationMs` since it's ~5x the character count of the wordmark — without this both would default to the same 500ms total, making the tagline's per-character reveal noticeably faster/choppier than the wordmark's.)

- [ ] **Step 3: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i appshell || echo "no errors"
npx eslint src/components/AppShell.tsx
```

Expected: `no errors` and no lint output.

- [ ] **Step 4: Manual browser check**

Rebuild and open the app (`docker compose -f docker-compose.prod.yml up --build`, or `npm run dev` for the dev server), log in, and land on a view with no channel open (the empty state). Confirm:
- The "grove" wordmark and tagline scramble-resolve into place on load.
- With OS-level "reduce motion" enabled, both render the final text immediately with no scramble frames.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/AppShell.tsx
git commit -m "feat: decrypt-reveal the empty-state wordmark and tagline"
```

---

### Task 4: Wire decrypt-reveal into the login screen

**Files:**
- Modify: `grove_client/src/components/LoginScreen.tsx:1` (import), `:159-162` (brand block)

**Interfaces:**
- Consumes: `DecryptReveal` from Task 2.

- [ ] **Step 1: Add the import**

In `grove_client/src/components/LoginScreen.tsx`, after the existing imports (after line 3, `import { saveSession } from "../auth";`), add:

```typescript
import { DecryptReveal } from "./motion/DecryptReveal";
```

- [ ] **Step 2: Apply it to the login wordmark**

Find (around line 159-162):

```tsx
                <div className="dw-login-brand">
                    <div className="dw-login-brand-name">grove</div>
                    <div className="dw-login-brand-rule" />
                </div>
```

Replace with:

```tsx
                <div className="dw-login-brand">
                    <div className="dw-login-brand-name" aria-label="grove">
                        <DecryptReveal text="grove" />
                    </div>
                    <div className="dw-login-brand-rule" />
                </div>
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i loginscreen || echo "no errors"
npx eslint src/components/LoginScreen.tsx
```

Expected: `no errors` and no lint output.

- [ ] **Step 4: Manual browser check**

Load the login screen (log out first if needed). Confirm the "grove" wordmark scramble-resolves on load, and that it does not replay or fight the existing `gv-enter-grove` zoom/fade transition that plays on successful login (that transition is on the whole `.dw-login` container and is untouched by this change — just confirm visually it still looks like one clean sequence, not two competing effects).

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/LoginScreen.tsx
git commit -m "feat: decrypt-reveal the login screen wordmark"
```

---

### Task 5: Message-entrance and reaction-pop flag plumbing in `MessageList.tsx`

**Files:**
- Modify: `grove_client/src/components/MessageList.tsx`

**Interfaces:**
- Produces: two new values computed per render — `justArrived: Map<string, number>` (message key → stagger index, only for genuinely new live-appended messages) and `liveUpdate: boolean` (true only on renders that are neither the first render nor a pagination/prepend). These are threaded into `rowProps` as `isNew: boolean`, `enterDelayMs: number`, and `animateReactions: boolean` for Task 6 and Task 7 to consume.

This task's rule in plain terms: a message only gets the "just arrived" treatment if (a) this isn't the component's very first render (i.e., not the initial history load for this channel) and (b) this update wasn't a "load more history" prepend (detected by the first message's key changing while the array grew — scrolling up loads older messages at the front). Reaction-pop reuses the exact same `liveUpdate` gate so pagination doesn't cause reaction chips to pop either.

- [ ] **Step 1: Add the `msgKey` helper and tracking refs**

In `grove_client/src/components/MessageList.tsx`, after the existing `sameDay` function (ends around line 47) and before the `/* ── MessageList ─────────────────────────────────────────── */` comment, add:

```typescript
function msgKey(m: DisplayMessage): string {
    return `${m.id ?? m.timestamp}-${m.userId}`;
}
```

Inside the `MessageList` component body, after the existing ref declarations (after line 96, `const prevScrollHRef = useRef(0);`), add:

```typescript
    const mountedRef       = useRef(false);
    const prevMessagesRef  = useRef<DisplayMessage[]>([]);
```

- [ ] **Step 2: Compute `justArrived` and `liveUpdate`**

Add the `useMemo` import to the existing React import at the top of the file (line 1-9) — change:

```typescript
import {
    forwardRef,
    Fragment,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
```

to:

```typescript
import {
    forwardRef,
    Fragment,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
```

Then, after the ref declarations added in Step 1, add:

```typescript
    const { justArrived, liveUpdate } = useMemo(() => {
        const prev = prevMessagesRef.current;
        const empty = { justArrived: new Map<string, number>(), liveUpdate: false };
        if (!mountedRef.current) return empty;

        const prevFirstKey = prev[0] ? msgKey(prev[0]) : undefined;
        const currFirstKey = messages[0] ? msgKey(messages[0]) : undefined;
        const wasPrepend = prev.length > 0 && messages.length > prev.length && prevFirstKey !== currFirstKey;
        if (wasPrepend) return empty;

        const prevKeys = new Set(prev.map(msgKey));
        const justArrived = new Map<string, number>();
        let staggerIndex = 0;
        for (const m of messages) {
            const k = msgKey(m);
            if (!prevKeys.has(k)) justArrived.set(k, staggerIndex++);
        }
        return { justArrived, liveUpdate: true };
    }, [messages]);

    useEffect(() => {
        prevMessagesRef.current = messages;
        mountedRef.current = true;
    }, [messages]);
```

- [ ] **Step 3: Thread the flags into `rowProps`**

Find the `rowProps` object inside the `.map()` (around line 197-210):

```tsx
                const rowProps = {
                    m, name, myUsername, isOwn, senderColor,
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
```

Add `isNew`, `enterDelayMs`, and `animateReactions`, computed right above it:

```tsx
                const staggerIdx = justArrived.get(msgKey(m));
                const isNew      = staggerIdx !== undefined;

                const rowProps = {
                    m, name, myUsername, isOwn, senderColor,
                    isCont: cont, isPinned: pinned, reactions: msgRx,
                    isNew, enterDelayMs: (staggerIdx ?? 0) * 40, animateReactions: liveUpdate,
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
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npx tsc -b --noEmit 2>&1
```

Expected: errors referencing `isNew`/`enterDelayMs`/`animateReactions` not existing on `MessageRowProps` yet — that's expected and gets fixed in Task 6. Confirm there are no *other* unrelated errors (e.g. no typo in `msgKey`, no missing `useMemo` import error).

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageList.tsx
git commit -m "feat: compute just-arrived/live-update flags for message entrance and reaction pop"
```

(This commit intentionally leaves the build red — `MessageRowProps` doesn't accept the new fields yet. Task 6 fixes it. This is a rare, deliberate exception to "always commit green" because the flag-computation logic and its consumption are large enough to review separately; the very next task closes the gap immediately.)

---

### Task 6: Consume the flags in `IncomingRow`/`OutgoingRow` + entrance CSS

**Files:**
- Modify: `grove_client/src/components/MessageRow/shared.tsx:93-113` (`MessageRowProps`)
- Modify: `grove_client/src/components/MessageRow/IncomingRow.tsx`
- Modify: `grove_client/src/components/MessageRow/OutgoingRow.tsx`
- Modify: `grove_client/src/styles/darkwood.css` (new rules appended before the `REDUCED MOTION` section, currently starting at line 2580)

**Interfaces:**
- Consumes: `isNew`, `enterDelayMs`, `animateReactions` from Task 5's `rowProps`.
- Produces: `MessageRowProps` now includes `isNew: boolean; enterDelayMs: number; animateReactions: boolean;` — Task 7 (`MessageBody`) consumes `animateReactions` from this same prop set (passed through by `IncomingRow`/`OutgoingRow`).

- [ ] **Step 1: Extend `MessageRowProps`**

In `grove_client/src/components/MessageRow/shared.tsx`, in the `MessageRowProps` interface (lines 93-113), add three fields after `isPinned: boolean;`:

```typescript
export interface MessageRowProps {
    m:            DisplayMessage;
    name:         string;
    myUsername:   string;
    isOwn:        boolean;
    senderColor?: string;
    isCont:       boolean;
    isPinned:     boolean;
    isNew:            boolean;
    enterDelayMs:     number;
    animateReactions: boolean;
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

- [ ] **Step 2: Update `IncomingRow.tsx`**

Replace the full contents of `grove_client/src/components/MessageRow/IncomingRow.tsx`:

```tsx
import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function IncomingRow({
    m, name, myUsername, isOwn, senderColor, isCont, isPinned, reactions,
    isNew, enterDelayMs, animateReactions,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    // "own-accent" (not "own") — this row never mirrors to the right, it only
    // gets the leaf accent treatment. "own" is reserved for OutgoingRow's
    // split-lane mirroring so the two don't collide when both classes could
    // theoretically apply to a left-aligned own message in group mode.
    const rowClass    = ["dw-msg-row", isCont ? "cont" : "", isOwn ? "own-accent" : "", m.pending ? "pending" : "", isNew ? "entering" : ""].filter(Boolean).join(" ");
    const rowStyle    = isNew && enterDelayMs > 0 ? { animationDelay: `${enterDelayMs}ms` } : undefined;
    const showActions = m.id !== undefined && !m.deleted && !isEditing;
    const authorStyle = !isOwn && senderColor ? { color: senderColor } : undefined;

    return (
        <div className={rowClass} style={rowStyle}>
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
                        <button
                            className={`dw-msg-author${isOwn ? " own" : ""}`}
                            style={authorStyle}
                            onClick={onUserClick}
                            aria-label={`View ${name}'s profile`}
                        >
                            {name}
                        </button>
                        <span className="dw-msg-time">{formatTime(m.timestamp)}</span>
                    </div>
                )}

                <MessageBody
                    m={m} myUsername={myUsername} isEditing={isEditing} editText={editText}
                    onEditChange={onEditChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel}
                    reactions={reactions} onReact={onReact} animateReactions={animateReactions}
                />
            </div>

            {showActions && (
                <MessageActions
                    isOwn={isOwn} isPinned={isPinned} side="right"
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

- [ ] **Step 3: Update `OutgoingRow.tsx`**

Replace the full contents of `grove_client/src/components/MessageRow/OutgoingRow.tsx`:

```tsx
import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function OutgoingRow({
    m, name, myUsername, isCont, isPinned, reactions,
    isNew, enterDelayMs, animateReactions,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    const rowClass    = ["dw-msg-row", "own", isCont ? "cont" : "", m.pending ? "pending" : "", isNew ? "entering" : ""].filter(Boolean).join(" ");
    const rowStyle    = isNew && enterDelayMs > 0 ? { animationDelay: `${enterDelayMs}ms` } : undefined;
    const showActions = m.id !== undefined && !m.deleted && !isEditing;

    return (
        <div className={rowClass} style={rowStyle}>
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
                    reactions={reactions} onReact={onReact} animateReactions={animateReactions}
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

- [ ] **Step 4: Add the entrance keyframe/class to `darkwood.css`**

In `grove_client/src/styles/darkwood.css`, find the end of the `.dw-notif-empty` rule (immediately before the `REDUCED MOTION` section comment, currently around line 2578). Insert before that comment:

```css
/* ============================================================
   MESSAGE ENTRANCE (reactbits motion pass)
   ============================================================ */

@keyframes gv-msg-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.dw-msg-row.entering {
  animation: gv-msg-enter var(--dur-normal) var(--ease-out) both;
}
```

(This is CSS-only, so it's already covered by the existing global `prefers-reduced-motion` rule at the bottom of the file — no separate JS check needed here, unlike Tasks 1 and 8.)

- [ ] **Step 5: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/MessageRow/shared.tsx src/components/MessageRow/IncomingRow.tsx src/components/MessageRow/OutgoingRow.tsx
```

Expected: no errors from `tsc -b` (the ones from Task 5 are now resolved), no lint output. There may still be pre-existing unrelated errors elsewhere in the repo if any existed before this plan — do not attempt to fix those here.

- [ ] **Step 6: Manual browser check**

Rebuild, open a channel with existing history, confirm the history appears instantly with no entrance animation. Then send a message from a second session/account (or use a second browser tab logged in as another user) into that same channel and confirm the new message fades/slides up into place. Scroll up to trigger "load more" and confirm older messages appear instantly, not animated.

- [ ] **Step 7: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/shared.tsx grove_client/src/components/MessageRow/IncomingRow.tsx grove_client/src/components/MessageRow/OutgoingRow.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: staggered entrance for genuinely new live messages"
```

---

### Task 7: Reaction pop in `MessageBody.tsx`

**Files:**
- Modify: `grove_client/src/components/MessageRow/MessageBody.tsx`
- Modify: `grove_client/src/styles/darkwood.css` (new rule appended in the same new section as Task 6)

**Interfaces:**
- Consumes: `animateReactions: boolean` prop (now supplied by `IncomingRow`/`OutgoingRow` from Task 6).

- [ ] **Step 1: Add the `animateReactions` prop and pop-keying**

In `grove_client/src/components/MessageRow/MessageBody.tsx`, update the props interface (lines 5-15):

```tsx
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
    animateReactions: boolean;
}
```

Update the function signature (lines 17-21):

```tsx
export function MessageBody({
    m, myUsername, isEditing, editText,
    onEditChange, onEditSubmit, onEditCancel,
    reactions, onReact, animateReactions,
}: MessageBodyProps) {
```

Update the reaction chip rendering (lines 56-70):

```tsx
            {msgReactions.length > 0 && (
                <div className="dw-reactions" aria-label="Reactions">
                    {msgReactions.map(([emoji, info]) => (
                        <button
                            key={animateReactions ? `${emoji}-${info.count}` : emoji}
                            className={`dw-reaction${info.byMe ? " mine" : ""}${animateReactions ? " pop" : ""}`}
                            onClick={() => m.id !== undefined && onReact(m.id, emoji)}
                            title={info.byMe ? `You reacted ${emoji}` : `React with ${emoji}`}
                        >
                            {emoji}
                            <span className="dw-reaction-count">{info.count}</span>
                        </button>
                    ))}
                </div>
            )}
```

- [ ] **Step 2: Add the pop keyframe/class to `darkwood.css`**

In the `MESSAGE ENTRANCE (reactbits motion pass)` section added in Task 6, append after the `.dw-msg-row.entering` rule:

```css
@keyframes gv-reaction-pop {
  from { transform: scale(0.6); opacity: 0.4; }
  to   { transform: scale(1);   opacity: 1; }
}

.dw-reaction.pop {
  animation: gv-reaction-pop var(--dur-fast) var(--ease-spring) both;
}
```

(`--ease-spring` is the `cubic-bezier(0.34, 1.56, 0.64, 1)` token already defined in the `:root` tokens block — the same curve the toast entrance uses inline. This is CSS-only and already covered by the global reduced-motion rule.)

- [ ] **Step 3: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/MessageRow/MessageBody.tsx
```

Expected: no errors, no lint output.

- [ ] **Step 4: Manual browser check**

Open a channel where some messages already have reactions and confirm they appear instantly on load (no pop). React to a message while viewing the channel and confirm the chip pops in with a small spring scale. Add a second reaction to a message that already has one and confirm only the changed chip pops, not the whole reaction row. Scroll up to load older history containing reacted messages and confirm those don't pop either.

- [ ] **Step 5: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageRow/MessageBody.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: reaction-count pop on live reaction changes"
```

---

### Task 8: `SendSpark` component

**Files:**
- Create: `grove_client/src/components/motion/SendSpark.tsx`

**Interfaces:**
- Produces: `<SendSpark ref={...} color?: string />` — a `forwardRef` component exposing `{ burst(): void }` via `useImperativeHandle`. Renders an absolutely-positioned `<canvas className="dw-send-spark-canvas">` sized to its parent element via `ResizeObserver`. `burst()` spawns a short radiating-line animation centered on the canvas and no-ops under `prefers-reduced-motion: reduce`.

- [ ] **Step 1: Write the component**

Create `grove_client/src/components/motion/SendSpark.tsx`:

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

export interface SendSparkHandle {
    burst: () => void;
}

interface Spark {
    x:         number;
    y:         number;
    angle:     number;
    startTime: number;
}

const DURATION     = 350;
const SPARK_COUNT  = 7;
const SPARK_SIZE   = 8;
const SPARK_RADIUS = 14;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ease(t: number): number {
    return t * (2 - t);
}

/**
 * Ported from reactbits' ClickSpark, which is already zero-dependency
 * (canvas + requestAnimationFrame, no framer-motion). Simplified from a
 * full-size click-anywhere wrapper into a small imperative-ref component
 * so it can be scoped to exactly one button and triggered from app logic
 * (message send) instead of every click in its subtree.
 */
export const SendSpark = forwardRef<SendSparkHandle, { color?: string }>(
    function SendSpark({ color = "#6ab870" }, ref) {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const sparksRef = useRef<Spark[]>([]);
        const rafRef    = useRef<number | undefined>(undefined);

        useEffect(() => {
            const canvas = canvasRef.current;
            const parent = canvas?.parentElement;
            if (!canvas || !parent) return;

            const resize = () => {
                const { width, height } = parent.getBoundingClientRect();
                canvas.width  = width;
                canvas.height = height;
            };
            resize();

            const ro = new ResizeObserver(resize);
            ro.observe(parent);
            return () => ro.disconnect();
        }, []);

        useEffect(() => {
            const canvas = canvasRef.current;
            const ctx    = canvas?.getContext("2d");
            if (!canvas || !ctx) return;

            const draw = (now: number) => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                sparksRef.current = sparksRef.current.filter(spark => {
                    const elapsed = now - spark.startTime;
                    if (elapsed >= DURATION) return false;

                    const progress = ease(elapsed / DURATION);
                    const distance = progress * SPARK_RADIUS;
                    const length   = SPARK_SIZE * (1 - progress);
                    const x1 = spark.x + distance * Math.cos(spark.angle);
                    const y1 = spark.y + distance * Math.sin(spark.angle);
                    const x2 = spark.x + (distance + length) * Math.cos(spark.angle);
                    const y2 = spark.y + (distance + length) * Math.sin(spark.angle);

                    ctx.strokeStyle = color;
                    ctx.lineWidth   = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    return true;
                });
                rafRef.current = requestAnimationFrame(draw);
            };

            rafRef.current = requestAnimationFrame(draw);
            return () => {
                if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
            };
        }, [color]);

        useImperativeHandle(ref, () => ({
            burst() {
                if (prefersReducedMotion()) return;
                const canvas = canvasRef.current;
                if (!canvas) return;

                const cx  = canvas.width / 2;
                const cy  = canvas.height / 2;
                const now = performance.now();
                const newSparks: Spark[] = Array.from({ length: SPARK_COUNT }, (_, i) => ({
                    x: cx, y: cy,
                    angle: (2 * Math.PI * i) / SPARK_COUNT,
                    startTime: now,
                }));
                sparksRef.current.push(...newSparks);
            },
        }));

        return <canvas ref={canvasRef} className="dw-send-spark-canvas" aria-hidden="true" />;
    },
);
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1 | grep -i sendspark || echo "no errors"
npx eslint src/components/motion/SendSpark.tsx
```

Expected: `no errors`, no lint output.

- [ ] **Step 3: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/motion/SendSpark.tsx
git commit -m "feat: add SendSpark component, ported from reactbits ClickSpark"
```

---

### Task 9: Wire `SendSpark` into the send button

**Files:**
- Modify: `grove_client/src/components/MessageInput.tsx`
- Modify: `grove_client/src/styles/darkwood.css` (new rules in the same section as Tasks 6-7)

**Interfaces:**
- Consumes: `SendSpark`, `SendSparkHandle` from Task 8.

- [ ] **Step 1: Add imports and the ref**

In `grove_client/src/components/MessageInput.tsx`, update the top import (line 1):

```typescript
import { useEffect, useRef, useState } from "react";
import { SendSpark, type SendSparkHandle } from "./motion/SendSpark";
```

After the existing ref declarations (after line 22, `const inputRef = useRef<HTMLTextAreaElement>(null);`), add:

```typescript
    const sparkRef = useRef<SendSparkHandle>(null);
```

- [ ] **Step 2: Trigger the burst on send**

In the `submit()` function (lines 30-38), add the burst call right after a successful send:

```typescript
    function submit() {
        const trimmed = text.trim();
        if (!trimmed || disabled) return;
        onSend(trimmed);
        sparkRef.current?.burst();
        setText("");
        setMentionQuery(null);
        // Reset textarea height
        if (inputRef.current) inputRef.current.style.height = "auto";
    }
```

- [ ] **Step 3: Wrap the send button**

Find the send button (lines 149-157):

```tsx
                <button
                    className={`dw-send-btn${hasText ? " show" : ""}`}
                    onClick={submit}
                    disabled={disabled || !hasText}
                    aria-label="Send message"
                    tabIndex={hasText ? 0 : -1}
                >
                    <SendIcon />
                </button>
```

Replace with:

```tsx
                <div className="dw-send-btn-wrap">
                    <button
                        className={`dw-send-btn${hasText ? " show" : ""}`}
                        onClick={submit}
                        disabled={disabled || !hasText}
                        aria-label="Send message"
                        tabIndex={hasText ? 0 : -1}
                    >
                        <SendIcon />
                    </button>
                    <SendSpark ref={sparkRef} color="var(--leaf-bright)" />
                </div>
```

- [ ] **Step 4: Add wrapper/canvas CSS**

In the `MESSAGE ENTRANCE (reactbits motion pass)` section of `darkwood.css` (added in Task 6, extended in Task 7), append:

```css
.dw-send-btn-wrap {
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.dw-send-spark-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

- [ ] **Step 5: Typecheck and lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client
npx tsc -b --noEmit 2>&1
npx eslint src/components/MessageInput.tsx
```

Expected: no errors, no lint output.

- [ ] **Step 6: Manual browser check**

Type a message and send it. Confirm a brief burst of thin green lines radiates from the send button on submit, and disappears within well under half a second. Confirm the button's existing hover-scale (`transform: scale(1.05)` from Pass 2) still works and isn't visually broken by the new wrapper div. With OS-level reduce-motion enabled, confirm sending a message shows no spark at all.

- [ ] **Step 7: Commit**

```bash
cd /home/richtofen/projects/grovefolder
git add grove_client/src/components/MessageInput.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: wire send-button spark into message submit"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npx tsc -b
```

Expected: exits 0, no errors.

- [ ] **Step 2: Full lint**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npm run lint
```

Expected: exits 0, no errors.

- [ ] **Step 3: Production build**

```bash
cd /home/richtofen/projects/grovefolder/grove_client && npm run build
```

Expected: exits 0, build artifacts produced in `dist/`.

- [ ] **Step 4: Confirm zero new dependencies**

```bash
cd /home/richtofen/projects/grovefolder && git diff dev -- grove_client/package.json
```

Expected: no output (file unchanged from `dev`).

- [ ] **Step 5: Docker rebuild and full manual walkthrough**

```bash
cd /home/richtofen/projects/grovefolder && docker compose -f docker-compose.prod.yml up --build
```

Walk through every verification bullet from the design spec's "Testing / verification" section in the running app:
- Empty state and login wordmark/tagline decrypt-reveal on fresh mount
- Reduced-motion shows final text/state immediately everywhere (empty state, login, message entrance, reaction pop, send spark)
- New live message arrival animates; scrolling up to load history does not; opening a channel with existing history does not
- Reaction count change pops; send button sparks on send
- No regressions to the Pass 1/2 message layout, hover-scale on the send button and message-action chips, or the `gv-enter-grove` login transition

- [ ] **Step 6: Review full diff before handoff**

```bash
cd /home/richtofen/projects/grovefolder && git diff dev...feature/reactbits-motion-pass --stat
```

Confirm the changed-file list matches this plan's scope exactly: `AppShell.tsx`, `LoginScreen.tsx`, `MessageList.tsx`, `MessageRow/shared.tsx`, `MessageRow/IncomingRow.tsx`, `MessageRow/OutgoingRow.tsx`, `MessageRow/MessageBody.tsx`, `MessageInput.tsx`, `darkwood.css`, plus the two new files under `hooks/` and `components/motion/`. No chrome files (`AppShell.tsx`'s toast/palette/notif-panel sections weren't touched beyond the one import line — spot-check the diff to confirm those sections have no changes).

No further commit here — this task is verification-only. If any step fails, fix forward with a new commit on this branch before considering the plan complete.
