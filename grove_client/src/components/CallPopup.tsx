// src/components/CallPopup.tsx
import { useEffect, useRef, useState } from "react";
import type { CallState } from "../useWebRTC";

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(userId: number): string {
    const c = AVATAR_COLORS[userId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

export function CallPopup({
    callState,
    remoteUserId,
    usernames,
    onAccept,
    onDecline,
    onHangup,
}: {
    callState:    CallState;
    remoteUserId: number | null;
    usernames:    Record<number, string>;
    onAccept:  () => void;
    onDecline: () => void;
    onHangup:  () => void;
}) {
    const name    = remoteUserId !== null ? (usernames[remoteUserId] ?? `user ${remoteUserId}`) : "…";
    const initial = name.slice(0, 1).toUpperCase();

    // Default: bottom-right corner, above taskbar
    const [pos, setPos] = useState({ x: window.innerWidth - 280, y: window.innerHeight - 420 });
    const dragging = useRef(false);
    const offset   = useRef({ x: 0, y: 0 });

    function onChromeMouseDown(e: React.MouseEvent) {
        dragging.current = true;
        offset.current   = { x: e.clientX - pos.x, y: e.clientY - pos.y };
        e.preventDefault();
    }

    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!dragging.current) return;
            setPos({
                x: Math.max(0, Math.min(window.innerWidth  - 248, e.clientX - offset.current.x)),
                y: Math.max(0, Math.min(window.innerHeight - 340, e.clientY - offset.current.y)),
            });
        }
        function onMouseUp() { dragging.current = false; }
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup",   onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup",   onMouseUp);
        };
    }, []);

    if (callState === "idle") return null;

    const label =
        callState === "ringing" ? "incoming call" :
        callState === "calling" ? "calling…"      :
        "in call";

    return (
        <div
            className="grove-call-popup"
            style={{ left: pos.x, top: pos.y }}
            role="dialog"
            aria-label={`${label} — ${name}`}
            aria-live="assertive"
        >
            {/* Drag handle */}
            <div className="grove-call-popup-chrome" onMouseDown={onChromeMouseDown}>
                <span className="grove-call-popup-label">{label}</span>
            </div>

            {/* Caller avatar orb */}
            <div
                className="grove-call-popup-avatar"
                style={{
                    background: remoteUserId !== null
                        ? avatarGradient(remoteUserId)
                        : "rgba(200,220,255,0.50)",
                }}
                aria-hidden="true"
            >
                {initial}
            </div>

            <span className="grove-call-popup-name">{name}</span>

            <span className="grove-call-popup-sub">
                {callState === "ringing" ? "is calling you" :
                 callState === "calling" ? "ringing…"       :
                 "connected"}
            </span>

            <div className="grove-call-popup-actions">
                {callState === "ringing" && (
                    <>
                        <button className="grove-popup-accept" onClick={onAccept} aria-label="Accept call">
                            Accept
                        </button>
                        <button className="grove-popup-decline" onClick={onDecline} aria-label="Decline call">
                            Decline
                        </button>
                    </>
                )}
                {(callState === "calling" || callState === "active") && (
                    <button className="grove-popup-hangup" onClick={onHangup} style={{ flex: 1 }} aria-label="Hang up">
                        Hang Up
                    </button>
                )}
            </div>
        </div>
    );
}
