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

// Per-sender username text colors for group/general channels. Deliberately
// excludes green (--leaf family) since that's reserved for "this is you" —
// a green username would read as your own message. Brighter than
// AVATAR_COLORS since these sit directly on --void/--surface-0 as text,
// not as a background fill behind a white initial.
const SENDER_TEXT_COLORS = [
    "#7aa0d9", "#c48fd9", "#d9a15c", "#5cc4c9",
    "#d97a8f", "#8f9bd9", "#c9a25c", "#a5729e",
];

export function senderTextColor(uid: number): string {
    return SENDER_TEXT_COLORS[uid % SENDER_TEXT_COLORS.length];
}

export function initial(name: string): string {
    return name.slice(0, 1).toUpperCase();
}

export function formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Inline markdown parser ──────────────────────────────── */

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

type Check = { regex: RegExp; type: string };

const CHECKS: Check[] = [
    { regex: /```([^\n]*)\n([\s\S]*?)```/, type: "codeblock" },
    { regex: /\*\*(.+?)\*\*/s, type: "bold"    },
    { regex: /~~(.+?)~~/s,     type: "strike"  },
    { regex: /\*(.+?)\*/s,     type: "italic"  },
    { regex: /`([^`\n]+)`/,   type: "code"    },
    { regex: /@(\w+)/,         type: "mention" },
    { regex: /https?:\/\/[^\s<]+/, type: "url" },
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
            const lang = match[1].trim();
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

        remaining = remaining.slice(earliest.index + consumedLength);
    }

    return nodes;
}

/* ── Shared row props ────────────────────────────────────── */

export interface MessageRowProps {
    m:            DisplayMessage;
    name:         string;
    myUsername:   string;
    isOwn:        boolean;
    canModerate:  boolean;
    senderColor?: string;
    isCont:       boolean;
    isPinned:     boolean;
    isNew:            boolean;
    enterDelayMs:     number;
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
    onUserClick:  (userId: number, event: React.MouseEvent) => void;
}
