import { useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
} from "../api";
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate,
    type EditUpdate, type DeleteUpdate, type UserProfile,
    type PinnedMessage,
} from "../types";
import type { DisplayMessage } from "./MessageList";
import { ChatView } from "./ChatView";
import { useWebRTC } from "../useWebRTC";
import { packMessage } from "../protocol";
import type { ActivityStatus } from "./ProfileMenu";
import { DecryptReveal } from "./motion/DecryptReveal";

/* ── Types ───────────────────────────────────────────────── */

interface Channel {
    id:          number;
    name:        string;
    description?: string;
    category?:    string;
    is_private:   boolean;
}

type EmojiMap    = Record<string, { count: number; byMe: boolean }>;
type ReactionsMap = Record<number, EmojiMap>;

type Toast = {
    id:          string;
    channelId:   number;
    channelName: string;
    kind:        "channel" | "dm";
    senderName:  string;
    preview:     string;
    leaving:     boolean;
};

const AVATAR_COLORS = [
    "#1a5e2a", "#1a4a7d", "#5e1a5e", "#7d3a1a",
    "#1a6e6e", "#6e1a2a", "#2a4a7d", "#2a6e3a",
];

function avatarBg(uid: number): string {
    return AVATAR_COLORS[uid % AVATAR_COLORS.length];
}

function avatarInitial(name: string): string {
    return name ? name[0].toUpperCase() : "?";
}

/* ── Palette item types ─────────────────────────────────── */

type PaletteItem =
    | { kind: "channel"; id: number; name: string }
    | { kind: "dm";      id: number; name: string; partnerId: number; online: boolean }
    | { kind: "action";  id: string; label: string; icon: string };

/* ── Component ───────────────────────────────────────────── */

export function AppShell({
    token, userId, onLogout,
}: {
    token:    string;
    userId:   number;
    onLogout: () => void;
}) {
    /* Navigation */
    const [activeChannelId, setActiveCh]     = useState<number | null>(null);
    const [activeChannelKind, setActiveKind]  = useState<"channel" | "dm">("channel");
    const [activeDisplayName, setActiveName]  = useState("");
    const [activePage, setActivePage]         = useState<"chat" | "friends">("chat");

    /* Command palette */
    const [paletteOpen, setPaletteOpen]   = useState(false);
    const [paletteQuery, setPaletteQuery] = useState("");
    const [paletteIdx, setPaletteIdx]     = useState(0);

    /* Data */
    const [channels, setChannels]       = useState<Channel[]>([]);
    const [dms, setDms]                 = useState<DmInfo[]>([]);
    const [friends, setFriends]         = useState<FriendInfo[]>([]);
    const [messages, setMessages]       = useState<Record<number, DisplayMessage[]>>({});
    const [connected, setConnected]     = useState(false);
    const [usernames, setUsernames]     = useState<Record<number, string>>({});
    const [profiles, setProfiles]       = useState<Record<number, UserProfile>>({});
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<number, Map<number, number>>>({});
    const [reactions, setReactions]     = useState<Record<number, ReactionsMap>>({});
    const [pins, setPins]               = useState<Record<number, PinnedMessage[]>>({});
    const [unreadByChannel, setUnread]  = useState<Record<number, number>>({});
    const [hasMore, setHasMore]         = useState<Record<number, boolean>>({});
    const [loadingMore, setLoadingMore] = useState<Set<number>>(new Set());
    const [recentIds, setRecentIds]     = useState<number[]>([]);
    const [openTabs, setOpenTabs]       = useState<{ id: number; name: string; kind: "channel" | "dm" }[]>([]);
    const [notifOpen, setNotifOpen]     = useState(false);
    const [toasts, setToasts]           = useState<Toast[]>([]);

    /* Profile / status */
    const [myStatus, setMyStatus] = useState<ActivityStatus>(
        () => (localStorage.getItem("grove_status") as ActivityStatus) ?? "online",
    );

    /* Profile drawer */
    const [drawerUid, setDrawerUid]       = useState<number | null>(null);
    const [drawerOpen, setDrawerOpen]     = useState(false);

    /* Friends UI */
    const [friendTab, setFriendTab]       = useState<"online" | "all">("online");
    const [showAddFriend, setShowAddFriend] = useState(false);
    const [addFriendId, setAddFriendId]   = useState("");

    /* Refs */
    const socketRef   = useRef<GroveSocket | null>(null);
    const loadedRef   = useRef<Set<number>>(new Set());
    const oldestIdRef = useRef<Record<number, number>>({});
    const paletteRef  = useRef<HTMLInputElement | null>(null);
    const notifRef    = useRef<HTMLDivElement | null>(null);
    /* Latest-value refs — updated inline each render for keyboard handler */
    const tabsForKeys   = useRef<{ id: number; name: string; kind: "channel" | "dm" }[]>([]);
    const activeForKeys = useRef<number | null>(null);
    /* Latest-value refs for WS handler */
    const channelsRef   = useRef<Channel[]>([]);
    const dmsRef        = useRef<DmInfo[]>([]);
    const usernamesRef  = useRef<Record<number, string>>({});

    /* ── Username / profile resolution ─────────────────── */

    const resolveUsername = useCallback((uid: number, known?: string) => {
        if (known) { setUsernames(p => ({ ...p, [uid]: known })); return; }
        setUsernames(prev => {
            if (uid in prev) return prev;
            getUserProfile(uid, token)
                .then(p => {
                    setUsernames(u => ({ ...u, [uid]: p.username }));
                    setProfiles(pr => ({ ...pr, [uid]: p }));
                })
                .catch(() => setUsernames(u => ({ ...u, [uid]: `user ${uid}` })));
            return { ...prev, [uid]: `user ${uid}` };
        });
    }, [token]);

    const resolveProfile = useCallback((uid: number) => {
        setProfiles(prev => {
            if (uid in prev) return prev;
            getUserProfile(uid, token)
                .then(p => {
                    setProfiles(pr => ({ ...pr, [uid]: p }));
                    setUsernames(u => ({ ...u, [uid]: p.username }));
                })
                .catch(() => {});
            return prev;
        });
    }, [token]);

    /* ── WebRTC ─────────────────────────────────────────── */

    const sendSignaling = useCallback(
        (msg: SignalingMessage) => { socketRef.current?.sendSignaling(msg); },
        [],
    );

    const { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal } =
        useWebRTC(userId, sendSignaling);

    /* ── Keyboard shortcut — Ctrl/Cmd+K ────────────────── */

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setPaletteOpen(v => !v);
                setPaletteQuery("");
                setPaletteIdx(0);
            }
            if (e.key === "Escape") {
                setPaletteOpen(false);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        if (paletteOpen) setTimeout(() => paletteRef.current?.focus(), 0);
    }, [paletteOpen]);

    useEffect(() => {
        if (!notifOpen) return;
        function onClickOut(e: MouseEvent) {
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
                setNotifOpen(false);
            }
        }
        document.addEventListener("mousedown", onClickOut);
        return () => document.removeEventListener("mousedown", onClickOut);
    }, [notifOpen]);

    /* ── Tab keyboard shortcuts ─────────────────────────────
       Reads from latest-value refs so this effect never re-registers.
       Only calls stable React setters — no stale closure issues.       */

    useEffect(() => {
        function onTabKey(e: KeyboardEvent) {
            const tabs  = tabsForKeys.current;
            const actId = activeForKeys.current;

            /* Ctrl+Tab / Ctrl+Shift+Tab — cycle through open tabs */
            if (e.ctrlKey && e.key === "Tab") {
                e.preventDefault();
                if (tabs.length < 2) return;
                const cur  = tabs.findIndex(t => t.id === actId);
                const next = e.shiftKey
                    ? (cur <= 0 ? tabs.length - 1 : cur - 1)
                    : (cur >= tabs.length - 1 ? 0 : cur + 1);
                const tab  = tabs[next];
                if (!tab) return;
                setActiveCh(tab.id);
                setActiveKind(tab.kind);
                setActiveName(tab.name);
                setActivePage("chat");
                setUnread(prev => { const n = { ...prev }; delete n[tab.id]; return n; });
                return;
            }

            /* Ctrl+W — close active tab */
            if (e.ctrlKey && !e.shiftKey && e.key === "w" && actId !== null) {
                e.preventDefault();
                const idx       = tabs.findIndex(t => t.id === actId);
                const remaining = tabs.filter(t => t.id !== actId);
                const adj       = remaining[idx] ?? remaining[idx - 1] ?? null;
                setOpenTabs(remaining);
                if (adj) {
                    setActiveCh(adj.id);
                    setActiveKind(adj.kind);
                    setActiveName(adj.name);
                    setActivePage("chat");
                } else {
                    setActiveCh(null);
                    setActiveName("");
                }
                return;
            }

            /* Ctrl+1–8 — jump to tab by position */
            const n = parseInt(e.key, 10);
            if (e.ctrlKey && !e.shiftKey && !e.altKey && n >= 1 && n <= 8) {
                const tab = tabs[n - 1];
                if (!tab) return;
                e.preventDefault();
                setActiveCh(tab.id);
                setActiveKind(tab.kind);
                setActiveName(tab.name);
                setActivePage("chat");
                setUnread(prev => { const n2 = { ...prev }; delete n2[tab.id]; return n2; });
            }
        }
        window.addEventListener("keydown", onTabKey);
        return () => window.removeEventListener("keydown", onTabKey);
    }, []); // safe — reads only refs; all setters are stable

    /* ── Typing expiry ──────────────────────────────────── */

    useEffect(() => {
        const t = setInterval(() => {
            const now = Date.now();
            setTypingUsers(prev => {
                let changed = false;
                const next  = { ...prev };
                for (const key of Object.keys(next)) {
                    const ch  = Number(key);
                    const map = new Map(next[ch]);
                    for (const [uid, ts] of map) {
                        if (now - ts > 3000) { map.delete(uid); changed = true; }
                    }
                    next[ch] = map;
                }
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(t);
    }, []);

    /* ── Socket setup ───────────────────────────────────── */

    useEffect(() => {
        const socket = new GroveSocket(
            token, userId,
            (msg: ParsedMessage) => {
                if (msg.msgType === MessageType.TYPING) {
                    if (msg.userId !== userId) {
                        setTypingUsers(prev => {
                            const map = new Map(prev[msg.channelId] ?? []);
                            map.set(msg.userId, Date.now());
                            return { ...prev, [msg.channelId]: map };
                        });
                        resolveUsername(msg.userId);
                    }
                    return;
                }

                if (msg.msgType === MessageType.REACTION) {
                    const u = JSON.parse(msg.text) as ReactionUpdate;
                    setReactions(prev => {
                        const chMap  = { ...(prev[msg.channelId] ?? {}) };
                        const msgMap = { ...(chMap[u.message_id] ?? {}) };
                        if (u.count <= 0) {
                            delete msgMap[u.emoji];
                        } else {
                            const wasByMe = msgMap[u.emoji]?.byMe ?? false;
                            msgMap[u.emoji] = {
                                count: u.count,
                                byMe: u.action === "add"
                                    ? (u.user_id === userId ? true  : wasByMe)
                                    : (u.action === "remove" && u.user_id === userId ? false : wasByMe),
                            };
                        }
                        chMap[u.message_id] = msgMap;
                        return { ...prev, [msg.channelId]: chMap };
                    });
                    return;
                }

                if (msg.msgType === MessageType.EDIT) {
                    const u = JSON.parse(msg.text) as EditUpdate;
                    setMessages(prev => {
                        const arr = prev[msg.channelId];
                        if (!arr) return prev;
                        return {
                            ...prev,
                            [msg.channelId]: arr.map(m =>
                                m.id === u.message_id ? { ...m, text: u.text, edited: true } : m,
                            ),
                        };
                    });
                    return;
                }

                if (msg.msgType === MessageType.DELETE) {
                    const u = JSON.parse(msg.text) as DeleteUpdate;
                    setMessages(prev => {
                        const arr = prev[msg.channelId];
                        if (!arr) return prev;
                        return {
                            ...prev,
                            [msg.channelId]: arr.map(m =>
                                m.id === u.message_id ? { ...m, text: "", deleted: true } : m,
                            ),
                        };
                    });
                    return;
                }

                if (msg.msgType === MessageType.TEXT) {
                    const incoming = { id: msg.msgId, userId: msg.userId, text: msg.text, timestamp: msg.timestamp };
                    setMessages(prev => {
                        const arr = prev[msg.channelId] ?? [];
                        // Own message echoed back — replace the pending placeholder we added optimistically.
                        if (msg.userId === userId) {
                            const pendingIdx = arr.reduce((found, m, i) => (m.pending ? i : found), -1);
                            if (pendingIdx !== -1) {
                                const next = [...arr];
                                next[pendingIdx] = { ...incoming, clientId: arr[pendingIdx].clientId };
                                return { ...prev, [msg.channelId]: next };
                            }
                        }
                        return { ...prev, [msg.channelId]: [...arr, incoming] };
                    });
                    resolveUsername(msg.userId);
                    const isBackground = activeForKeys.current !== msg.channelId;
                    if (isBackground) {
                        setUnread(u => ({ ...u, [msg.channelId]: (u[msg.channelId] ?? 0) + 1 }));
                        if (msg.userId !== userId) {
                            const inChannels = channelsRef.current.some(c => c.id === msg.channelId);
                            const dmEntry    = dmsRef.current.find(d => d.channel_id === msg.channelId);
                            const isDm       = !inChannels;
                            const sender     = usernamesRef.current[msg.userId] ?? `user ${msg.userId}`;
                            const chName     = channelsRef.current.find(c => c.id === msg.channelId)?.name
                                ?? dmEntry?.partner_name
                                ?? sender;
                            if (isDm && !dmEntry) {
                                listDms(token).then(list => {
                                    setDms(list);
                                    list.forEach(d => resolveUsername(d.partner_id, d.partner_name));
                                }).catch(console.error);
                            }
                            const tid    = `${msg.channelId}-${msg.timestamp}`;
                            setToasts(prev => {
                                if (prev.length >= 4) return prev;
                                if (prev.some(t => t.channelId === msg.channelId && !t.leaving)) return prev;
                                return [...prev, {
                                    id: tid, channelId: msg.channelId,
                                    channelName: chName, kind: isDm ? "dm" : "channel",
                                    senderName: sender, preview: msg.text.slice(0, 80),
                                    leaving: false,
                                }];
                            });
                            setTimeout(() => dismissToast(tid), 4000);
                        }
                    }
                }
            },
            (isConn) => setConnected(isConn),
            (pUid, online, name, _customStatus) => {
                setOnlineUsers(prev => {
                    const next = new Set(prev);
                    if (online) { next.add(pUid); resolveUsername(pUid, name); }
                    else         next.delete(pUid);
                    return next;
                });
                setFriends(prev => prev.map(f => f.user_id === pUid ? { ...f, online } : f));
            },
            handleSignal,
        );
        socket.connect();
        socketRef.current = socket;

        listChannels(token).then(chs => setChannels(chs.map(c => ({
            id: c.id, name: c.name, description: c.description, category: c.category, is_private: c.is_private,
        })))).catch(console.error);
        listDms(token).then(list => { setDms(list); list.forEach(d => resolveUsername(d.partner_id, d.partner_name)); }).catch(console.error);
        listFriends(token).then(setFriends).catch(console.error);
        resolveProfile(userId);

        return () => socket.disconnect();
    }, [token, userId, handleSignal, resolveUsername, resolveProfile]);

    /* ── Presence ───────────────────────────────────────── */

    function broadcastPresence(status: ActivityStatus) {
        const ws = (socketRef.current as unknown as { ws: WebSocket | null })?.ws;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(packMessage(MessageType.PRESENCE, userId, 0, status));
        }
    }

    function handleStatusChange(status: ActivityStatus) {
        setMyStatus(status);
        localStorage.setItem("grove_status", status);
        broadcastPresence(status);
    }

    /* ── Channel open ───────────────────────────────────── */

    async function openChannel(channelId: number, displayName: string, kind: "channel" | "dm" = "channel") {
        dismissChannelToasts(channelId);
        setActiveCh(channelId);
        setActiveKind(kind);
        setActiveName(displayName);
        setActivePage("chat");
        setUnread(prev => { const n = { ...prev }; delete n[channelId]; return n; });
        setRecentIds(prev => [channelId, ...prev.filter(id => id !== channelId)].slice(0, 10));
        setOpenTabs(prev => prev.find(t => t.id === channelId) ? prev : [...prev, { id: channelId, name: displayName, kind }]);
        setPaletteOpen(false);

        if (loadedRef.current.has(channelId)) return;
        loadedRef.current.add(channelId);

        try {
            if (kind === "channel") await joinChannel(channelId, token);
            const [history, rxData] = await Promise.all([
                getHistory(channelId, token),
                getChannelReactions(channelId, token),
            ]);
            setMessages(prev => ({
                ...prev,
                [channelId]: history.slice().reverse().map(m => ({
                    id: m.id, userId: m.user_id, text: m.text,
                    timestamp: m.timestamp, edited: m.edited, deleted: m.deleted,
                })),
            }));
            if (history.length > 0) oldestIdRef.current[channelId] = history[history.length - 1].id;
            setHasMore(prev => ({ ...prev, [channelId]: history.length >= 50 }));
            if (rxData.length > 0) {
                const rxMap: ReactionsMap = {};
                for (const r of rxData) {
                    if (!rxMap[r.message_id]) rxMap[r.message_id] = {};
                    rxMap[r.message_id][r.emoji] = { count: r.count, byMe: r.by_me };
                }
                setReactions(prev => ({ ...prev, [channelId]: rxMap }));
            }
            [...new Set(history.map(m => m.user_id))].forEach(uid => resolveUsername(uid));
            getChannelPins(channelId, token)
                .then(list => { if (list.length) setPins(prev => ({ ...prev, [channelId]: list })); })
                .catch(() => {});
        } catch { /* already member */ }
    }

    function closeTab(tabId: number) {
        if (activeChannelId === tabId) {
            const idx       = openTabs.findIndex(t => t.id === tabId);
            const remaining = openTabs.filter(t => t.id !== tabId);
            const adj       = remaining[idx] ?? remaining[idx - 1] ?? null;
            if (adj) openChannel(adj.id, adj.name, adj.kind);
            else { setActiveCh(null); setActiveName(""); }
        }
        setOpenTabs(prev => prev.filter(t => t.id !== tabId));
    }

    async function loadMoreMessages(channelId: number) {
        const before = oldestIdRef.current[channelId];
        if (!before) return;
        setLoadingMore(prev => new Set(prev).add(channelId));
        try {
            const older = await getHistory(channelId, token, before);
            if (older.length === 0) { setHasMore(prev => ({ ...prev, [channelId]: false })); return; }
            const prepend = older.slice().reverse().map(m => ({
                id: m.id, userId: m.user_id, text: m.text,
                timestamp: m.timestamp, edited: m.edited, deleted: m.deleted,
            }));
            oldestIdRef.current[channelId] = older[older.length - 1].id;
            if (older.length < 50) setHasMore(prev => ({ ...prev, [channelId]: false }));
            setMessages(prev => ({ ...prev, [channelId]: [...prepend, ...(prev[channelId] ?? [])] }));
            [...new Set(older.map(m => m.user_id))].forEach(uid => resolveUsername(uid));
        } catch { /* ignore */ } finally {
            setLoadingMore(prev => { const s = new Set(prev); s.delete(channelId); return s; });
        }
    }

    function dismissToast(id: string) {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
    }

    function dismissChannelToasts(channelId: number) {
        setToasts(prev => {
            const ids = prev.filter(t => t.channelId === channelId && !t.leaving).map(t => t.id);
            if (ids.length === 0) return prev;
            ids.forEach(id => setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 220));
            return prev.map(t => t.channelId === channelId ? { ...t, leaving: true } : t);
        });
    }

    async function openDmWith(partnerId: number) {
        const existing = dms.find(d => d.partner_id === partnerId);
        if (existing) { openChannel(existing.channel_id, existing.partner_name, "dm"); return; }
        try {
            const { channel_id } = await openDm(partnerId, token);
            const name = usernames[partnerId] ?? `user ${partnerId}`;
            setDms(prev => [{ channel_id, partner_id: partnerId, partner_name: name }, ...prev]);
            openChannel(channel_id, name, "dm");
        } catch { /* ignore */ }
    }

    async function handleCreateChannel() {
        const name = paletteQuery.trim().replace(/^#/, "");
        if (!name) return;
        try {
            const res = await createChannel(name, token);
            setChannels(prev => [...prev, { id: res.channel_id, name }]);
            openChannel(res.channel_id, name, "channel");
        } catch { /* ignore */ }
    }

    async function handleAddFriend() {
        const username = addFriendId.trim();
        if (!username) return;
        try {
            const results = await searchUsers(username, token);
            const match = results.find(u => u.username.toLowerCase() === username.toLowerCase());
            if (!match) return;
            await addFriend(match.id, token);
            const updated = await listFriends(token);
            setFriends(updated);
            setAddFriendId("");
        } catch { /* ignore */ }
    }

    async function handleRemoveFriend(friendId: number) {
        try {
            await removeFriend(friendId, token);
            setFriends(prev => prev.filter(f => f.user_id !== friendId));
        } catch { /* ignore */ }
    }

    async function handleLogout() {
        await logout(token).catch(() => {});
        onLogout();
    }

    /* ── Palette items ──────────────────────────────────── */

    const q = paletteQuery.trim().toLowerCase();

    const paletteItems: PaletteItem[] = (() => {
        if (!q) {
            // Show recents first, then all channels
            const recentItems: PaletteItem[] = recentIds
                .map(id => {
                    const ch = channels.find(c => c.id === id);
                    if (ch) return { kind: "channel" as const, id: ch.id, name: ch.name };
                    const dm = dms.find(d => d.channel_id === id);
                    if (dm) return {
                        kind: "dm" as const,
                        id: dm.channel_id,
                        name: dm.partner_name,
                        partnerId: dm.partner_id,
                        online: onlineUsers.has(dm.partner_id),
                    };
                    return null;
                })
                .filter(Boolean) as PaletteItem[];
            return [
                ...recentItems,
                { kind: "action", id: "friends", label: "Friends", icon: "👥" },
            ];
        }

        const chMatches: PaletteItem[] = channels
            .filter(c => c.name.toLowerCase().includes(q))
            .map(c => ({ kind: "channel", id: c.id, name: c.name }));

        const dmMatches: PaletteItem[] = dms
            .filter(d => d.partner_name.toLowerCase().includes(q))
            .map(d => ({
                kind: "dm",
                id: d.channel_id,
                name: d.partner_name,
                partnerId: d.partner_id,
                online: onlineUsers.has(d.partner_id),
            }));

        const friendMatches: PaletteItem[] = friends
            .filter(f => f.username.toLowerCase().includes(q) && !dms.find(d => d.partner_id === f.user_id))
            .map(f => ({
                kind: "dm",
                id: -f.user_id,
                name: f.username,
                partnerId: f.user_id,
                online: f.online,
            }));

        const items: PaletteItem[] = [...chMatches, ...dmMatches, ...friendMatches];

        if (items.length === 0 && q.length > 0) {
            items.push({ kind: "action", id: "create", label: `Create #${q}`, icon: "+" });
        }

        if ("friends".includes(q)) {
            items.push({ kind: "action", id: "friends", label: "Friends", icon: "👥" });
        }

        return items;
    })();

    function selectPaletteItem(item: PaletteItem) {
        if (item.kind === "channel") {
            openChannel(item.id, item.name, "channel");
        } else if (item.kind === "dm") {
            if (item.id < 0) {
                openDmWith(item.partnerId);
            } else {
                openChannel(item.id, item.name, "dm");
            }
        } else if (item.kind === "action") {
            if (item.id === "friends") { setActivePage("friends"); setPaletteOpen(false); }
            if (item.id === "create")  handleCreateChannel();
        }
    }

    function handlePaletteKey(e: React.KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setPaletteIdx(i => Math.min(i + 1, paletteItems.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setPaletteIdx(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const item = paletteItems[paletteIdx];
            if (item) selectPaletteItem(item);
        } else if (e.key === "Escape") {
            setPaletteOpen(false);
        }
    }

    /* Keep latest-value refs in sync (runs every render, before any effect) */
    tabsForKeys.current   = openTabs;
    activeForKeys.current = activeChannelId;
    channelsRef.current   = channels;
    dmsRef.current        = dms;
    usernamesRef.current  = usernames;

    /* ── Derived values ─────────────────────────────────── */

    const myName    = usernames[userId] ?? `user ${userId}`;
    const myProfile = profiles[userId];

    const totalUnread = Object.values(unreadByChannel).reduce((s, n) => s + n, 0);

    const activeMessages  = activeChannelId !== null ? (messages[activeChannelId] ?? []) : [];
    const activeReactions = activeChannelId !== null ? (reactions[activeChannelId] ?? {}) : {};
    const activePins      = activeChannelId !== null ? (pins[activeChannelId] ?? []) : [];
    const activeTyping    = activeChannelId !== null
        ? [...(typingUsers[activeChannelId] ?? new Map()).keys()].map(uid => usernames[uid] ?? `user ${uid}`)
        : [];

    const mentionUsers = Object.entries(usernames)
        .filter(([uid]) => Number(uid) !== userId)
        .map(([uid, name]) => ({ id: Number(uid), name }));

    const onlineFriends = friends.filter(f => f.online);
    const friendList    = friendTab === "online" ? onlineFriends : friends;

    /* ── Render ─────────────────────────────────────────── */

    return (
        <div className="dw-shell dw-shell-v3">
            <CornerBranches />
            {/* ── Top bar ─────────────────────────────── */}
            <header className="dw-topbar" role="banner">
                <button
                    className="dw-topbar-logo"
                    onClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); }}
                    aria-label="Open command palette"
                    title="Open navigation (Ctrl+K)"
                >
                    <LeafIcon />
                </button>

                <button
                    className="dw-topbar-location"
                    onClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); }}
                    aria-label="Navigate to a channel"
                    title="Ctrl+K to navigate"
                >
                    {activeChannelId !== null ? (
                        <>
                            <span className="dw-topbar-prefix">
                                {activeChannelKind === "dm" ? "@" : "#"}
                            </span>
                            <span className="dw-topbar-name">{activeDisplayName}</span>
                        </>
                    ) : activePage === "friends" ? (
                        <span className="dw-topbar-name">Friends</span>
                    ) : (
                        <span className="dw-topbar-name dw-topbar-hint">
                            Press <kbd>Ctrl K</kbd> to navigate
                        </span>
                    )}
                    {totalUnread > 0 && (
                        <span className="dw-topbar-unread" aria-label={`${totalUnread} unread`}>
                            {totalUnread > 99 ? "99+" : totalUnread}
                        </span>
                    )}
                </button>

                <div className="dw-topbar-actions">
                    {/* Call bar — inline when in call */}
                    {callState !== "idle" && (
                        <CallInline
                            callState={callState}
                            remoteUserId={remoteUserId}
                            usernames={usernames}
                            onAccept={acceptCall}
                            onDecline={declineCall}
                            onHangup={hangup}
                        />
                    )}
                    <div
                        className={`dw-topbar-conn ${connected ? "online" : "offline"}`}
                        title={connected ? "Connected" : "Reconnecting…"}
                        aria-label={connected ? "Connected" : "Reconnecting"}
                    />
                    <div className="dw-notif-wrap" ref={notifRef}>
                        <button
                            className={`dw-topbar-btn${notifOpen ? " active" : ""}`}
                            onClick={() => setNotifOpen(v => !v)}
                            aria-label={`Notifications${totalUnread > 0 ? ` — ${totalUnread} unread` : ""}`}
                            title="Notifications"
                        >
                            <BellIcon count={totalUnread} />
                        </button>
                        {notifOpen && (
                            <NotifPanel
                                channels={channels}
                                dms={dms}
                                unreads={unreadByChannel}
                                onNavigate={(id, name, kind) => openChannel(id, name, kind)}
                                onClose={() => setNotifOpen(false)}
                            />
                        )}
                    </div>
                    <button
                        className={`dw-topbar-btn${activePage === "friends" ? " active" : ""}`}
                        onClick={() => setActivePage(p => p === "friends" ? "chat" : "friends")}
                        aria-label="Friends"
                        title="Friends"
                    >
                        <FriendsIcon />
                    </button>
                    <button
                        className="dw-topbar-avatar"
                        style={{ background: avatarBg(userId) }}
                        onClick={() => { setDrawerUid(userId); setDrawerOpen(true); resolveProfile(userId); }}
                        aria-label={`Your profile — ${myName}`}
                        title={myName}
                    >
                        {avatarInitial(myName)}
                        <span
                            className={`dw-topbar-status ${myStatus === "offline" ? "offline" : myStatus === "dnd" ? "dnd" : myStatus === "idle" ? "idle" : "online"}`}
                            aria-hidden="true"
                        />
                    </button>
                </div>
            </header>

            {/* ── Tab bar ─────────────────────────────── */}
            <TabBar
                tabs={openTabs}
                activeId={activeChannelId}
                unreads={unreadByChannel}
                onSelect={openChannel}
                onClose={closeTab}
            />

            {/* ── Content ─────────────────────────────── */}
            <main className="dw-content" aria-label="Main content">
                {activePage === "friends" ? (
                    <FriendsPage
                        friends={friendList}
                        onlineFriends={onlineFriends}
                        tab={friendTab}
                        onTab={setFriendTab}
                        showAdd={showAddFriend}
                        addFriendId={addFriendId}
                        onAddFriendId={setAddFriendId}
                        onToggleAdd={() => setShowAddFriend(v => !v)}
                        onAddFriend={handleAddFriend}
                        onRemoveFriend={handleRemoveFriend}
                        onDm={uid => { openDmWith(uid); setActivePage("chat"); }}
                        onCall={initiateCall}
                        onUserClick={uid => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
                    />
                ) : activeChannelId !== null ? (
                    <ChatView
                        channelId={activeChannelId}
                        channelName={activeDisplayName}
                        isDm={activeChannelKind === "dm"}
                        messages={activeMessages}
                        usernames={usernames}
                        currentUserId={userId}
                        myUsername={myName}
                        typingNames={activeTyping}
                        connected={connected}
                        hasMore={hasMore[activeChannelId] ?? false}
                        loadingMore={loadingMore.has(activeChannelId)}
                        reactions={activeReactions}
                        pins={activePins}
                        mentionUsers={mentionUsers}
                        onSend={text => {
                            const now = Math.floor(Date.now() / 1000);
                            const clientId = crypto.randomUUID();
                            setMessages(prev => ({
                                ...prev,
                                [activeChannelId]: [...(prev[activeChannelId] ?? []), { userId, text, timestamp: now, pending: true, clientId }],
                            }));
                            socketRef.current?.sendText(activeChannelId, text);
                        }}
                        onTyping={() => socketRef.current?.sendTyping(activeChannelId)}
                        onLoadMore={() => loadMoreMessages(activeChannelId)}
                        onReact={(msgId, emoji) => socketRef.current?.sendReaction(activeChannelId, msgId, emoji)}
                        onEdit={(msgId, text) => socketRef.current?.sendEdit(activeChannelId, msgId, text)}
                        onDelete={msgId => socketRef.current?.sendDelete(activeChannelId, msgId)}
                        onPin={async msgId => {
                            await pinMessage(msgId, token).catch(() => {});
                            const list = await getChannelPins(activeChannelId, token).catch(() => [] as PinnedMessage[]);
                            setPins(prev => ({ ...prev, [activeChannelId]: list }));
                        }}
                        onUnpin={async msgId => {
                            await unpinMessage(msgId, token).catch(() => {});
                            setPins(prev => ({
                                ...prev,
                                [activeChannelId]: (prev[activeChannelId] ?? []).filter(p => p.message_id !== msgId),
                            }));
                        }}
                        onUserClick={(uid, _e) => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
                    />
                ) : (
                    <EmptyContent />
                )}
            </main>

            {/* ── Command palette ──────────────────────── */}
            {paletteOpen && (
                <>
                    <div
                        className="dw-palette-backdrop"
                        onClick={() => setPaletteOpen(false)}
                        aria-hidden="true"
                    />
                    <div
                        className="dw-palette"
                        role="dialog"
                        aria-label="Command palette"
                        aria-modal="true"
                    >
                        <div className="dw-palette-search-row">
                            <SearchIcon />
                            <input
                                ref={paletteRef}
                                className="dw-palette-input"
                                placeholder="Go to channel, DM, or friends…"
                                value={paletteQuery}
                                onChange={e => { setPaletteQuery(e.target.value); setPaletteIdx(0); }}
                                onKeyDown={handlePaletteKey}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label="Search channels and DMs"
                                aria-autocomplete="list"
                                aria-controls="palette-list"
                                aria-activedescendant={`palette-item-${paletteIdx}`}
                            />
                            <kbd className="dw-palette-esc">Esc</kbd>
                        </div>

                        {paletteItems.length > 0 && (
                            <ul className="dw-palette-list" id="palette-list" role="listbox">
                                {!q && recentIds.some(id => channels.find(c => c.id === id) || dms.find(d => d.channel_id === id)) && (
                                    <li className="dw-palette-category" role="presentation">Recent</li>
                                )}
                                {paletteItems.map((item, i) => (
                                    <li
                                        key={item.kind + item.id}
                                        id={`palette-item-${i}`}
                                        className={`dw-palette-item${i === paletteIdx ? " active" : ""}`}
                                        role="option"
                                        aria-selected={i === paletteIdx}
                                        onMouseEnter={() => setPaletteIdx(i)}
                                        onMouseDown={e => { e.preventDefault(); selectPaletteItem(item); }}
                                    >
                                        {item.kind === "channel" && (
                                            <>
                                                <span className="dw-palette-icon dw-palette-hash">#</span>
                                                <span className="dw-palette-label">{item.name}</span>
                                                {unreadByChannel[item.id] ? (
                                                    <span className="dw-palette-badge">
                                                        {unreadByChannel[item.id]}
                                                    </span>
                                                ) : null}
                                            </>
                                        )}
                                        {item.kind === "dm" && (
                                            <>
                                                <div
                                                    className="dw-palette-avatar"
                                                    style={{ background: avatarBg(item.partnerId) }}
                                                >
                                                    {avatarInitial(item.name)}
                                                    <span className={`dw-palette-dot ${item.online ? "online" : "offline"}`} />
                                                </div>
                                                <span className="dw-palette-label">{item.name}</span>
                                                <span className="dw-palette-sub">
                                                    {item.online ? "online" : "offline"}
                                                </span>
                                            </>
                                        )}
                                        {item.kind === "action" && (
                                            <>
                                                <span className="dw-palette-icon">{item.icon}</span>
                                                <span className="dw-palette-label">{item.label}</span>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {paletteItems.length === 0 && q && (
                            <div className="dw-palette-empty">Nothing found for "{q}"</div>
                        )}

                        <div className="dw-palette-footer">
                            <span><kbd>↑↓</kbd> navigate</span>
                            <span><kbd>↵</kbd> open</span>
                            <span><kbd>Esc</kbd> close</span>
                        </div>
                    </div>
                </>
            )}

            {/* ── Profile drawer ───────────────────────── */}
            {drawerOpen && drawerUid !== null && (
                <ProfileDrawer
                    uid={drawerUid}
                    isSelf={drawerUid === userId}
                    profile={profiles[drawerUid]}
                    username={usernames[drawerUid] ?? `user ${drawerUid}`}
                    isOnline={onlineUsers.has(drawerUid)}
                    myStatus={myStatus}
                    myAbout={myProfile?.about ?? ""}
                    onClose={() => setDrawerOpen(false)}
                    onDm={() => { openDmWith(drawerUid); setDrawerOpen(false); setActivePage("chat"); }}
                    onCall={() => { initiateCall(drawerUid); setDrawerOpen(false); }}
                    onStatusChange={handleStatusChange}
                    onLogout={handleLogout}
                />
            )}

            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />

            {/* ── Toast notifications ──────────────────── */}
            <ToastContainer
                toasts={toasts}
                onDismiss={dismissToast}
                onNavigate={(id, name, kind) => openChannel(id, name, kind)}
            />
        </div>
    );
}

/* ── Empty / brand state ─────────────────────────────────── */

const EMPTY_FIREFLIES = [
    { left: "22%", top: "35%", delay: "0s",   cls: "" },
    { left: "58%", top: "28%", delay: "2.1s", cls: "gv-firefly-b" },
    { left: "38%", top: "52%", delay: "1.3s", cls: "gv-firefly-c" },
    { left: "70%", top: "45%", delay: "3.5s", cls: "" },
    { left: "15%", top: "62%", delay: "0.7s", cls: "gv-firefly-b" },
];

function EmptyContent() {
    return (
        <div className="gv-empty">
            {EMPTY_FIREFLIES.map((f, i) => (
                <div key={i} className={`gv-firefly ${f.cls}`} style={{ left: f.left, top: f.top, animationDelay: f.delay }} aria-hidden="true" />
            ))}
            <div className="gv-empty-brand" aria-label="Grove">
                <DecryptReveal text="grove" />
            </div>
            <p className="gv-empty-tagline" aria-label="an enchanted place to gather">
                <DecryptReveal text="an enchanted place to gather" durationMs={700} />
            </p>
            <div className="gv-empty-floor" aria-hidden="true">
                <svg viewBox="0 0 600 160" className="gv-floor-svg">
                    {/* Ground */}
                    <path d="M 0 132 C 80 122 160 134 240 124 C 320 114 400 130 480 120 C 530 113 565 122 600 116 L 600 200 L 0 200 Z" fill="#010301"/>
                    <path d="M 0 140 C 100 133 210 142 320 135 C 420 128 520 138 600 132 L 600 200 L 0 200 Z" fill="#010201"/>
                    {/* Roots */}
                    <path d="M 42 132 C 90 122 148 128 198 122" stroke="#070d07" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
                    <path d="M 62 139 C 100 133 132 136 158 132" stroke="#050a05" strokeWidth="2" fill="none" strokeLinecap="round"/>
                    <path d="M 392 128 C 440 120 490 126 545 122" stroke="#070d07" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    {/* Left fern */}
                    <path d="M 145 132 C 133 112 128 98 136 86" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 157 114 162 100 154 90" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 138 118 136 108 142 102" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 152 120 156 110 150 103" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    {/* Left mushroom cluster */}
                    <rect x="84" y="106" width="7" height="20" rx="2" fill="#0c140c"/>
                    <ellipse cx="87.5" cy="105" rx="13" ry="6" fill="#170d08"/>
                    <rect x="100" y="112" width="5" height="14" rx="1.5" fill="#0f170f"/>
                    <ellipse cx="102.5" cy="111" rx="9" ry="4.5" fill="#1a1008"/>
                    <rect x="70" y="114" width="5" height="12" rx="1.5" fill="#0c140c"/>
                    <ellipse cx="72.5" cy="113" rx="8" ry="4" fill="#120e06"/>
                    {/* Center tall mushroom */}
                    <rect x="270" y="88" width="12" height="38" rx="3.5" fill="#0e180e"/>
                    <ellipse cx="276" cy="87" rx="22" ry="10" fill="#1c1008"/>
                    <ellipse cx="273" cy="83" rx="15" ry="6" fill="#221408" opacity="0.7"/>
                    <ellipse cx="271" cy="82" rx="7" ry="3" fill="rgba(180,140,55,0.07)"/>
                    {/* Center mushroom 2 */}
                    <rect x="295" y="98" width="9" height="28" rx="2.5" fill="#0c180c"/>
                    <ellipse cx="299.5" cy="97" rx="16" ry="8" fill="#160e06"/>
                    {/* Center mushroom 3 small */}
                    <rect x="317" y="108" width="6" height="18" rx="2" fill="#101810"/>
                    <ellipse cx="320" cy="107" rx="11" ry="5.5" fill="#1a1208"/>
                    {/* Right fern */}
                    <path d="M 460 130 C 448 110 445 96 454 84" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 472 112 476 98 468 88" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 452 116 450 106 456 100" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 468 118 468 108 463 102" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    {/* Right mushroom cluster */}
                    <rect x="515" y="104" width="8" height="22" rx="2.5" fill="#0c140c"/>
                    <ellipse cx="519" cy="103" rx="14" ry="7" fill="#1a1008"/>
                    <rect x="528" y="110" width="6" height="16" rx="2" fill="#0f170f"/>
                    <ellipse cx="531" cy="109" rx="10" ry="5" fill="#160e08"/>
                    <rect x="502" y="112" width="5" height="12" rx="1.5" fill="#0c140c"/>
                    <ellipse cx="504.5" cy="111" rx="8" ry="4" fill="#1a1208"/>
                    {/* Scattered debris */}
                    <ellipse cx="180" cy="135" rx="10" ry="3.5" fill="#080e08" opacity="0.55"/>
                    <ellipse cx="356" cy="130" rx="12" ry="4" fill="#080e08" opacity="0.45"/>
                    <ellipse cx="430" cy="133" rx="8" ry="3" fill="#080e08" opacity="0.5"/>
                </svg>
            </div>
            <div className="gv-empty-hint">
                <kbd className="gv-kbd">ctrl</kbd>
                <span className="gv-kbd-sep">+</span>
                <kbd className="gv-kbd">k</kbd>
                <span className="gv-kbd-text">to open a channel</span>
            </div>
        </div>
    );
}

/* ── Corner branch overlays ──────────────────────────────── */

function CornerBranches() {
    const paths = (
        <>
            <path d="M 0 0 C 35 28 62 58 92 100" stroke="#0c1e0c" strokeWidth="5.5" fill="none" strokeLinecap="round"/>
            <path d="M 28 24 C 58 10 90 6 108 10" stroke="#0c1e0c" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d="M 58 62 C 85 48 105 40 118 44" stroke="#0c1e0c" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <path d="M 42 42 C 58 30 66 21 74 17" stroke="#0c1e0c" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            <path d="M 74 84 C 92 74 102 68 112 72" stroke="#0c1e0c" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </>
    );
    return (
        <div className="gv-corners" aria-hidden="true">
            <svg className="gv-corner gv-corner-tl" viewBox="0 0 220 180">{paths}</svg>
            <svg className="gv-corner gv-corner-tr" viewBox="0 0 220 180" style={{ transform: "scaleX(-1)" }}>{paths}</svg>
            <svg className="gv-corner gv-corner-bl" viewBox="0 0 220 180" style={{ transform: "scaleY(-1)" }}>{paths}</svg>
            <svg className="gv-corner gv-corner-br" viewBox="0 0 220 180" style={{ transform: "scale(-1)" }}>{paths}</svg>
        </div>
    );
}

/* ── Inline call indicator (in top bar) ─────────────────── */

function CallInline({ callState, remoteUserId, usernames, onAccept, onDecline, onHangup }: {
    callState:    string;
    remoteUserId: number | null;
    usernames:    Record<number, string>;
    onAccept:     () => void;
    onDecline:    () => void;
    onHangup:     () => void;
}) {
    const name = remoteUserId !== null ? (usernames[remoteUserId] ?? `user ${remoteUserId}`) : "";
    return (
        <div className="dw-call-inline" role="alertdialog">
            <span className="dw-call-ring" aria-hidden="true" />
            <span className="dw-call-label">
                {callState === "incoming"  && name}
                {callState === "outgoing"  && `Calling ${name}…`}
                {callState === "connected" && name}
            </span>
            {callState === "incoming" && (
                <>
                    <button className="dw-call-btn dw-call-accept"  onClick={onAccept}>Accept</button>
                    <button className="dw-call-btn dw-call-decline" onClick={onDecline}>Decline</button>
                </>
            )}
            {(callState === "outgoing" || callState === "connected") && (
                <button className="dw-call-btn dw-call-hangup" onClick={onHangup}>
                    {callState === "outgoing" ? "Cancel" : "End"}
                </button>
            )}
        </div>
    );
}

/* ── Friends page ────────────────────────────────────────── */

function FriendsPage({
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
    const bg      = AVATAR_COLORS[f.user_id % AVATAR_COLORS.length];
    const initial = f.username ? f.username[0].toUpperCase() : "?";
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

/* ── Profile drawer ──────────────────────────────────────── */

function ProfileDrawer({
    uid, isSelf, profile, username, isOnline,
    myStatus, myAbout,
    onClose, onDm, onCall, onStatusChange, onLogout,
}: {
    uid:            number;
    isSelf:         boolean;
    profile:        UserProfile | undefined;
    username:       string;
    isOnline:       boolean;
    myStatus:       ActivityStatus;
    myAbout:        string;
    onClose:        () => void;
    onDm:           () => void;
    onCall:         () => void;
    onStatusChange: (s: ActivityStatus) => void;
    onLogout:       () => void;
}) {
    const bg      = avatarBg(uid);
    const initial = avatarInitial(username);
    const bio     = isSelf ? myAbout : (profile?.about ?? "");

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
                    {isSelf && (
                        <button className="dw-btn dw-btn-danger" onClick={onLogout}>Sign out</button>
                    )}
                </div>
            </aside>
        </>
    );
}

/* ── Tab bar ─────────────────────────────────────────────── */

function TabBar({
    tabs, activeId, unreads, onSelect, onClose,
}: {
    tabs:     { id: number; name: string; kind: "channel" | "dm" }[];
    activeId: number | null;
    unreads:  Record<number, number>;
    onSelect: (id: number, name: string, kind: "channel" | "dm") => void;
    onClose:  (id: number) => void;
}) {
    if (tabs.length === 0) return null;
    return (
        <div className="dw-tabbar" role="tablist" aria-label="Open channels">
            {tabs.map(tab => (
                <div
                    key={tab.id}
                    role="tab"
                    className={`dw-tabitem${tab.id === activeId ? " active" : ""}${(unreads[tab.id] ?? 0) > 0 ? " unread" : ""}`}
                    aria-selected={tab.id === activeId}
                >
                    <button
                        className="dw-tabitem-main"
                        onClick={() => onSelect(tab.id, tab.name, tab.kind)}
                        title={tab.name}
                    >
                        <span className="dw-tabitem-prefix">{tab.kind === "dm" ? "@" : "#"}</span>
                        <span className="dw-tabitem-name">{tab.name}</span>
                        {(unreads[tab.id] ?? 0) > 0 && (
                            <span className="dw-tabitem-badge">
                                {unreads[tab.id] > 99 ? "99+" : unreads[tab.id]}
                            </span>
                        )}
                    </button>
                    <button
                        className="dw-tabitem-close"
                        onClick={e => { e.stopPropagation(); onClose(tab.id); }}
                        aria-label={`Close ${tab.name}`}
                    >
                        <CloseIcon />
                    </button>
                </div>
            ))}
        </div>
    );
}

/* ── Notification panel ──────────────────────────────────── */

function NotifPanel({
    channels, dms, unreads, onNavigate, onClose,
}: {
    channels:   { id: number; name: string }[];
    dms:        { channel_id: number; partner_name: string }[];
    unreads:    Record<number, number>;
    onNavigate: (id: number, name: string, kind: "channel" | "dm") => void;
    onClose:    () => void;
}) {
    const items = Object.entries(unreads)
        .filter(([, c]) => c > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([idStr, count]) => {
            const id   = Number(idStr);
            const ch   = channels.find(c => c.id === id);
            const dm   = dms.find(d => d.channel_id === id);
            const kind: "channel" | "dm" = ch ? "channel" : "dm";
            const name = ch?.name ?? dm?.partner_name ?? (kind === "dm" ? "Direct message" : `channel ${id}`);
            return { id, name, kind, count };
        });

    return (
        <div className="dw-notif-panel" role="menu" aria-label="Unread messages">
            <div className="dw-notif-header">Unread</div>
            {items.length === 0 ? (
                <div className="dw-notif-empty">All caught up</div>
            ) : items.map(({ id, name, kind, count }) => (
                <button
                    key={id}
                    className="dw-notif-item"
                    role="menuitem"
                    onClick={() => { onNavigate(id, name, kind); onClose(); }}
                >
                    <span className="dw-notif-prefix">{kind === "dm" ? "@" : "#"}</span>
                    <span className="dw-notif-name">{name}</span>
                    <span className="dw-notif-count">{count > 99 ? "99+" : count}</span>
                </button>
            ))}
        </div>
    );
}

/* ── Icons ───────────────────────────────────────────────── */

function BellIcon({ count }: { count: number }) {
    return (
        <div className="dw-bell-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {count > 0 && (
                <span className="dw-bell-badge" aria-hidden="true">
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </div>
    );
}

function ToastContainer({ toasts, onDismiss, onNavigate }: {
    toasts:     Toast[];
    onDismiss:  (id: string) => void;
    onNavigate: (channelId: number, name: string, kind: "channel" | "dm") => void;
}) {
    if (toasts.length === 0) return null;
    return (
        <div className="gv-toast-container" aria-live="polite" aria-label="Notifications">
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={`gv-toast${t.leaving ? " leaving" : ""}`}
                    onClick={() => onNavigate(t.channelId, t.channelName, t.kind)}
                    role="alert"
                >
                    <div className="gv-toast-channel">{t.kind === "dm" ? "@" : "#"}{t.channelName}</div>
                    <div className="gv-toast-sender">{t.senderName}</div>
                    <div className="gv-toast-preview">{t.preview}</div>
                    <button
                        className="gv-toast-close"
                        onClick={e => { e.stopPropagation(); onDismiss(t.id); }}
                        aria-label="Dismiss"
                    >×</button>
                    <div className="gv-toast-bar" />
                </div>
            ))}
        </div>
    );
}

function LeafIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>;
}

function FriendsIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}

function MsgIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}

function PhoneIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
}

function RemoveIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}

function CloseIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
