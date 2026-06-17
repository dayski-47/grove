// src/components/DmsWindow.tsx
import { useEffect, useRef } from "react";
import type { DmInfo } from "../types";

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(userId: number): string {
    const c = AVATAR_COLORS[userId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

export function DmsWindow({
    dms,
    onlineUsers,
    openChannelIds,
    x,
    y,
    zIndex,
    onOpen,
    onClose,
    onFocus,
    onDrag,
}: {
    dms:            DmInfo[];
    onlineUsers:    Set<number>;
    openChannelIds: Set<number>;
    x:              number;
    y:              number;
    zIndex:         number;
    onOpen:         (channelId: number, partnerName: string, partnerId: number) => void;
    onClose:        () => void;
    onFocus:        () => void;
    onDrag:         (x: number, y: number) => void;
}) {
    const dragging = useRef(false);
    const offset   = useRef({ x: 0, y: 0 });

    function onChromeMouseDown(e: React.MouseEvent) {
        if ((e.target as HTMLElement).closest(".grove-window-controls")) return;
        dragging.current = true;
        offset.current   = { x: e.clientX - x, y: e.clientY - y };
        onFocus();
        e.preventDefault();
    }

    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!dragging.current) return;
            const nx = Math.max(0, Math.min(window.innerWidth  - 380, e.clientX - offset.current.x));
            const ny = Math.max(0, Math.min(window.innerHeight - 520, e.clientY - offset.current.y));
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
            className="grove-window grove-list-window"
            style={{ left: x, top: y, zIndex, width: 360, height: 480 }}
            onMouseDown={onFocus}
            role="dialog"
            aria-label="Direct Messages"
        >
            <div className="grove-window-chrome" onMouseDown={onChromeMouseDown}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="grove-window-list-icon" aria-hidden="true">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                </svg>
                <span className="grove-window-title">Messages</span>
                <div className="grove-window-controls">
                    <button className="grove-window-orb grove-window-close" onClick={onClose} aria-label="Close" />
                </div>
            </div>

            <div className="grove-list-body">
                <div className="grove-list-scroll" role="list">
                    {dms.length === 0 && (
                        <p className="grove-list-empty">No conversations yet. Start one from your Friends list!</p>
                    )}
                    {dms.map(dm => {
                        const isOpen   = openChannelIds.has(dm.channel_id);
                        const isOnline = onlineUsers.has(dm.partner_id);
                        return (
                            <button
                                key={dm.channel_id}
                                className={`grove-list-row grove-dm-row${isOpen ? " grove-list-row-open" : ""}`}
                                onClick={() => onOpen(dm.channel_id, dm.partner_name, dm.partner_id)}
                                role="listitem"
                                aria-label={`Message ${dm.partner_name}`}
                            >
                                <div
                                    className="grove-dm-avatar"
                                    style={{ background: avatarGradient(dm.partner_id) }}
                                    aria-hidden="true"
                                >
                                    {dm.partner_name.slice(0, 1).toUpperCase()}
                                    <span className={`grove-friend-dot${isOnline ? "" : " offline"}`} />
                                </div>
                                <div className="grove-dm-info">
                                    <span className="grove-dm-name">{dm.partner_name}</span>
                                    <span className="grove-dm-status">{isOnline ? "online" : "offline"}</span>
                                </div>
                                {isOpen && <span className="grove-list-row-badge" aria-label="open">•</span>}
                            </button>
                        );
                    })}
                </div>

                <div className="grove-list-footer grove-list-footer-info">
                    <span className="grove-list-footer-hint">Open a friend's profile to start a conversation</span>
                </div>
            </div>
        </div>
    );
}
