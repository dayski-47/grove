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
import { MessageActions } from "./MessageRow/MessageActions";

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

/* ── Message row ─────────────────────────────────────────── */

interface MsgRowProps {
    m:             DisplayMessage;
    isOwn:         boolean;
    name:          string;
    myUsername:    string;
    isCont:        boolean;
    isPinned:      boolean;
    reactions:     Record<string, ReactionInfo> | undefined;
    editingId:     number | null;
    editText:      string;
    onEditChange:  (t: string) => void;
    onEditSubmit:  () => void;
    onEditCancel:  () => void;
    onStartEdit:   (id: number, text: string) => void;
    onDelete:      (id: number) => void;
    onReact:       (id: number, emoji: string) => void;
    onPin:         (id: number) => void;
    onUnpin:       (id: number) => void;
    onUserClick:   (event: React.MouseEvent) => void;
}

function MsgRow({
    m, isOwn, name, myUsername, isCont, isPinned,
    reactions, editingId, editText,
    onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin,
    onUserClick,
}: MsgRowProps) {
    const isEditing    = m.id !== undefined && editingId === m.id;
    const msgReactions = reactions ? Object.entries(reactions) : [];

    function handleEditKey(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter")  { e.preventDefault(); onEditSubmit(); }
        if (e.key === "Escape") onEditCancel();
    }

    const rowClass = ["dw-msg-row", isCont ? "cont" : "", isOwn ? "own" : ""].filter(Boolean).join(" ");

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
                        <button className={`dw-msg-author${isOwn ? " own" : ""}`} onClick={onUserClick} aria-label={`View ${name}'s profile`}>
                            {name}
                        </button>
                        <span className="dw-msg-time">{formatTime(m.timestamp)}</span>
                    </div>
                )}

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
            </div>

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
        </div>
    );
}

/* ── MessageList ─────────────────────────────────────────── */

export const MessageList = forwardRef<MessageListHandle, {
    messages:      DisplayMessage[];
    currentUserId: number;
    myUsername?:   string;
    usernames:     Record<number, string>;
    reactions?:    ReactionsMap;
    pinnedIds?:    Set<number>;
    hasMore?:      boolean;
    loadingMore?:  boolean;
    scrollRef?:    React.RefObject<HTMLDivElement | null>;
    onScroll?:     () => void;
    onLoadMore?:   () => void;
    onReact?:      (messageId: number, emoji: string) => void;
    onEdit?:       (messageId: number, newText: string) => void;
    onDelete?:     (messageId: number) => void;
    onPin?:        (messageId: number) => void;
    onUnpin?:      (messageId: number) => void;
    onUserHover?:  (userId: number, event: React.MouseEvent) => void;
}>(function MessageList({
    messages,
    currentUserId,
    myUsername   = "",
    usernames,
    reactions    = {},
    pinnedIds    = new Set(),
    hasMore      = false,
    loadingMore  = false,
    scrollRef,
    onScroll,
    onLoadMore,
    onReact,
    onEdit,
    onDelete,
    onPin,
    onUnpin,
    onUserHover,
}, ref) {
    const internalRef    = useRef<HTMLDivElement | null>(null);
    const listRef        = scrollRef ?? internalRef;
    const bottomRef      = useRef<HTMLDivElement | null>(null);
    const topSentinelRef = useRef<HTMLDivElement | null>(null);
    const prevLastTsRef  = useRef<number | null>(null);
    const prevFirstIdRef = useRef<number | undefined>(undefined);
    const prevScrollHRef = useRef(0);

    const hasMoreRef    = useRef(hasMore);
    const loadingRef    = useRef(loadingMore);
    const onLoadMoreRef = useRef(onLoadMore);
    hasMoreRef.current    = hasMore;
    loadingRef.current    = loadingMore;
    onLoadMoreRef.current = onLoadMore;

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText,  setEditText]  = useState("");

    useImperativeHandle(ref, () => ({
        startEdit: (id: number, text: string) => {
            setEditingId(id);
            setEditText(text);
        },
    }));

    /* Auto-scroll to bottom on new messages — only when near bottom */
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last || last.timestamp === prevLastTsRef.current) return;
        prevLastTsRef.current = last.timestamp;
        const el = listRef.current;
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 300;
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    /* Preserve scroll position when messages are prepended */
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const firstId = messages[0]?.id;
        if (prevFirstIdRef.current !== undefined && firstId !== prevFirstIdRef.current) {
            el.scrollTop += el.scrollHeight - prevScrollHRef.current;
        }
        prevFirstIdRef.current = firstId;
        prevScrollHRef.current = el.scrollHeight;
    }, [messages]);

    /* IntersectionObserver on top sentinel — auto-triggers load on scroll to top */
    useEffect(() => {
        const sentinel = topSentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
                    onLoadMoreRef.current?.();
                }
            },
            { threshold: 0 },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, []);

    function startEdit(id: number, text: string) { setEditingId(id); setEditText(text); }
    function submitEdit() {
        if (editingId !== null && editText.trim()) onEdit?.(editingId, editText.trim());
        setEditingId(null);
    }
    function cancelEdit() { setEditingId(null); }

    return (
        <div ref={listRef} className="dw-messages" role="log" aria-live="polite" aria-label="Messages" onScroll={onScroll}>
            <div ref={topSentinelRef} aria-hidden="true" />

            {loadingMore && (
                <div className="dw-load-more" aria-label="Loading earlier messages">
                    <span className="dw-load-dot" />
                    <span className="dw-load-dot" />
                    <span className="dw-load-dot" />
                </div>
            )}

            {!hasMore && !loadingMore && messages.length > 0 && (
                <div className="dw-history-start" aria-label="Beginning of conversation">
                    <div className="dw-history-start-line" />
                    <span>beginning of history</span>
                    <div className="dw-history-start-line" />
                </div>
            )}

            {messages.map((m, i) => {
                const prev   = i > 0 ? messages[i - 1] : null;
                const cont   = prev !== null && isContinuation(prev, m);
                const newDay = prev === null || !sameDay(prev, m);
                const name   = usernames[m.userId] ?? `user ${m.userId}`;
                const isOwn  = m.userId === currentUserId;
                const key    = `${m.id ?? m.timestamp}-${m.userId}-${i}`;
                const msgRx  = m.id !== undefined ? reactions[m.id] : undefined;
                const pinned = m.id !== undefined ? pinnedIds.has(m.id) : false;

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
            })}
            <div ref={bottomRef} />
        </div>
    );
});
