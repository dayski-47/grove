import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import type { MessageListHandle } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { DisplayMessage } from "./MessageList";
import type { PinnedMessage } from "../types";

type EmojiMap     = Record<string, { count: number; byMe: boolean }>;
type ReactionsMap = Record<number, EmojiMap>;

interface ChatViewProps {
    channelId:    number;
    channelName:  string;
    isDm:         boolean;
    messages:     DisplayMessage[];
    usernames:    Record<number, string>;
    currentUserId: number;
    myUsername:   string;
    typingNames:  string[];
    connected:    boolean;
    hasMore:      boolean;
    loadingMore:  boolean;
    reactions:    ReactionsMap;
    pins:         PinnedMessage[];
    mentionUsers: { id: number; name: string }[];
    onSend:       (text: string) => void;
    onTyping:     () => void;
    onLoadMore:   () => void;
    onReact:      (msgId: number, emoji: string) => void;
    onEdit:       (msgId: number, text: string) => void;
    onDelete:     (msgId: number) => void;
    onPin:        (msgId: number) => void;
    onUnpin:      (msgId: number) => void;
    onUserClick:  (userId: number, event: React.MouseEvent) => void;
}

export function ChatView({
    channelId, channelName, isDm,
    messages, usernames, currentUserId, myUsername,
    typingNames, connected,
    hasMore, loadingMore,
    reactions, pins, mentionUsers,
    onSend, onTyping, onLoadMore,
    onReact, onEdit, onDelete, onPin, onUnpin,
    onUserClick,
}: ChatViewProps) {
    const scrollRef        = useRef<HTMLDivElement | null>(null);
    const messageListRef   = useRef<MessageListHandle>(null);
    const [showPill, setShowPill] = useState(false);
    const pinnedIds        = new Set(pins.map(p => p.message_id));
    const typingText       = buildTypingText(typingNames);

    function handleEditLastMessage() {
        const last = [...messages].reverse().find(
            m => m.userId === currentUserId && !m.deleted && m.id !== undefined,
        );
        if (last?.id !== undefined) {
            messageListRef.current?.startEdit(last.id, last.text);
        }
    }

    function handleScroll() {
        const el = scrollRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowPill(distFromBottom > 200);
    }

    function scrollToBottom() {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        setShowPill(false);
    }

    // Reset scroll pill when channel changes
    useEffect(() => { setShowPill(false); }, [channelId]);

    return (
        <div className="dw-chat">
            {/* Header */}
            <header className="dw-chat-header">
                <span className="dw-chat-prefix" aria-hidden="true">
                    {isDm ? "@" : "#"}
                </span>
                <h2 className="dw-chat-name">{channelName}</h2>
            </header>

            {/* Messages — keyed by channelId so refs/state reset on channel switch */}
            <MessageList
                key={channelId}
                ref={messageListRef}
                messages={messages}
                currentUserId={currentUserId}
                myUsername={myUsername}
                isDm={isDm}
                usernames={usernames}
                reactions={reactions}
                pinnedIds={pinnedIds}
                hasMore={hasMore}
                loadingMore={loadingMore}
                scrollRef={scrollRef}
                onScroll={handleScroll}
                onLoadMore={onLoadMore}
                onReact={onReact}
                onEdit={onEdit}
                onDelete={onDelete}
                onPin={onPin}
                onUnpin={onUnpin}
                onUserHover={onUserClick}
            />

            {/* Typing indicator */}
            <div className="dw-typing-bar" aria-live="polite" aria-atomic="true">
                {typingText && (
                    <>
                        <span className="dw-typing-dots" aria-hidden="true">
                            <span className="dw-typing-dot" />
                            <span className="dw-typing-dot" />
                            <span className="dw-typing-dot" />
                        </span>
                        <span>{typingText}</span>
                    </>
                )}
            </div>

            {/* Input */}
            <MessageInput
                onSend={onSend}
                onTyping={onTyping}
                disabled={!connected}
                channelName={channelName}
                mentionUsers={mentionUsers}
                onEditLastMessage={handleEditLastMessage}
            />

            {/* Scroll-to-bottom pill */}
            {showPill && (
                <button
                    className="dw-scroll-pill"
                    onClick={scrollToBottom}
                    aria-label="Scroll to latest messages"
                >
                    <ChevronDownIcon />
                    New messages
                </button>
            )}
        </div>
    );
}

function buildTypingText(names: string[]): string {
    if (names.length === 0) return "";
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return "Several people are typing…";
}

function ChevronDownIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
        </svg>
    );
}
