import { useState } from "react";
import type { UserProfile } from "../../types";
import type { ActivityStatus } from "../ProfileMenu";
import { avatarBg, avatarInitial } from "../../lib/avatar";
import { CloseIcon } from "./icons";

export function ProfileDrawer({
    uid, isSelf, profile, username, isOnline,
    myStatus, myAbout,
    onClose, onDm, onCall, onStatusChange, onLogout, onDeleteAccount,
}: {
    uid:             number;
    isSelf:          boolean;
    profile:         UserProfile | undefined;
    username:        string;
    isOnline:        boolean;
    myStatus:        ActivityStatus;
    myAbout:         string;
    onClose:         () => void;
    onDm:            () => void;
    onCall:          () => void;
    onStatusChange:  (s: ActivityStatus) => void;
    onLogout:        () => void;
    onDeleteAccount: () => void;
}) {
    const bg      = avatarBg(uid);
    const initial = avatarInitial(username);
    const bio     = isSelf ? myAbout : (profile?.about ?? "");
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    return (
        <>
            <div className="dw-backdrop" onClick={onClose} aria-hidden="true" />
            <aside className="dw-drawer">
                <div className="dw-drawer-top">
                    <span className="dw-drawer-title">{isSelf ? "Your profile" : "Profile"}</span>
                    <button className="dw-close-btn" onClick={onClose}><CloseIcon /></button>
                </div>
                <div className="dw-drawer-body">
                    <div className="dw-drawer-avatar" style={{ background: bg }}>{initial}</div>
                    <div className="dw-drawer-name">{username}</div>
                    <div className="dw-drawer-status-row">
                        <span className={`dw-status-dot ${isOnline ? "online" : "offline"}`} />
                        {isOnline ? "Online" : "Offline"}
                    </div>
                    {bio && (
                        <div className="dw-drawer-section">
                            <div className="dw-drawer-section-label">About</div>
                            <div className="dw-drawer-bio">{bio}</div>
                        </div>
                    )}
                    {isSelf && (
                        <div className="dw-drawer-section">
                            <div className="dw-drawer-section-label">Status</div>
                            {(["online", "idle", "dnd", "offline"] as ActivityStatus[]).map(s => (
                                <button
                                    key={s}
                                    style={{
                                        display: "block", width: "100%", textAlign: "left",
                                        padding: "6px 8px", borderRadius: "var(--r-xs)",
                                        fontSize: "var(--text-sm)",
                                        color: myStatus === s ? "var(--leaf-bright)" : "var(--text-secondary)",
                                        background: myStatus === s ? "var(--leaf-glow)" : "transparent",
                                        cursor: "pointer", marginBottom: 2,
                                        border: "none", fontFamily: "var(--font-ui)",
                                    }}
                                    onClick={() => onStatusChange(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="dw-drawer-footer">
                    {!isSelf && (
                        <>
                            <button className="dw-btn dw-btn-primary" onClick={onDm}>Message</button>
                            <button className="dw-btn dw-btn-ghost"   onClick={onCall}>Call</button>
                        </>
                    )}
                    {isSelf && !confirmingDelete && (
                        <>
                            <button className="dw-btn dw-btn-danger" onClick={onLogout}>Sign out</button>
                            <button className="dw-btn-text-danger" onClick={() => setConfirmingDelete(true)}>
                                Delete account
                            </button>
                        </>
                    )}
                    {isSelf && confirmingDelete && (
                        <div className="dw-delete-confirm">
                            <p>This permanently removes your account. It can't be undone.</p>
                            <div className="dw-delete-confirm-actions">
                                <button className="dw-btn dw-btn-ghost" onClick={() => setConfirmingDelete(false)}>
                                    Cancel
                                </button>
                                <button className="dw-btn dw-btn-danger" onClick={onDeleteAccount}>
                                    Confirm delete
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}
