# Richer message formatting — design doc

Status: approved by user, ready for planning
Date: 2026-08-18

## Why

First sub-project of "Core messaging depth" (item 2 of the "Grove vs
Slack/Discord feature-parity overhaul," see `GROVE_HANDOFF.md`). That
overhaul item originally bundled threads, file/image uploads, richer text
formatting, and link-preview cards into one sub-project. Scoped down at
brainstorm time (see "Scope decision" below) — this spec covers formatting
only. Threads, uploads, and link previews each get their own brainstorm →
spec → plan cycle later.

## Scope decision

The four items under "Core messaging depth" are largely independent
subsystems, each with its own real design decisions (thread UI shape,
upload storage backend, unfurl architecture) and backend+frontend surface.
Building all four in one plan would front-load far more design work than
necessary before anything ships. User chose to sequence them one at a time,
starting with formatting — the smallest, lowest-risk piece: no new backend
infrastructure, no schema changes, extends an existing pure function.

## Current state

Grove already has inline markdown via `parseMarkdown()` in
`grove_client/src/components/MessageRow/shared.tsx` — a hand-rolled,
single-pass parser. A `CHECKS` array of `{ regex, type }` entries is
scanned per remaining-text slice; the earliest match wins, its captured
group becomes a React node (`<strong>`, `<em>`, `<del>`, `<code>`, a
`.dw-mention` span, or `<br/>`), and the loop continues on the remainder.
Existing rules: `**bold**`, `~~strike~~`, `*italic*`, `` `code` ``,
`@mention`, and `\n` → `<br/>`.

Rendered inside `MessageBody.tsx` as:
```tsx
<span className="dw-msg-text">
    {parseMarkdown(m.text, myUsername)}
</span>
```

This is purely a client-side render concern — `message.text` is stored and
transmitted as-is (plain text, 2000-char server-side cap per
`api/validation.rs:62`); nothing about the backend, the binary WS protocol,
or the database schema changes for this feature. No new dependencies.

## Approved direction

Extend the existing single-pass `CHECKS` array with two more entries —
code fences and auto-linked URLs — following the same pattern as every
existing rule: the matched capture becomes a React node directly, with no
recursive re-parsing of its contents. This is the same mechanism that
already keeps single-backtick inline code safe from being mangled by the
bold/italic rules, so it extends naturally to fenced code blocks without
new machinery.

Two alternatives were considered and rejected for this pass:
- **Pre-split into code/prose segments** before running the inline parser —
  more defensive against regex-priority edge cases, but more code than this
  feature's actual scope justifies.
- **Swap to a markdown library** (e.g. `markdown-it`) — most
  standards-correct, but adds a new dependency, bundle weight, and either
  an AST→React renderer or sanitized `dangerouslySetInnerHTML` — more
  machinery than two new formatting rules warrant.

### Code blocks

Syntax: triple-backtick fences, with an optional language tag on the
opening fence line (`` ```rust ``), matching the universal GitHub/Discord/
Slack convention.
- Rendered as a `<pre><code>` block in a `surface-2` panel (same background
  as existing inline code), monospace via `--font-mono` (JetBrains Mono).
- If a language tag is present, show it as a small mono label pinned to the
  block's top-left corner. The tag is arbitrary, unvalidated display
  text — whatever the user typed after the opening ` ``` ` (e.g. `rust`,
  `js`, `foo`), shown verbatim, no allowlist of known languages. It's a
  label only; nothing about it changes parsing or rendering behavior.
  **No syntax coloring** — plain monospace text only, per user's explicit
  choice (avoids pulling in a highlighting library for a chat app, not a
  code editor).
- The fence regex must span newlines (reuse the `s` flag already used by
  the existing multi-line-capable `bold`/`strike`/`italic` rules in
  `CHECKS`).
- Overflow: horizontal scroll within the block, never wrap. Preserves
  exact indentation/alignment of pasted code — the same tradeoff GitHub,
  Discord, and Slack all make.
- Content inside a fence is inserted verbatim — not re-parsed for bold,
  links, mentions, or any other rule. A URL typed inside a code block
  stays literal text, is never auto-linkified. Matches how every
  code-literate renderer treats fenced content.

### Auto-linkify

A URL regex (`http://` / `https://` only) detects bare links in plain text
outside code fences and renders them as anchors:
- Trailing sentence punctuation (`.`, `,`, `)`, `!`, `?` immediately after
  the URL with no space) is excluded from the link — "check this out:
  https://example.com." links only `https://example.com`, the period stays
  plain text. Matches the convention every major chat client uses; without
  it, a URL at the end of a sentence would swallow its own full stop into
  the href.
- `target="_blank" rel="noopener noreferrer"` (required — no exceptions,
  per this project's standing security rules on `target="_blank"`).
- Scheme validated before rendering — only `http:`/`https:` are ever
  allowed to become an `href`. Never `javascript:`, `data:`, or any other
  scheme, even if a hypothetical future regex tweak made one match.
- Styled with the `--leaf` accent color, underline appears on hover only
  (not by default) — reads as a link without breaking the no-message-bubble,
  minimal-chrome aesthetic Grove already has.

## Implementation footnote (for the plan)

`.dw-msg-text` is currently a `<span>` (`MessageBody.tsx`); a `<pre>` block
is not valid as a descendant of an inline element. The plan should change
this wrapper to a `<div>` — `white-space: pre-wrap` and all existing
`.dw-msg-text` CSS rules (`darkwood.css:528-561`) carry over unaffected,
since nothing in that ruleset depends on `display: inline`. No other markup
in `MessageBody.tsx` needs to change.

## Explicitly out of scope

- Threads, file/image uploads, link-preview cards — each is its own,
  separate sub-project with its own brainstorm.
- Block quotes (`>`) and bullet/numbered lists — considered, not selected
  in this pass's scoping question.
- Syntax highlighting inside code blocks — explicitly rejected in favor of
  plain monospace.
- Any backend, protocol, or schema change — this feature is 100%
  client-side rendering of already-stored plain text.
- Editing behavior: the existing edit mode (`<input>` swap in
  `MessageBody.tsx`) already shows raw, unparsed text for editing — no
  change needed there, since a code fence or URL is just literal characters
  in that raw text same as `**bold**` is today.
