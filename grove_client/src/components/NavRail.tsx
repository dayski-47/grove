import type { ActivityStatus } from "./ProfileMenu";

const AVATAR_COLORS = [
    "#1a5e2a", "#1a4a7d", "#5e1a5e", "#7d3a1a",
    "#1a6e6e", "#6e1a2a", "#2a4a7d", "#2a6e3a",
];

function avatarBg(uid: number): string {
    return AVATAR_COLORS[uid % AVATAR_COLORS.length];
}

type NavView = "channels" | "dms" | "friends";

interface NavRailProps {
    userId:       number;
    username:     string;
    status:       ActivityStatus;
    activeView:   NavView;
    dmUnread:     number;
    channelUnread: number;
    onView:       (v: NavView) => void;
    onAvatarClick: () => void;
}

export function NavRail({
    userId, username, status,
    activeView, dmUnread, channelUnread,
    onView, onAvatarClick,
}: NavRailProps) {
    const initial = username ? username[0].toUpperCase() : "?";

    return (
        <nav className="dw-nav" aria-label="Main navigation">
            {/* Grove leaf logo */}
            <div className="dw-nav-logo" aria-hidden="true">
                <LeafIcon />
            </div>

            {/* Channels */}
            <NavBtn
                label="Channels"
                active={activeView === "channels"}
                badge={channelUnread}
                onClick={() => onView("channels")}
            >
                <ChannelsIcon />
            </NavBtn>

            {/* DMs */}
            <NavBtn
                label="Direct Messages"
                active={activeView === "dms"}
                badge={dmUnread}
                onClick={() => onView("dms")}
            >
                <DmsIcon />
            </NavBtn>

            {/* Friends */}
            <NavBtn
                label="Friends"
                active={activeView === "friends"}
                onClick={() => onView("friends")}
            >
                <FriendsIcon />
            </NavBtn>

            <div className="dw-nav-spacer" />

            <div className="dw-nav-divider" aria-hidden="true" />

            {/* User avatar */}
            <button
                className="dw-nav-avatar"
                style={{ background: avatarBg(userId) }}
                onClick={onAvatarClick}
                aria-label={`Your profile — ${username}`}
                title={username}
            >
                {initial}
                <span
                    className={`dw-nav-status ${status === "offline" ? "offline" : "online"}`}
                    aria-hidden="true"
                />
            </button>
        </nav>
    );
}

function NavBtn({
    children, label, active, badge, onClick,
}: {
    children: React.ReactNode;
    label: string;
    active: boolean;
    badge?: number;
    onClick: () => void;
}) {
    return (
        <button
            className={`dw-nav-btn${active ? " active" : ""}`}
            onClick={onClick}
            aria-label={label + (badge ? `, ${badge} unread` : "")}
            aria-pressed={active}
            title={label}
        >
            {children}
            {badge ? (
                <span className="dw-nav-badge" aria-hidden="true">
                    {badge > 99 ? "99+" : badge}
                </span>
            ) : null}
        </button>
    );
}

/* ── Icons ─────────────────────────────────────────────── */

function LeafIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
    );
}

function ChannelsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
    );
}

function DmsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
        </svg>
    );
}

function FriendsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
    );
}
