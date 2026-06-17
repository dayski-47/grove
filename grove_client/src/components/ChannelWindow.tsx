// src/components/ChannelWindow.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageList, type DisplayMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { PinnedMessage } from "../types";

type ReactionsMap = Record<number, Record<string, { count: number; byMe: boolean }>>;

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(partnerId: number): string {
    const c = AVATAR_COLORS[partnerId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

function relativeTime(ts: number): string {
    const delta = Math.floor(Date.now() / 1000) - ts;
    if (delta < 60)    return "just now";
    if (delta < 3600)  return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return new Date(ts * 1000).toLocaleDateString();
}

/* Derive a HSL hue from channelId using golden angle spread */
function channelHue(id: number): number {
    return (id * 137) % 360;
}

/* Convert HSL hue to an approximate RGB triplet for CSS custom property */
function hslToRgb(h: number, s = 0.65, l = 0.52): [number, number, number] {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
    };
    return [f(0), f(8), f(4)];
}

export function ChannelWindow({
    channelId,
    channelName,
    messages,
    usernames,
    currentUserId,
    myUsername,
    typingNames,
    connected,
    x,
    y,
    zIndex,
    isDm,
    partnerId,
    hasMore,
    loadingMore,
    reactions,
    pins          = [],
    mentionUsers  = [],
    onSend,
    onTyping,
    onClose,
    onMinimize,
    onFocus,
    onDrag,
    onLoadMore,
    onReact,
    onEdit,
    onDelete,
    onPin,
    onUnpin,
    onUserHover,
}: {
    channelId:     number;
    channelName:   string;
    messages:      DisplayMessage[];
    usernames:     Record<number, string>;
    currentUserId: number;
    myUsername:    string;
    typingNames:   string[];
    connected:     boolean;
    x:             number;
    y:             number;
    zIndex:        number;
    isDm?:         boolean;
    partnerId?:    number;
    hasMore?:      boolean;
    loadingMore?:  boolean;
    reactions?:    ReactionsMap;
    pins?:         PinnedMessage[];
    mentionUsers?: { id: number; name: string }[];
    onSend:        (text: string) => void;
    onTyping:      () => void;
    onClose:       () => void;
    onMinimize?:   () => void;
    onFocus:       () => void;
    onDrag:        (x: number, y: number) => void;
    onLoadMore?:   () => void;
    onReact?:      (messageId: number, emoji: string) => void;
    onEdit?:       (messageId: number, newText: string) => void;
    onDelete?:     (messageId: number) => void;
    onPin?:        (messageId: number) => void;
    onUnpin?:      (messageId: number) => void;
    onUserHover?:  (userId: number, event: React.MouseEvent) => void;
}) {
    const dragging   = useRef(false);
    const offset     = useRef({ x: 0, y: 0 });
    const [searchOpen,  setSearchOpen]  = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const [showScrollPill, setShowScrollPill] = useState(false);

    /* Per-channel accent color injected as CSS custom properties */
    const hue = channelHue(channelId);
    const [r, g, b] = hslToRgb(hue);
    const accentStyle = {
        "--channel-accent": String(hue),
        "--channel-accent-rgb": `${r},${g},${b}`,
    } as React.CSSProperties;

    function onChromeMouseDown(e: React.MouseEvent) {
        if ((e.target as HTMLElement).closest(".grove-window-controls")) return;
        if ((e.target as HTMLElement).closest(".grove-window-search-btn")) return;
        dragging.current = true;
        offset.current   = { x: e.clientX - x, y: e.clientY - y };
        onFocus();
        e.preventDefault();
    }

    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!dragging.current) return;
            const nx = Math.max(0, Math.min(window.innerWidth  - 520, e.clientX - offset.current.x));
            const ny = Math.max(0, Math.min(window.innerHeight - 630, e.clientY - offset.current.y));
            onDrag(nx, ny);
        }
        function onMouseUp() { dragging.current = false; }
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup",   onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup",   onMouseUp);
        };
    }, [onDrag]);

    /* Scroll-to-bottom pill: show when scrolled up > 120px from bottom */
    const handleScroll = useCallback(() => {
        const el = messagesRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowScrollPill(distFromBottom > 120);
    }, []);

    const scrollToBottom = useCallback(() => {
        const el = messagesRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, []);

    // Focus search input when opened
    useEffect(() => {
        if (searchOpen) setTimeout(() => searchRef.current?.focus(), 40);
        else setSearchQuery("");
    }, [searchOpen]);

    const pinnedIds = new Set(pins.map(p => p.message_id));
    const latestPin = pins[0] ?? null;

    const filteredMessages = searchQuery.trim()
        ? messages.filter(m => m.text.toLowerCase().includes(searchQuery.toLowerCase()))
        : messages;

    return (
        <div
            className="grove-window"
            style={{ left: x, top: y, zIndex, ...accentStyle }}
            onMouseDown={onFocus}
            role="dialog"
            aria-label={`Channel #${channelName}`}
        >
            <div className="grove-window-chrome" onMouseDown={onChromeMouseDown} role="banner">
                {isDm && partnerId !== undefined ? (
                    <div
                        className="grove-window-dm-orb"
                        style={{ background: avatarGradient(partnerId) }}
                        aria-hidden="true"
                    >
                        {channelName.slice(0, 1).toUpperCase()}
                    </div>
                ) : (
                    <span className="grove-window-hash" aria-hidden="true">#</span>
                )}
                <span className="grove-window-title">{channelName}</span>

                <div className="grove-window-controls">
                    {/* Search toggle */}
                    <button
                        className={`grove-window-search-btn${searchOpen ? " active" : ""}`}
                        onClick={() => setSearchOpen(v => !v)}
                        title="Search messages"
                        aria-label="Toggle message search"
                        aria-pressed={searchOpen}
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </button>
                    <button
                        className="grove-window-orb grove-window-minimize"
                        onClick={onMinimize ?? onClose}
                        aria-label="Minimize"
                        title="Minimize"
                    />
                    <button
                        className="grove-window-orb grove-window-close"
                        onClick={onClose}
                        aria-label="Close"
                        title="Close"
                    />
                </div>
            </div>

            {/* Search bar */}
            {searchOpen && (
                <div className="grove-channel-search-bar" role="search">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                        ref={searchRef}
                        className="grove-channel-search-input"
                        placeholder="Search messages…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && setSearchOpen(false)}
                        aria-label="Search in channel"
                    />
                    {searchQuery && (
                        <span className="grove-search-count" aria-live="polite">
                            {filteredMessages.length} result{filteredMessages.length !== 1 ? "s" : ""}
                        </span>
                    )}
                    <button
                        className="grove-search-close"
                        onClick={() => setSearchOpen(false)}
                        aria-label="Close search"
                    >✕</button>
                </div>
            )}

            {/* Pinned message banner */}
            {latestPin && !latestPin.text === false && latestPin.text && (
                <div className="grove-pin-banner" role="note" aria-label="Pinned message">
                    <span className="grove-pin-banner-icon" aria-hidden="true">📌</span>
                    <div className="grove-pin-banner-content">
                        <span className="grove-pin-banner-who">{latestPin.username}</span>
                        <span className="grove-pin-banner-text">{latestPin.text}</span>
                    </div>
                    <span className="grove-pin-banner-age">{relativeTime(latestPin.pinned_at)}</span>
                    <button
                        className="grove-pin-banner-unpin"
                        onClick={() => onUnpin?.(latestPin.message_id)}
                        title="Unpin"
                        aria-label="Unpin this message"
                    >✕</button>
                </div>
            )}

            <div className="grove-window-body">
                <div className="grove-messages-wrap">
                    <MessageList
                        messages={filteredMessages}
                        currentUserId={currentUserId}
                        myUsername={myUsername}
                        usernames={usernames}
                        reactions={reactions}
                        pinnedIds={pinnedIds}
                        hasMore={!searchQuery && hasMore}
                        loadingMore={loadingMore}
                        scrollRef={messagesRef}
                        onScroll={handleScroll}
                        onLoadMore={onLoadMore}
                        onReact={onReact}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onPin={onPin}
                        onUnpin={onUnpin}
                        onUserHover={onUserHover}
                    />

                    {showScrollPill && (
                        <button
                            className="grove-scroll-pill"
                            onClick={scrollToBottom}
                            aria-label="Scroll to latest messages"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                            Latest
                        </button>
                    )}
                </div>

                <div className="grove-typing" aria-live="polite" aria-atomic="true">
                    {typingNames.length > 0 && (
                        <>
                            <span>
                                {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing
                            </span>
                            <span className="grove-typing-dots" aria-hidden="true">
                                <span /><span /><span />
                            </span>
                        </>
                    )}
                </div>

                <MessageInput
                    onSend={onSend}
                    onTyping={onTyping}
                    disabled={!connected}
                    mentionUsers={mentionUsers}
                />
            </div>
        </div>
    );
}
