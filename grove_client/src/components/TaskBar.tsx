// src/components/TaskBar.tsx
import { type ReactNode, useEffect, useState } from "react";

const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function useClock() {
    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return now;
}

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(userId: number): string {
    const c = AVATAR_COLORS[userId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

export function TaskBar({
    userId,
    username,
    connected,
    onlineUsers,
    usernames,
    onCall,
    onDm,
    onLogout,
    profileSlot,
}: {
    userId:       number;
    username:     string;
    connected:    boolean;
    onlineUsers:  Set<number>;
    usernames:    Record<number, string>;
    onCall:       (targetId: number) => void;
    onDm:         (targetId: number) => void;
    onLogout:     () => void;
    profileSlot?: ReactNode;
}) {
    const now  = useClock();
    const [showOnline, setShowOnline] = useState(false);

    const hh  = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const day  = DAYS[now.getDay()];
    const date = `${day}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
    const initial = username.slice(0, 1).toUpperCase();

    // Others online (exclude self)
    const others = [...onlineUsers].filter(id => id !== userId);

    return (
        <>
            {/* Online panel — shown above taskbar when avatar is clicked */}
            {showOnline && others.length > 0 && (
                <div className="grove-online-panel" role="menu" aria-label="Online users">
                    <div className="grove-online-panel-title">online now</div>
                    {others.map(uid => (
                        <div key={uid} className="grove-online-panel-row" role="menuitem">
                            <div className="grove-online-panel-dot" aria-hidden="true" />
                            <span className="grove-online-panel-name">
                                {usernames[uid] ?? `user ${uid}`}
                            </span>
                            <button
                                className="grove-online-panel-call"
                                onClick={() => { onDm(uid); setShowOnline(false); }}
                                aria-label={`Message ${usernames[uid] ?? uid}`}
                                title="Send message"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                </svg>
                            </button>
                            <button
                                className="grove-online-panel-call"
                                onClick={() => { onCall(uid); setShowOnline(false); }}
                                aria-label={`Call ${usernames[uid] ?? uid}`}
                                title="Voice call"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.59 3.47 2 2 0 0 1 3.56 1.29h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.5 16"/>
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <nav className="grove-taskbar" aria-label="Application taskbar">
                {/* Left: profile slot (ProfileMenu) or plain avatar fallback */}
                <div className="grove-taskbar-profile-wrap">
                    {profileSlot ?? (
                        <button
                            className="grove-taskbar-profile"
                            onClick={() => setShowOnline(v => !v)}
                            aria-label={`${username} — ${others.length} online. Click to see who's here.`}
                            aria-expanded={showOnline}
                        >
                            <div
                                className="grove-taskbar-avatar"
                                style={{ background: avatarGradient(userId) }}
                                aria-hidden="true"
                            >
                                {initial}
                                <span className={`grove-taskbar-status${connected ? "" : " offline"}`} />
                            </div>
                            <div className="grove-taskbar-info">
                                <span className="grove-taskbar-name">{username}</span>
                                <span className="grove-taskbar-tag">
                                    {connected ? `${others.length} online` : "connecting…"}
                                </span>
                            </div>
                        </button>
                    )}
                </div>

                {/* Center: live clock */}
                <div className="grove-taskbar-clock" aria-live="off">
                    <span className="grove-taskbar-time">{hh}</span>
                    <span className="grove-taskbar-date">{date}</span>
                </div>

                {/* Right: logout */}
                <div className="grove-taskbar-right">
                    <button
                        className="grove-taskbar-logout"
                        onClick={onLogout}
                        aria-label="Sign out"
                    >
                        sign out
                    </button>
                </div>
            </nav>
        </>
    );
}
