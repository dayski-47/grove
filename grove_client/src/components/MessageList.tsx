import {
    forwardRef,
    Fragment,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { type ReactionsMap } from "./MessageRow/shared";
import { IncomingRow } from "./MessageRow/IncomingRow";
import { OutgoingRow } from "./MessageRow/OutgoingRow";

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
            })}
            <div ref={bottomRef} />
        </div>
    );
});
