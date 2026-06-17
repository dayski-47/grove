// src/components/ChannelSidebar.tsx
import { useState } from "react";

export interface Channel {
    id:   number;
    name: string;
}

function PhoneIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.56 3.28 2 2 0 0 1 3.53 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.5a16 16 0 0 0 5.59 5.59l.88-.88a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

export function ChannelSidebar({
    currentChannel,
    channels,
    onSelectChannel,
    onCreateChannel,
    onLogout,
    connected,
    onlineUsers,
    currentUserId,
    usernames,
    onCall,
}: {
    currentChannel:  number | null;
    channels:        Channel[];
    onSelectChannel: (id: number) => void;
    onCreateChannel: (name: string) => void;
    onLogout:        () => void;
    connected:       boolean;
    onlineUsers:     Set<number>;
    currentUserId:   number;
    usernames:       Record<number, string>;
    onCall:          (userId: number) => void;
}) {
    const [newName, setNewName] = useState("");
    const otherOnline = [...onlineUsers].filter((id) => id !== currentUserId);

    function submitNew() {
        const name = newName.trim();
        if (!name) return;
        onCreateChannel(name);
        setNewName("");
    }

    return (
        <aside className="grove-sidebar" aria-label="Sidebar">
            <div className="grove-sidebar-header">
                <span className="grove-app-icon" aria-hidden="true">❦</span>
                <span className="grove-app-name">Grove</span>
                <span
                    className={`grove-conn-dot ${connected ? "online" : "offline"}`}
                    title={connected ? "Connected" : "Disconnected"}
                    role="status"
                    aria-label={connected ? "Connected" : "Disconnected"}
                />
            </div>

            <div className="grove-sidebar-scroll">
                <div className="grove-section-label" id="channels-label">Channels</div>
                <div className="grove-channels-list" role="list" aria-labelledby="channels-label">
                    {channels.map((ch) => (
                        <button
                            key={ch.id}
                            role="listitem"
                            className={`grove-channel-btn${ch.id === currentChannel ? " active" : ""}`}
                            onClick={() => onSelectChannel(ch.id)}
                            aria-current={ch.id === currentChannel ? "true" : undefined}
                        >
                            <span className="grove-channel-hash" aria-hidden="true">#</span>
                            <span>{ch.name}</span>
                        </button>
                    ))}
                </div>

                {otherOnline.length > 0 && (
                    <>
                        <div className="grove-sidebar-divider" role="separator" />
                        <div className="grove-section-label" id="online-label">
                            Online — {otherOnline.length}
                        </div>
                        <div className="grove-online-list" role="list" aria-labelledby="online-label">
                            {otherOnline.map((uid) => (
                                <div key={uid} className="grove-online-row" role="listitem">
                                    <span className="grove-user-dot" aria-hidden="true" />
                                    <span className="grove-user-name">
                                        {usernames[uid] ?? `user ${uid}`}
                                    </span>
                                    <button
                                        className="grove-call-btn"
                                        onClick={() => onCall(uid)}
                                        aria-label={`Call ${usernames[uid] ?? `user ${uid}`}`}
                                    >
                                        <PhoneIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="grove-sidebar-bottom">
                <div className="grove-new-channel">
                    <input
                        className="grove-input-small"
                        placeholder="new channel…"
                        value={newName}
                        aria-label="New channel name"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submitNew(); }}
                    />
                    <button
                        className="grove-button-small"
                        onClick={submitNew}
                        aria-label="Create channel"
                    >
                        +
                    </button>
                </div>
                <button className="grove-logout" onClick={onLogout}>
                    leave grove
                </button>
            </div>
        </aside>
    );
}
