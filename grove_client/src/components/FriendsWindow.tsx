// src/components/FriendsWindow.tsx
import { useEffect, useRef, useState } from "react";
import type { FriendInfo, UserProfile } from "../types";
import { searchUsers } from "../api";

const AVATAR_COLORS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

function avatarGradient(userId: number): string {
    const c = AVATAR_COLORS[userId % AVATAR_COLORS.length];
    return `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, ${c} 45%, ${c}cc 100%)`;
}

export function FriendsWindow({
    friends,
    token,
    x,
    y,
    zIndex,
    onClose,
    onFocus,
    onDrag,
    onDm,
    onCall,
    onAddFriend,
}: {
    friends:      FriendInfo[];
    token:        string;
    x:            number;
    y:            number;
    zIndex:       number;
    onClose:      () => void;
    onFocus:      () => void;
    onDrag:       (x: number, y: number) => void;
    onDm:         (userId: number) => void;
    onCall:       (userId: number) => void;
    onAddFriend:  (userId: number) => void;
}) {
    const [query,        setQuery]        = useState("");
    const [results,      setResults]      = useState<UserProfile[]>([]);
    const [searching,    setSearching]    = useState(false);
    const [addError,     setAddError]     = useState("");
    const [addedIds,     setAddedIds]     = useState<Set<number>>(new Set());
    const searchTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    function handleQueryChange(value: string) {
        setQuery(value);
        setAddError("");
        if (searchTimer.current) clearTimeout(searchTimer.current);
        if (!value.trim()) { setResults([]); return; }
        searchTimer.current = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await searchUsers(value.trim(), token);
                setResults(res);
            } catch { setResults([]); }
            finally { setSearching(false); }
        }, 300);
    }

    function handleAdd(profile: UserProfile) {
        const alreadyFriend = friends.some(f => f.user_id === profile.id);
        if (alreadyFriend) { setAddError("Already friends!"); return; }
        onAddFriend(profile.id);
        setAddedIds(prev => new Set([...prev, profile.id]));
        setAddError("");
    }

    const online  = friends.filter(f => f.online);
    const offline = friends.filter(f => !f.online);

    return (
        <div
            className="grove-window grove-list-window"
            style={{ left: x, top: y, zIndex, width: 360, height: 520 }}
            onMouseDown={onFocus}
            role="dialog"
            aria-label="Friends"
        >
            <div className="grove-window-chrome" onMouseDown={onChromeMouseDown}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="grove-window-list-icon" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span className="grove-window-title">Friends</span>
                <div className="grove-window-controls">
                    <button className="grove-window-orb grove-window-close" onClick={onClose} aria-label="Close" />
                </div>
            </div>

            <div className="grove-list-body">
                {/* Friend search + add */}
                <div className="grove-friends-search-wrap">
                    <input
                        className="grove-input grove-friends-search"
                        placeholder="Search by username…"
                        value={query}
                        onChange={e => handleQueryChange(e.target.value)}
                        aria-label="Search users to add"
                    />
                    {searching && <span className="grove-friends-searching">searching…</span>}

                    {results.length > 0 && query.trim() && (
                        <div className="grove-friends-results" role="listbox">
                            {results.map(r => {
                                const alreadyFriend = friends.some(f => f.user_id === r.id);
                                const added         = addedIds.has(r.id);
                                return (
                                    <div key={r.id} className="grove-friends-result-row" role="option">
                                        <div
                                            className="grove-friend-avatar"
                                            style={{ background: avatarGradient(r.id) }}
                                            aria-hidden="true"
                                        >
                                            {r.username.slice(0, 1).toUpperCase()}
                                        </div>
                                        <span className="grove-friends-result-name">{r.username}</span>
                                        <button
                                            className="grove-btn-primary grove-btn-sm"
                                            onClick={() => handleAdd(r)}
                                            disabled={alreadyFriend || added}
                                            aria-label={alreadyFriend ? "Already friends" : `Add ${r.username}`}
                                        >
                                            {alreadyFriend || added ? "✓" : "Add"}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {addError && <p className="grove-list-footer-error">{addError}</p>}
                </div>

                <div className="grove-list-scroll" role="list">
                    {online.length > 0 && (
                        <div className="grove-list-section-label">Online — {online.length}</div>
                    )}
                    {online.map(f => (
                        <FriendRow key={f.user_id} friend={f} gradient={avatarGradient(f.user_id)} onDm={onDm} onCall={onCall} />
                    ))}
                    {offline.length > 0 && (
                        <div className="grove-list-section-label">Offline — {offline.length}</div>
                    )}
                    {offline.map(f => (
                        <FriendRow key={f.user_id} friend={f} gradient={avatarGradient(f.user_id)} onDm={onDm} onCall={onCall} />
                    ))}
                    {friends.length === 0 && !query && (
                        <p className="grove-list-empty">No friends yet. Search for someone above!</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function FriendRow({
    friend,
    gradient,
    onDm,
    onCall,
}: {
    friend:   FriendInfo;
    gradient: string;
    onDm:     (id: number) => void;
    onCall:   (id: number) => void;
}) {
    return (
        <div className="grove-list-row grove-friend-row" role="listitem">
            <div className="grove-friend-avatar" style={{ background: gradient }} aria-hidden="true">
                {friend.username.slice(0, 1).toUpperCase()}
                <span className={`grove-friend-dot${friend.online ? "" : " offline"}`} />
            </div>
            <span className="grove-list-row-name">{friend.username}</span>
            <span className="grove-friend-status">{friend.online ? "online" : "offline"}</span>
            <div className="grove-friend-actions">
                <button
                    className="grove-friend-action-btn"
                    onClick={() => onDm(friend.user_id)}
                    aria-label={`Message ${friend.username}`}
                    title="Message"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>
                {friend.online && (
                    <button
                        className="grove-friend-action-btn"
                        onClick={() => onCall(friend.user_id)}
                        aria-label={`Call ${friend.username}`}
                        title="Voice call"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.59 3.47 2 2 0 0 1 3.56 1.29h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.5 16"/>
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
