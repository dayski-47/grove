# Richer message formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fenced code blocks and auto-linked URLs to Grove's message
formatting, extending the existing `parseMarkdown()` parser.

**Architecture:** Pure client-side rendering change. `parseMarkdown()` in
`grove_client/src/components/MessageRow/shared.tsx` is a hand-rolled,
single-pass parser: a `CHECKS` array of `{ regex, type }` entries is scanned
against the remaining text each iteration, the earliest match wins, its
capture becomes a React node, and the loop continues on the remainder. Two
new entries are added to `CHECKS` — `codeblock` and `url` — following the
exact same pattern as the five existing entries. No backend, protocol, or
database change of any kind; `message.text` is already stored and
transmitted as plain text.

**Tech Stack:** React 19 + TypeScript, Vite. Vitest for unit tests
(`environment: "node"`, `include: ["src/**/*.test.ts"]` per
`vitest.config.ts` — no jsdom/React Testing Library installed).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-18-message-formatting-design.md`.
- No backend, WebSocket protocol, or database schema change of any kind.
- No new dependencies.
- No syntax highlighting inside code blocks — plain monospace only.
- A URL inside a code fence must never be auto-linkified — fence content is
  inserted verbatim, matching how single-backtick inline code already
  behaves (no recursive re-parsing of captured content).
- Auto-linked anchors: `target="_blank" rel="noopener noreferrer"` always;
  `href` only ever set to a value whose `new URL(...).protocol` is `http:`
  or `https:` — never trust the regex alone as the safety boundary.
- Trailing sentence punctuation (`. , ! ? : ; ' "`) immediately after a URL
  with no space is excluded from the link. A trailing `)` `]` `}` is
  excluded only when it is *unbalanced* within the matched URL text (more
  closers than openers of that bracket) — a URL like
  `https://en.wikipedia.org/wiki/Rust_(programming_language)` must keep its
  closing paren.
- Optional code-fence language tag (` ```rust `) is arbitrary, unvalidated
  display text — shown verbatim, no allowlist, changes nothing about
  parsing or rendering.
- Code block overflow: horizontal scroll, never wrap.
- Testing approach: this codebase's Vitest setup has no component-rendering
  infra. `parseMarkdown()` returns `ReactNode[]` — plain objects from
  `React.createElement` under the hood — so tests assert on the returned
  objects' `.type` / `.props` directly (no rendering, no DOM). This matches
  the one existing test file's approach to testing pure logic
  (`src/paneLayout.test.ts`).

---

## File Structure

- `grove_client/src/components/MessageRow/shared.tsx` — modified. Two new
  `CHECKS` entries (`codeblock`, `url`), two new private helper functions
  (`trimTrailingPunctuation`, `isSafeUrl`), `parseMarkdown()`'s loop body
  extended to render the two new node types and to use a
  type-specific "consumed length" instead of always trusting
  `match[0].length` (needed because a trimmed URL consumes less of the
  string than its raw regex match).
- `grove_client/src/components/MessageRow/MessageBody.tsx` — modified. The
  `.dw-msg-text` wrapper changes from `<span>` to `<div>` — a `<pre>` block
  is not valid inside an inline element, and this is the only markup change
  needed outside `shared.tsx`.
- `grove_client/src/styles/darkwood.css` — modified. Three new rules:
  `.dw-code-block`, `.dw-code-block-lang`, `.dw-link`.
- `grove_client/src/components/MessageRow/shared.test.ts` — new. Unit tests
  for both new `CHECKS` entries, calling `parseMarkdown()` directly and
  asserting on the returned node structure.

---

### Task 1: Fenced code blocks

**Files:**
- Modify: `grove_client/src/components/MessageRow/shared.tsx:44-89` (`CHECKS`
  array and `parseMarkdown()`)
- Modify: `grove_client/src/components/MessageRow/MessageBody.tsx:72,74`
  (`<span className="dw-msg-text">` → `<div className="dw-msg-text">`)
- Modify: `grove_client/src/styles/darkwood.css` (add after the existing
  `.dw-code-inline` rule, around line 571)
- Test: `grove_client/src/components/MessageRow/shared.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CHECKS` array with a `codeblock` entry as its **first** element
  (highest priority on any index tie against `bold`/`code`). `parseMarkdown()`
  renders a `codeblock` match as
  `<pre className="dw-code-block">{lang && <span className="dw-code-block-lang">{lang}</span>}<code>{code}</code></pre>`.
  Task 2 adds its `url` entry into this same array and reuses the
  (by-then-renamed) per-type "consumed length" pattern this task
  introduces — Task 2's implementer must read this task's final
  `parseMarkdown()` body, not just the description here.

- [ ] **Step 1: Write the failing tests**

Create `grove_client/src/components/MessageRow/shared.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./shared";

describe("parseMarkdown — code blocks", () => {
    it("renders a fenced block with no language tag as a pre>code pair", () => {
        const nodes = parseMarkdown("```\nconst x = 1;\n```", "alice");
        expect(nodes).toHaveLength(1);
        const pre = nodes[0] as any;
        expect(pre.type).toBe("pre");
        expect(pre.props.className).toBe("dw-code-block");
    });

    it("captures the code content verbatim, without recursively parsing markdown inside it", () => {
        const nodes = parseMarkdown("```\n**not bold** inside code\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(codeEl.type).toBe("code");
        expect(codeEl.props.children).toBe("**not bold** inside code");
    });

    it("shows the language tag as a label when present", () => {
        const nodes = parseMarkdown("```rust\nfn main() {}\n```", "alice");
        const pre = nodes[0] as any;
        const langEl = pre.props.children[0];
        expect(langEl.type).toBe("span");
        expect(langEl.props.className).toBe("dw-code-block-lang");
        expect(langEl.props.children).toBe("rust");
    });

    it("omits the language label entirely when no language tag is given", () => {
        const nodes = parseMarkdown("```\nplain\n```", "alice");
        const pre = nodes[0] as any;
        expect(pre.props.children[0]).toBeFalsy();
    });

    it("still parses formatting outside the fence, on both sides", () => {
        const nodes = parseMarkdown("before ```\ncode\n``` **after**", "alice");
        expect(nodes[0]).toBe("before ");
        const pre = nodes[1] as any;
        expect(pre.type).toBe("pre");
        expect(nodes[2]).toBe(" ");
        const bold = nodes[3] as any;
        expect(bold.type).toBe("strong");
        expect(bold.props.children).toBe("after");
    });

    it("does not treat an unterminated triple-backtick as a code block", () => {
        const nodes = parseMarkdown("``` unterminated", "alice");
        expect(nodes).toEqual(["``` unterminated"]);
    });

    it("handles two separate fences in one message as two separate blocks", () => {
        const nodes = parseMarkdown("```\na\n``` and ```\nb\n```", "alice");
        const first = nodes[0] as any;
        const second = nodes[2] as any;
        expect(first.type).toBe("pre");
        expect(first.props.children[1].props.children).toBe("a");
        expect(nodes[1]).toBe(" and ");
        expect(second.type).toBe("pre");
        expect(second.props.children[1].props.children).toBe("b");
    });

    it("preserves internal newlines in multi-line code, stripping only the one before the closing fence", () => {
        const nodes = parseMarkdown("```js\nline1\nline2\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(codeEl.props.children).toBe("line1\nline2");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: FAIL — `parseMarkdown` doesn't produce `pre`/`dw-code-block`
nodes yet (every assertion on `pre.type`/`pre.props` fails or throws on
`undefined`).

- [ ] **Step 3: Implement the code-fence check**

Replace the `CHECKS` array and `parseMarkdown()` function in
`grove_client/src/components/MessageRow/shared.tsx` (currently lines 44-89)
with:

```ts
const CHECKS: Check[] = [
    { regex: /```(\w*)\n(.*?)```/s, type: "codeblock" },
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
        let consumedLength = match[0].length;

        if (type === "bold")    nodes.push(<strong key={key++}>{match[1]}</strong>);
        else if (type === "strike")  nodes.push(<del key={key++}>{match[1]}</del>);
        else if (type === "italic")  nodes.push(<em key={key++}>{match[1]}</em>);
        else if (type === "code")    nodes.push(<code key={key++} className="dw-code-inline">{match[1]}</code>);
        else if (type === "codeblock") {
            const lang = match[1];
            // The fence regex's non-greedy group always captures the newline
            // immediately before the closing ``` as part of the content —
            // that separator isn't part of the code, so drop it.
            const code = match[2].replace(/\n$/, "");
            nodes.push(
                <pre key={key++} className="dw-code-block">
                    {lang && <span className="dw-code-block-lang">{lang}</span>}
                    <code>{code}</code>
                </pre>
            );
        }
        else if (type === "mention") {
            const name = match[1];
            const isMe = name.toLowerCase() === myUsername.toLowerCase();
            nodes.push(<span key={key++} className={`dw-mention${isMe ? " me" : ""}`}>{match[0]}</span>);
        }
        else if (type === "newline") nodes.push(<br key={key++} />);

        remaining = remaining.slice(earliest.index + consumedLength);
    }

    return nodes;
}
```

(This introduces the `consumedLength` local — currently always equal to
`match[0].length` — that Task 2 will override for the `url` type only.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Change `.dw-msg-text` from `<span>` to `<div>`**

In `grove_client/src/components/MessageRow/MessageBody.tsx`, current
(lines 72-74):
```tsx
                ) : (
                    <span className="dw-msg-text">
                        {parseMarkdown(m.text, myUsername)}
                    </span>
```

Replace with:
```tsx
                ) : (
                    <div className="dw-msg-text">
                        {parseMarkdown(m.text, myUsername)}
                    </div>
```

(No CSS change needed for this — `.dw-msg-text`'s existing rules in
`darkwood.css` don't depend on `display: inline`.)

- [ ] **Step 6: Add code-block CSS**

In `grove_client/src/styles/darkwood.css`, add immediately after the
existing `.dw-code-inline` rule (around line 571):

```css
.dw-code-block {
  display: block;
  margin: var(--sp-2) 0;
  padding: var(--sp-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow-x: auto;
}

.dw-code-block code {
  font-family: var(--font-mono);
  font-size: 0.83em;
  color: var(--text-primary);
  white-space: pre;
}

.dw-code-block-lang {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: var(--sp-2);
  text-transform: lowercase;
}
```

- [ ] **Step 7: Run the full build and test suite**

Run: `cd grove_client && npm run build && npm test`
Expected: `npm run build` exits 0 (catches JSX/TypeScript errors — this is
the step that proves the `<div>` change and new JSX compile cleanly).
`npm test` passes all tests including the 7 new ones and the pre-existing
`paneLayout.test.ts` suite.

- [ ] **Step 8: Manual check in the running app**

Run: `cd grove_client && npm run dev`. This project has no browser/screenshot
tooling available to an agent — if you cannot visually confirm rendering,
say so explicitly in your report rather than claiming success; that's an
accepted, known limitation here, not a blocker. If you do have browser
access: log in, open any channel, send a message containing a fenced code
block (e.g. `` ```js\nconsole.log("hi");\n``` ``) and confirm it renders as
a monospace block with a `surface-2` background, and that a long line
scrolls horizontally instead of wrapping.

- [ ] **Step 9: Commit**

```bash
git add grove_client/src/components/MessageRow/shared.tsx grove_client/src/components/MessageRow/shared.test.ts grove_client/src/components/MessageRow/MessageBody.tsx grove_client/src/styles/darkwood.css
git commit -m "feat: render fenced code blocks in messages"
```

---

### Task 2: Auto-linkify URLs

**Files:**
- Modify: `grove_client/src/components/MessageRow/shared.tsx` (add `url` to
  `CHECKS`, add two helper functions, extend the `parseMarkdown()` loop
  body)
- Modify: `grove_client/src/styles/darkwood.css` (add `.dw-link`)
- Test: `grove_client/src/components/MessageRow/shared.test.ts` (append)

**Interfaces:**
- Consumes: `CHECKS` array and `parseMarkdown()` exactly as Task 1 left
  them (must be complete and merged first — this task edits the same
  function body).
- Produces: nothing consumed by a later task — this is the last task in
  the plan.

- [ ] **Step 1: Write the failing tests**

Append to `grove_client/src/components/MessageRow/shared.test.ts`:

```ts
describe("parseMarkdown — auto-linkify URLs", () => {
    it("turns a bare https URL into a link", () => {
        const nodes = parseMarkdown("check https://example.com out", "alice");
        expect(nodes[0]).toBe("check ");
        const a = nodes[1] as any;
        expect(a.type).toBe("a");
        expect(a.props.href).toBe("https://example.com");
        expect(a.props.children).toBe("https://example.com");
        expect(a.props.target).toBe("_blank");
        expect(a.props.rel).toBe("noopener noreferrer");
        expect(a.props.className).toBe("dw-link");
        expect(nodes[2]).toBe(" out");
    });

    it("strips a trailing period that isn't part of the URL", () => {
        const nodes = parseMarkdown("see https://example.com.", "alice");
        const a = nodes[1] as any;
        expect(a.props.href).toBe("https://example.com");
        expect(nodes[2]).toBe(".");
    });

    it("keeps a closing paren that's part of a balanced URL", () => {
        const nodes = parseMarkdown(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
            "alice",
        );
        const a = nodes[0] as any;
        expect(a.props.href).toBe("https://en.wikipedia.org/wiki/Rust_(programming_language)");
        expect(nodes).toHaveLength(1);
    });

    it("strips a trailing paren that closes surrounding sentence punctuation, not the URL", () => {
        const nodes = parseMarkdown("(see https://example.com)", "alice");
        expect(nodes[0]).toBe("(see ");
        const a = nodes[1] as any;
        expect(a.props.href).toBe("https://example.com");
        expect(nodes[2]).toBe(")");
    });

    it("does not linkify a URL inside a code fence", () => {
        const nodes = parseMarkdown("```\nhttps://example.com\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(typeof codeEl.props.children).toBe("string");
        expect(codeEl.props.children).toBe("https://example.com");
    });

    it("never renders a non-http(s) scheme as a link, even if adjacent text looks URL-like", () => {
        const nodes = parseMarkdown("visit javascript:alert(1) now", "alice");
        expect(nodes).toEqual(["visit javascript:alert(1) now"]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: FAIL on all 6 new tests (no `url` type exists yet, so URLs fall
through as plain text and none of the `<a>`-shaped assertions hold).

- [ ] **Step 3: Add the two helper functions**

In `grove_client/src/components/MessageRow/shared.tsx`, add above the
`CHECKS` array (after the `/* ── Inline markdown parser ── */` comment,
before `type Check = ...`):

```ts
function trimTrailingPunctuation(url: string): string {
    let end = url.length;
    while (end > 0) {
        const ch = url[end - 1];
        const opener = ch === ")" ? "(" : ch === "]" ? "[" : ch === "}" ? "{" : null;

        if (opener) {
            const segment = url.slice(0, end);
            const opens = segment.split(opener).length - 1;
            const closes = segment.split(ch).length - 1;
            if (closes <= opens) break;
            end -= 1;
            continue;
        }

        if (".,!?:;'\"".includes(ch)) {
            end -= 1;
            continue;
        }

        break;
    }
    return url.slice(0, end);
}

function isSafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
```

- [ ] **Step 4: Add the `url` entry to `CHECKS`**

Current `CHECKS` array (as left by Task 1):
```ts
const CHECKS: Check[] = [
    { regex: /```(\w*)\n(.*?)```/s, type: "codeblock" },
    { regex: /\*\*(.+?)\*\*/s, type: "bold"    },
    { regex: /~~(.+?)~~/s,     type: "strike"  },
    { regex: /\*(.+?)\*/s,     type: "italic"  },
    { regex: /`([^`\n]+)`/,   type: "code"    },
    { regex: /@(\w+)/,         type: "mention" },
    { regex: /\n/,             type: "newline" },
];
```

Replace with (new `url` entry inserted before `newline`):
```ts
const CHECKS: Check[] = [
    { regex: /```(\w*)\n(.*?)```/s, type: "codeblock" },
    { regex: /\*\*(.+?)\*\*/s, type: "bold"    },
    { regex: /~~(.+?)~~/s,     type: "strike"  },
    { regex: /\*(.+?)\*/s,     type: "italic"  },
    { regex: /`([^`\n]+)`/,   type: "code"    },
    { regex: /@(\w+)/,         type: "mention" },
    { regex: /https?:\/\/[^\s<]+/, type: "url" },
    { regex: /\n/,             type: "newline" },
];
```

- [ ] **Step 5: Handle the `url` type in `parseMarkdown()`'s loop body**

Current block (as left by Task 1), inside the `if/else if` chain:
```ts
        else if (type === "mention") {
            const name = match[1];
            const isMe = name.toLowerCase() === myUsername.toLowerCase();
            nodes.push(<span key={key++} className={`dw-mention${isMe ? " me" : ""}`}>{match[0]}</span>);
        }
        else if (type === "newline") nodes.push(<br key={key++} />);
```

Replace with (new `url` branch inserted between `mention` and `newline`):
```ts
        else if (type === "mention") {
            const name = match[1];
            const isMe = name.toLowerCase() === myUsername.toLowerCase();
            nodes.push(<span key={key++} className={`dw-mention${isMe ? " me" : ""}`}>{match[0]}</span>);
        }
        else if (type === "url") {
            const trimmed = trimTrailingPunctuation(match[0]);
            if (isSafeUrl(trimmed)) {
                nodes.push(
                    <a key={key++} href={trimmed} target="_blank" rel="noopener noreferrer" className="dw-link">
                        {trimmed}
                    </a>
                );
            } else {
                nodes.push(trimmed);
            }
            consumedLength = trimmed.length;
        }
        else if (type === "newline") nodes.push(<br key={key++} />);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd grove_client && npx vitest run src/components/MessageRow/shared.test.ts`
Expected: PASS, all 14 tests (8 from Task 1 + 6 from this task).

- [ ] **Step 7: Add link CSS**

In `grove_client/src/styles/darkwood.css`, add immediately after the
`.dw-code-block-lang` rule added in Task 1:

```css
.dw-link {
  color: var(--leaf-bright);
  text-decoration: none;
}

.dw-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 8: Run the full build and test suite**

Run: `cd grove_client && npm run build && npm test`
Expected: both exit 0 / all tests pass.

- [ ] **Step 9: Manual check in the running app**

Run: `cd grove_client && npm run dev`. Same note as Task 1 — if you cannot
visually confirm rendering in this environment, say so explicitly rather
than claiming success; that's accepted here, not a blocker. If you do have
browser access: send a message containing a bare URL and confirm it
renders as a `--leaf-bright` link with underline-on-hover, opens in a new
tab, and that a URL typed inside a fenced code block in the same message
stays plain text.

- [ ] **Step 10: Commit**

```bash
git add grove_client/src/components/MessageRow/shared.tsx grove_client/src/components/MessageRow/shared.test.ts grove_client/src/styles/darkwood.css
git commit -m "feat: auto-linkify bare URLs in messages"
```

---

## Self-Review

**Spec coverage:**
- Code fences, optional language label, no syntax highlighting, horizontal
  scroll on overflow, verbatim (non-recursive) content → Task 1. ✓
- Auto-linkify, `target="_blank" rel="noopener noreferrer"`, scheme
  validation, trailing-punctuation trimming (including the balanced-paren
  case), URLs inside code fences stay literal → Task 2. ✓
- `.dw-msg-text` span→div implementation footnote → Task 1, Step 5. ✓
- Threads/uploads/link-previews, block quotes/lists, syntax highlighting,
  any backend/protocol/schema change, edit-mode behavior → correctly no
  task touches any of these, per the spec's "Explicitly out of scope". ✓

**Placeholder scan:** no TBD/TODO, every step has literal code or an exact
runnable command. Clean.

**Type consistency:** `CHECKS: Check[]` (`{ regex: RegExp; type: string }`)
is unchanged in shape across both tasks — only entries are appended.
`parseMarkdown(text: string, myUsername: string): ReactNode[]` signature is
untouched end to end; `MessageBody.tsx`'s call site
(`parseMarkdown(m.text, myUsername)`) needs no change. `consumedLength`
(introduced Task 1, used as-is by Task 2) is declared once as `let
consumedLength = match[0].length` and only the `url` branch reassigns it —
no naming drift between the two tasks' edits to the same function.
