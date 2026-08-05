import type { FriendInfo } from "../../types";
import { avatarBg, avatarInitial } from "../../lib/avatar";
import { MsgIcon, PhoneIcon, RemoveIcon } from "./icons";

export function FriendsPage({
    friends, onlineFriends,
    tab, onTab, showAdd, addFriendId, onAddFriendId,
    onToggleAdd, onAddFriend, onRemoveFriend,
    onDm, onCall, onUserClick,
}: {
    friends: FriendInfo[];
    onlineFriends: FriendInfo[];
    tab: "online" | "all";
    onTab: (t: "online" | "all") => void;
    showAdd: boolean;
    addFriendId: string;
    onAddFriendId: (s: string) => void;
    onToggleAdd: () => void;
    onAddFriend: () => void;
    onRemoveFriend: (id: number) => void;
    onDm: (uid: number) => void;
    onCall: (uid: number) => void;
    onUserClick: (uid: number) => void;
}) {
    const displayed = tab === "online" ? onlineFriends : friends;

    return (
        <div className="dw-friends">
            <header className="dw-friends-header">
                <span className="dw-friends-title">Friends</span>
                <button className={`dw-tab${tab === "online" ? " active" : ""}`} onClick={() => onTab("online")}>
                    Online <span style={{ color: "var(--leaf-bright)" }}>{onlineFriends.length}</span>
                </button>
                <button className={`dw-tab${tab === "all" ? " active" : ""}`} onClick={() => onTab("all")}>
                    All
                </button>
                <button className="dw-friends-add-btn" onClick={onToggleAdd}>
                    {showAdd ? "Cancel" : "+ Add friend"}
                </button>
            </header>

            <div className="dw-friends-body">
                {showAdd && (
                    <div className="dw-add-bar">
                        <input
                            className="dw-add-input"
                            placeholder="Username"
                            value={addFriendId}
                            onChange={e => onAddFriendId(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && onAddFriend()}
                            autoFocus
                        />
                        <button className="dw-add-btn" onClick={onAddFriend}>Add</button>
                    </div>
                )}

                {displayed.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", paddingTop: "24px" }}>
                        {tab === "online" ? "No friends online." : "No friends yet."}
                    </div>
                ) : displayed.map(f => (
                    <FriendRow
                        key={f.user_id}
                        f={f}
                        onDm={onDm}
                        onCall={onCall}
                        onRemove={onRemoveFriend}
                        onClick={() => onUserClick(f.user_id)}
                    />
                ))}
            </div>
        </div>
    );
}

function FriendRow({ f, onDm, onCall, onRemove, onClick }: {
    f: FriendInfo;
    onDm: (id: number) => void;
    onCall: (id: number) => void;
    onRemove: (id: number) => void;
    onClick: () => void;
}) {
    const bg      = avatarBg(f.user_id);
    const initial = avatarInitial(f.username);
    return (
        <div className="dw-fp-row">
            <button className="dw-fp-avatar" style={{ background: bg }} onClick={onClick}>
                {initial}
                <span className={`dw-fp-dot ${f.online ? "online" : "offline"}`} />
            </button>
            <div className="dw-fp-info">
                <div className="dw-fp-name">{f.username}</div>
                <div className="dw-fp-status">{f.online ? "Online" : "Offline"}</div>
            </div>
            <div className="dw-fp-actions">
                <button className="dw-icon-btn" onClick={() => onDm(f.user_id)} title="Message"><MsgIcon /></button>
                <button className="dw-icon-btn" onClick={() => onCall(f.user_id)} title="Call"><PhoneIcon /></button>
                <button className="dw-icon-btn" onClick={() => onRemove(f.user_id)} title="Remove"><RemoveIcon /></button>
            </div>
        </div>
    );
}
