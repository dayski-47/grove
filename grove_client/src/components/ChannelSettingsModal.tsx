import { useEffect, useState } from "react";
import {
    updateChannel, regenerateInviteCode, getChannelMembers,
    updateMemberRole, kickMember,
} from "../api";
import type { MemberInfo, ChannelRole } from "../types";

interface ChannelSettingsModalProps {
    channelId:     number;
    channelName:   string;
    description?:  string;
    category?:     string;
    isPrivate:     boolean;
    inviteCode?:   string;
    token:         string;
    currentUserId: number;
    myRole:        ChannelRole;
    onClose:       () => void;
    onUpdated:     (updates: { description?: string; category?: string; is_private?: boolean }) => void;
}

export function ChannelSettingsModal({
    channelId, channelName, description, category, isPrivate, inviteCode,
    token, currentUserId, myRole, onClose, onUpdated,
}: ChannelSettingsModalProps) {
    const [tab, setTab] = useState<"overview" | "members">("overview");
    const [descDraft, setDescDraft] = useState(description ?? "");
    const [categoryDraft, setCategoryDraft] = useState(category ?? "");
    const [privateDraft, setPrivateDraft] = useState(isPrivate);
    const [code, setCode] = useState(inviteCode);
    const [members, setMembers] = useState<MemberInfo[]>([]);
    const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);

    const canEdit = myRole === "owner" || myRole === "moderator";
    const isOwner = myRole === "owner";

    useEffect(() => {
        getChannelMembers(channelId, token).then(setMembers).catch(() => {});
    }, [channelId, token]);

    // Reopening settings on an already-private channel starts with `code` undefined
    // (AppShell never tracks the invite code between opens). `update_channel` returns
    // the existing code untouched when the caller is the owner and the channel is
    // already private, so this is a safe, side-effect-free way to recover it. Must
    // NOT fire for public channels — that would actually toggle privacy on and mint
    // a new code.
    useEffect(() => {
        if (!isOwner || !isPrivate || code) return;
        updateChannel(channelId, { is_private: true }, token)
            .then(res => { if (res.invite_code) setCode(res.invite_code); })
            .catch(() => {});
    }, [channelId, isOwner, isPrivate, code, token]);

    async function saveOverview() {
        const updates = {
            description: descDraft,
            category:    categoryDraft,
            is_private:  privateDraft,
        };
        const res = await updateChannel(channelId, updates, token).catch(() => null);
        if (!res) return;
        setCode(res.invite_code ?? undefined);
        onUpdated(updates);
    }

    async function handleRegenerate() {
        const res = await regenerateInviteCode(channelId, token).catch(() => null);
        if (res) setCode(res.invite_code);
    }

    async function handlePromote(userId: number, role: ChannelRole) {
        await updateMemberRole(channelId, userId, role, token).catch(() => {});
        setMembers(prev => prev.map(m => (m.user_id === userId ? { ...m, role } : m)));
        setOpenMenuFor(null);
    }

    async function handleKick(userId: number) {
        await kickMember(channelId, userId, token).catch(() => {});
        setMembers(prev => prev.filter(m => m.user_id !== userId));
        setOpenMenuFor(null);
    }

    return (
        <>
            <div className="dw-modal-backdrop" onClick={onClose} aria-hidden="true" />
            <div className="dw-modal" role="dialog" aria-modal="true" aria-label={`${channelName} settings`}>
                <div className="dw-modal-header">
                    <h2 className="dw-modal-title">#{channelName} settings</h2>
                    <button className="dw-modal-close" onClick={onClose} aria-label="Close settings">×</button>
                </div>

                <div className="dw-modal-tabs" role="tablist">
                    <button
                        className={`dw-modal-tab${tab === "overview" ? " active" : ""}`}
                        role="tab"
                        aria-selected={tab === "overview"}
                        onClick={() => setTab("overview")}
                    >
                        Overview
                    </button>
                    <button
                        className={`dw-modal-tab${tab === "members" ? " active" : ""}`}
                        role="tab"
                        aria-selected={tab === "members"}
                        onClick={() => setTab("members")}
                    >
                        Members ({members.length})
                    </button>
                </div>

                {tab === "overview" && (
                    <div className="dw-modal-body">
                        <label className="dw-modal-field">
                            <span className="dw-modal-label">Description</span>
                            <textarea
                                className="dw-modal-textarea"
                                value={descDraft}
                                onChange={e => setDescDraft(e.target.value)}
                                disabled={!canEdit}
                                maxLength={500}
                                rows={3}
                            />
                        </label>
                        <label className="dw-modal-field">
                            <span className="dw-modal-label">Category</span>
                            <input
                                className="dw-modal-input"
                                value={categoryDraft}
                                onChange={e => setCategoryDraft(e.target.value)}
                                disabled={!isOwner}
                                maxLength={100}
                                placeholder="Uncategorized"
                            />
                        </label>
                        {isOwner && (
                            <label className="dw-modal-field dw-modal-field-row">
                                <span className="dw-modal-label">Private channel</span>
                                <input
                                    type="checkbox"
                                    checked={privateDraft}
                                    onChange={e => setPrivateDraft(e.target.checked)}
                                />
                            </label>
                        )}
                        {isOwner && privateDraft && code && (
                            <div className="dw-modal-field">
                                <span className="dw-modal-label">Invite code</span>
                                <div className="dw-modal-field-row">
                                    <code className="dw-modal-code">{code}</code>
                                    <button className="dw-modal-btn-sm" onClick={handleRegenerate}>
                                        Regenerate
                                    </button>
                                </div>
                            </div>
                        )}
                        {canEdit && (
                            <button className="dw-modal-btn-primary" onClick={saveOverview}>
                                Save
                            </button>
                        )}
                    </div>
                )}

                {tab === "members" && (
                    <ul className="dw-modal-members" role="list">
                        {members.map(m => (
                            <li key={m.user_id} className="dw-modal-member-row">
                                <span className="dw-modal-member-name">{m.username}</span>
                                <span className={`dw-modal-role-badge dw-modal-role-${m.role}`}>{m.role}</span>
                                {m.user_id !== currentUserId && canEdit && (m.role !== "owner") && (
                                    <div className="dw-modal-member-menu">
                                        <button
                                            className="dw-modal-kebab"
                                            onClick={() => setOpenMenuFor(v => (v === m.user_id ? null : m.user_id))}
                                            aria-label={`Manage ${m.username}`}
                                        >
                                            ⋮
                                        </button>
                                        {openMenuFor === m.user_id && (
                                            <div className="dw-modal-menu-popover" role="menu">
                                                {isOwner && m.role === "member" && (
                                                    <button role="menuitem" onClick={() => handlePromote(m.user_id, "moderator")}>
                                                        Promote to moderator
                                                    </button>
                                                )}
                                                {isOwner && m.role === "moderator" && (
                                                    <button role="menuitem" onClick={() => handlePromote(m.user_id, "member")}>
                                                        Demote to member
                                                    </button>
                                                )}
                                                {(isOwner || (myRole === "moderator" && m.role === "member")) && (
                                                    <button role="menuitem" className="dw-modal-danger" onClick={() => handleKick(m.user_id)}>
                                                        Kick from channel
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
}
