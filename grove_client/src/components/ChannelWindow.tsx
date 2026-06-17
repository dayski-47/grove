// src/components/ChannelWindow.tsx
import { useEffect, useRef } from "react";
import { MessageList, type DisplayMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(partnerId: number): string {
    const c = AVATAR_COLORS[partnerId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

export function ChannelWindow({
    channelName,
    messages,
    usernames,
    currentUserId,
    typingNames,
    connected,
    x,
    y,
    zIndex,
    isDm,
    partnerId,
    onSend,
    onTyping,
    onClose,
    onFocus,
    onDrag,
}: {
    channelName:  string;
    messages:     DisplayMessage[];
    usernames:    Record<number, string>;
    currentUserId: number;
    typingNames:  string[];
    connected:    boolean;
    x:            number;
    y:            number;
    zIndex:       number;
    isDm?:        boolean;
    partnerId?:   number;
    onSend:       (text: string) => void;
    onTyping:     () => void;
    onClose:      () => void;
    onFocus:      () => void;
    onDrag:       (x: number, y: number) => void;
}) {
    const dragging = useRef(false);
    const offset   = useRef({ x: 0, y: 0 });

    function onChromeMouseDown(e: React.MouseEvent) {
        // Only drag on left-click, not on the control orbs
        if ((e.target as HTMLElement).closest(".grove-window-controls")) return;
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

    return (
        <div
            className="grove-window"
            style={{ left: x, top: y, zIndex }}
            onMouseDown={onFocus}
            role="dialog"
            aria-label={`Channel #${channelName}`}
        >
            {/* Vista titlebar */}
            <div
                className="grove-window-chrome"
                onMouseDown={onChromeMouseDown}
                role="banner"
            >
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
                    {/* Minimize — just closes for now (no dock) */}
                    <button
                        className="grove-window-orb grove-window-minimize"
                        onClick={onClose}
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

            {/* Message area */}
            <div className="grove-window-body">
                <MessageList
                    messages={messages}
                    currentUserId={currentUserId}
                    usernames={usernames}
                />

                {/* Typing indicator */}
                <div
                    className="grove-typing"
                    aria-live="polite"
                    aria-atomic="true"
                >
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
                />
            </div>
        </div>
    );
}
