// src/components/MessageList.tsx
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface DisplayMessage {
    id?:       number;
    userId:    number;
    text:      string;
    timestamp: number;
    edited?:   boolean;
    deleted?:  boolean;
}

type ReactionInfo    = { count: number; byMe: boolean };
type ReactionsMap    = Record<number, Record<string, ReactionInfo>>;

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

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
        hour:   "2-digit",
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

interface MsgBodyProps {
    m:             DisplayMessage;
    isOwn:         boolean;
    name:          string;
    showMeta:      boolean;
    reactions:     Record<string, ReactionInfo> | undefined;
    editingId:     number | null;
    editText:      string;
    onEditChange:  (t: string) => void;
    onEditSubmit:  () => void;
    onEditCancel:  () => void;
    onStartEdit:   (id: number, text: string) => void;
    onDelete:      (id: number) => void;
    onReact:       (id: number, emoji: string) => void;
}

function MessageBody({
    m, isOwn, name, showMeta,
    reactions, editingId, editText,
    onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact,
}: MsgBodyProps) {
    const msgReactions = reactions ? Object.entries(reactions) : [];
    const isEditing    = m.id !== undefined && editingId === m.id;

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); onEditSubmit(); }
        if (e.key === "Escape") onEditCancel();
    };

    return (
        <div className="grove-msg-content-wrap">
            {showMeta && (
                <div className="grove-msg-meta">
                    <span className={`grove-msg-author${isOwn ? " own" : ""}`}>{name}</span>
                </div>
            )}

            <div className="grove-msg-text-row">
                {m.deleted ? (
                    <span className="grove-msg-deleted">[message deleted]</span>
                ) : isEditing ? (
                    <div className="grove-msg-edit-wrap">
                        <input
                            className="grove-msg-edit-input"
                            value={editText}
                            onChange={e => onEditChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                        <span className="grove-edit-hint">Enter to save · Esc to cancel</span>
                    </div>
                ) : (
                    <span className="grove-msg-text">{m.text}</span>
                )}
                {m.edited && !m.deleted && !isEditing && (
                    <span className="grove-edit-tag">(edited)</span>
                )}

                {isOwn && m.id !== undefined && !m.deleted && !isEditing && (
                    <div className="grove-msg-actions" aria-label="Message actions">
                        <button
                            className="grove-msg-action-btn"
                            title="Edit message"
                            onClick={() => onStartEdit(m.id!, m.text)}
                        >✏️</button>
                        <button
                            className="grove-msg-action-btn grove-msg-action-delete"
                            title="Delete message"
                            onClick={() => {
                                if (window.confirm("Delete this message?")) {
                                    onDelete(m.id!);
                                }
                            }}
                        >🗑️</button>
                    </div>
                )}
            </div>

            {msgReactions.length > 0 && (
                <div className="grove-reactions" aria-label="Reactions">
                    {msgReactions.map(([emoji, info]) => (
                        <button
                            key={emoji}
                            className={`grove-reaction-badge${info.byMe ? " active" : ""}`}
                            title={info.byMe ? `You reacted ${emoji}` : `React with ${emoji}`}
                            onClick={() => m.id !== undefined && onReact(m.id, emoji)}
                        >
                            {emoji} <span className="grove-reaction-count">{info.count}</span>
                        </button>
                    ))}
                </div>
            )}

            {m.id !== undefined && !m.deleted && (
                <div className="grove-reaction-picker" aria-label="Add reaction">
                    {QUICK_EMOJIS.map(emoji => (
                        <button
                            key={emoji}
                            className="grove-reaction-pick-btn"
                            title={`React with ${emoji}`}
                            onClick={() => onReact(m.id!, emoji)}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function MessageList({
    messages,
    currentUserId,
    usernames,
    reactions     = {},
    hasMore       = false,
    loadingMore   = false,
    onLoadMore,
    onReact,
    onEdit,
    onDelete,
    onUserHover,
}: {
    messages:       DisplayMessage[];
    currentUserId:  number;
    usernames:      Record<number, string>;
    reactions?:     ReactionsMap;
    hasMore?:       boolean;
    loadingMore?:   boolean;
    onLoadMore?:    () => void;
    onReact?:       (messageId: number, emoji: string) => void;
    onEdit?:        (messageId: number, newText: string) => void;
    onDelete?:      (messageId: number) => void;
    onUserHover?:   (userId: number, event: React.MouseEvent) => void;
}) {
    const bottomRef      = useRef<HTMLDivElement | null>(null);
    const prevLastTsRef  = useRef<number | null>(null);
    const [editingId,   setEditingId]   = useState<number | null>(null);
    const [editText,    setEditText]    = useState("");

    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last) return;
        if (last.timestamp !== prevLastTsRef.current) {
            prevLastTsRef.current = last.timestamp;
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    const handleStartEdit = (id: number, text: string) => {
        setEditingId(id);
        setEditText(text);
    };
    const handleEditSubmit = () => {
        if (editingId !== null && editText.trim()) {
            onEdit?.(editingId, editText.trim());
        }
        setEditingId(null);
    };
    const handleEditCancel = () => setEditingId(null);

    return (
        <div className="grove-messages" role="log" aria-live="polite" aria-label="Messages">
            {(hasMore || loadingMore) && (
                <div className="grove-load-more">
                    <button
                        className="grove-load-more-btn"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        aria-label="Load earlier messages"
                    >
                        {loadingMore ? "Loading…" : "↑ Load earlier messages"}
                    </button>
                </div>
            )}

            {messages.map((m, i) => {
                const prev   = i > 0 ? messages[i - 1] : null;
                const cont   = prev !== null && isContinuation(prev, m);
                const newDay = prev === null || !sameDay(prev, m);
                const name   = usernames[m.userId] ?? `user ${m.userId}`;
                const isOwn  = m.userId === currentUserId;
                const key    = `${m.id ?? m.timestamp}-${m.userId}-${i}`;
                const msgReactions   = m.id !== undefined ? reactions[m.id] : undefined;

                const bodyProps: MsgBodyProps = {
                    m,
                    isOwn,
                    name,
                    showMeta:     !cont,
                    reactions:    msgReactions,
                    editingId,
                    editText,
                    onEditChange: setEditText,
                    onEditSubmit: handleEditSubmit,
                    onEditCancel: handleEditCancel,
                    onStartEdit:  handleStartEdit,
                    onDelete:     (id) => onDelete?.(id),
                    onReact:      (id, emoji) => onReact?.(id, emoji),
                };

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
                                <MessageBody {...bodyProps} />
                            </div>
                        ) : (
                            <div className="grove-msg-row">
                                <button
                                    className="grove-avatar grove-avatar-btn"
                                    style={{ background: avatarColor(m.userId) }}
                                    onClick={e => onUserHover?.(m.userId, e)}
                                    aria-label={`View ${name}'s profile`}
                                >
                                    {initials(name)}
                                </button>
                                <div className="grove-msg-body">
                                    <div className="grove-msg-meta-row">
                                        <button
                                            className={`grove-msg-author grove-author-btn${isOwn ? " own" : ""}`}
                                            onClick={e => onUserHover?.(m.userId, e)}
                                            aria-label={`View ${name}'s profile`}
                                        >
                                            {name}
                                        </button>
                                        <span className="grove-msg-timestamp">
                                            {formatTime(m.timestamp)}
                                        </span>
                                    </div>
                                    <MessageBody {...bodyProps} showMeta={false} />
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
