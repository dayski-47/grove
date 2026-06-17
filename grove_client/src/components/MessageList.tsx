// src/components/MessageList.tsx
import { Fragment, useEffect, useRef } from "react";

export interface DisplayMessage {
    userId:    number;
    text:      string;
    timestamp: number;
}

const AVATAR_COLORS = [
    "#1a7fd4", "#2d8a3c", "#7b52c8", "#c07828",
    "#1a9090", "#b03060", "#4a70b8", "#4a9060",
];

function avatarColor(userId: number): string {
    return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}

function initials(name: string): string {
    return name.slice(0, 1).toUpperCase();
}

function formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
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

export function MessageList({
    messages,
    currentUserId,
    usernames,
}: {
    messages:      DisplayMessage[];
    currentUserId: number;
    usernames:     Record<number, string>;
}) {
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="grove-messages" role="log" aria-live="polite" aria-label="Messages">
            {messages.map((m, i) => {
                const prev   = i > 0 ? messages[i - 1] : null;
                const cont   = prev !== null && isContinuation(prev, m);
                const newDay = prev === null || !sameDay(prev, m);
                const name   = usernames[m.userId] ?? `user ${m.userId}`;
                const isOwn  = m.userId === currentUserId;
                // stable key: timestamp + userId combination
                const key = `${m.timestamp}-${m.userId}-${i}`;

                return (
                    <Fragment key={key}>
                        {newDay && (
                            <div className="grove-day-divider" role="separator">
                                <span className="grove-day-label">{formatDay(m.timestamp)}</span>
                            </div>
                        )}
                        {cont ? (
                            <div className="grove-msg-row grove-cont">
                                <div className="grove-cont-spacer" aria-hidden="true">
                                    <span className="grove-cont-time">{formatTime(m.timestamp)}</span>
                                </div>
                                <div className="grove-msg-text">{m.text}</div>
                            </div>
                        ) : (
                            <div className="grove-msg-row">
                                <div
                                    className="grove-avatar"
                                    style={{ background: avatarColor(m.userId) }}
                                    aria-hidden="true"
                                >
                                    {initials(name)}
                                </div>
                                <div className="grove-msg-body">
                                    <div className="grove-msg-meta">
                                        <span className={`grove-msg-author${isOwn ? " own" : ""}`}>
                                            {name}
                                        </span>
                                        <span className="grove-msg-timestamp">
                                            {formatTime(m.timestamp)}
                                        </span>
                                    </div>
                                    <div className="grove-msg-text">{m.text}</div>
                                </div>
                            </div>
                        )}
                    </Fragment>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}
