// src/components/UserPopover.tsx
import type { UserProfile } from "../types";

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function relativeTime(unixTs: number): string {
    if (!unixTs) return "never";
    const delta = Math.floor(Date.now() / 1000) - unixTs;
    if (delta < 60)      return "just now";
    if (delta < 3600)    return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400)   return `${Math.floor(delta / 3600)}h ago`;
    if (delta < 2592000) return `${Math.floor(delta / 86400)}d ago`;
    return new Date(unixTs * 1000).toLocaleDateString();
}

export function UserPopover({
    profile,
    isOnline,
    customStatus = "",
    anchorX,
    anchorY,
    currentUserId,
    onDm,
    onCall,
    onClose,
}: {
    profile:       UserProfile;
    isOnline:      boolean;
    customStatus?: string;
    anchorX:       number;
    anchorY:       number;
    currentUserId: number;
    onDm:          (userId: number) => void;
    onCall:        (userId: number) => void;
    onClose:       () => void;
}) {
    const color   = AVATAR_COLORS[profile.id % AVATAR_COLORS.length];
    const initial = profile.username.slice(0, 1).toUpperCase();
    const isSelf  = profile.id === currentUserId;

    // Keep popover within viewport
    const left = Math.min(anchorX, window.innerWidth  - 260);
    const top  = Math.min(anchorY, window.innerHeight - 220);

    return (
        <div
            className="grove-user-popover"
            style={{ left, top }}
            role="dialog"
            aria-label={`${profile.username}'s profile`}
            onMouseLeave={onClose}
        >
            {/* Header banner */}
            <div
                className="grove-popover-banner"
                style={{ background: `linear-gradient(135deg, ${color}88, ${color}44)` }}
            />

            {/* Avatar */}
            <div
                className="grove-popover-avatar"
                style={{
                    background: `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${color} 45%, ${color}cc 100%)`,
                }}
                aria-hidden="true"
            >
                {initial}
                <span className={`grove-popover-status-dot${isOnline ? "" : " offline"}`} />
            </div>

            <div className="grove-popover-body">
                <div className="grove-popover-name">{profile.username}</div>
                <div className={`grove-popover-online${isOnline ? "" : " offline"}`}>
                    {isOnline ? "Online now" : `Last seen ${relativeTime(profile.last_seen)}`}
                </div>
                {customStatus && (
                    <div className="grove-popover-custom-status">{customStatus}</div>
                )}

                {profile.about && (
                    <div className="grove-popover-about">{profile.about}</div>
                )}

                {!isSelf && (
                    <div className="grove-popover-actions">
                        <button
                            className="grove-popover-action-btn"
                            onClick={() => { onDm(profile.id); onClose(); }}
                            title="Send message"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            Message
                        </button>
                        {isOnline && (
                            <button
                                className="grove-popover-action-btn"
                                onClick={() => { onCall(profile.id); onClose(); }}
                                title="Voice call"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.59 3.47 2 2 0 0 1 3.56 1.29h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.5 16"/>
                                </svg>
                                Call
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
