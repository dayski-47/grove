import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GroveSocket } from "../socket";
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, removeFriend,
    getChannelReactions, logout, deleteAccount, getUserProfile,
    getChannelPins, pinMessage, unpinMessage, searchUsers,
    joinByCode, getChannelMembers,
} from "../api";
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate,
    type EditUpdate, type DeleteUpdate, type UserProfile,
    type PinnedMessage, type ChannelRole,
} from "../types";
import type { DisplayMessage } from "./MessageList";
import { ChatView } from "./ChatView";
import { useWebRTC } from "../useWebRTC";
import { packMessage } from "../protocol";
import type { ActivityStatus } from "./ProfileMenu";
import {
    makeLeaf, makeEmptyPaneContent, countLeaves, getLeaves, findLeafById,
    splitAuto, splitDirectional, removePane, deriveChromeState, toggleMultiPaneState,
    resizeSplit,
    MAX_PANES,
    type PaneTreeNode, type PaneContent, type SplitDirection,
} from "../paneLayout";
import { usePaneKeybinds } from "../hooks/usePaneKeybinds";
import { PaneChrome } from "./panes/PaneChrome";
import { PaneGrid } from "./panes/PaneGrid";
import { CommandIsland, type IslandAction } from "./panes/CommandIsland";
import { DetailsPane } from "./panes/DetailsPane";
import { avatarBg, avatarInitial } from "../lib/avatar";
import { BellIcon, FriendsIcon, SearchIcon } from "./appshell/icons";
import { EmptyContent } from "./appshell/EmptyContent";
import { CornerBranches } from "./appshell/CornerBranches";
import { CallInline } from "./appshell/CallInline";
import { ProfileDrawer } from "./appshell/ProfileDrawer";
import { NotifPanel } from "./appshell/NotifPanel";
import { ToastContainer, type Toast } from "./appshell/ToastContainer";
import { ConnectionBanner } from "./appshell/ConnectionBanner";

// Lazy-loaded: both are only ever needed after the user navigates to Friends
// or opens channel Settings, so they shouldn't be in the initial bundle.
const FriendsPage = lazy(() =>
    import("./appshell/FriendsPage").then(m => ({ default: m.FriendsPage })),
);
const ChannelSettingsModal = lazy(() =>
    import("./ChannelSettingsModal").then(m => ({ default: m.ChannelSettingsModal })),
);

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
    const [createCategory, setCreateCategory] = useState("");
    const [createPrivate, setCreatePrivate]   = useState(false);
    const [paletteMode, setPaletteMode] = useState<"default" | "browse" | "join-code" | "create-options">("default");
    const [joinCodeDraft, setJoinCodeDraft] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [myChannelRoles, setMyChannelRoles] = useState<Record<number, ChannelRole>>({});

    /* Pane tiling */
    const [paneRoot, setPaneRoot]                     = useState<PaneTreeNode | null>(null);
    const [focusedPaneId, setFocusedPaneId]           = useState<string | null>(null);
    const [hoveredPaneId, setHoveredPaneId]           = useState<string | null>(null);
    const [lastMultiPaneState, setLastMultiPaneState] = useState<"state2" | "state3">("state2");
    const [islandOpen, setIslandOpen]                 = useState(false);
    const [settingsChannelId, setSettingsChannelId]   = useState<number | null>(null);
    const [pillHovered, setPillHovered]               = useState(false);

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
    const paletteModeRef = useRef<"default" | "browse" | "join-code" | "create-options">("default");
    const paneRootRef     = useRef<PaneTreeNode | null>(null);
    const visibleChannelIdsRef = useRef<number[]>([]);
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
                setPaletteMode("default");
            }
            if (e.key === "Escape") {
                if (paletteModeRef.current !== "default") {
                    setPaletteMode("default");
                } else {
                    setPaletteOpen(false);
                }
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
            if (paneRootRef.current !== null) return; // pane mode active — usePaneKeybinds owns these keys instead
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

    /* ── Pane-tiling keyboard shortcuts ──────────────────── */

    usePaneKeybinds({
        isPaneModeActive: () => paneRootRef.current !== null,
        getFocusedPaneId: () => focusedPaneId,
        getHoveredPaneId: () => hoveredPaneId,
        onCreateSplit: () => {
            // paneRoot/focusedPaneId/activeChannelId below are always the
            // current render's values — usePaneKeybinds refreshes its actions
            // ref every render (Task 8), so this closure is never stale.
            if (paneRoot === null) {
                if (activeChannelId === null) return; // nothing to split from yet
                const newPaneId = crypto.randomUUID();
                const firstLeaf = makeLeaf({
                    paneId: `solo-${activeChannelId}`,
                    kind: activeChannelKind,
                    channelId: activeChannelId,
                    channelName: activeDisplayName,
                });
                setPaneRoot(splitAuto(firstLeaf, firstLeaf.pane.paneId, makeEmptyPaneContent(newPaneId)));
                setFocusedPaneId(newPaneId);
                return;
            }
            if (focusedPaneId === null || countLeaves(paneRoot) >= MAX_PANES) return;
            const newPaneId = crypto.randomUUID();
            setPaneRoot(splitAuto(paneRoot, focusedPaneId, makeEmptyPaneContent(newPaneId)));
            setFocusedPaneId(newPaneId);
        },
        onDirectionalSplit: (direction: SplitDirection) => {
            if (paneRoot === null) {
                if (activeChannelId === null) return;
                const newPaneId = crypto.randomUUID();
                const firstLeaf = makeLeaf({
                    paneId: `solo-${activeChannelId}`,
                    kind: activeChannelKind,
                    channelId: activeChannelId,
                    channelName: activeDisplayName,
                });
                setPaneRoot(splitDirectional(firstLeaf, firstLeaf.pane.paneId, makeEmptyPaneContent(newPaneId), direction));
                setFocusedPaneId(newPaneId);
                return;
            }
            const targetId = hoveredPaneId ?? focusedPaneId;
            if (targetId === null || countLeaves(paneRoot) >= MAX_PANES) return;
            const newPaneId = crypto.randomUUID();
            const result = splitDirectional(paneRoot, targetId, makeEmptyPaneContent(newPaneId), direction);
            if (result === paneRoot) return; // no-op — targetId no longer exists in the tree
            setPaneRoot(result);
            setFocusedPaneId(newPaneId);
        },
        onCollapseChrome: () => setLastMultiPaneState(prev => prev === "state2" ? "state3" : prev),
        onExpandChrome:   () => setLastMultiPaneState(prev => prev === "state3" ? "state2" : prev),
        onToggleIsland:   () => setIslandOpen(v => !v),
        onClosePane: closePane,
        onSwitchToPaneIndex: (index: number) => {
            if (paneRoot === null) return;
            const leaves = getLeaves(paneRoot);
            const target = leaves[index];
            if (target) setFocusedPaneId(target.pane.paneId);
        },
    });

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
                    const isBackground = !visibleChannelIdsRef.current.includes(msg.channelId);
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

    async function ensureChannelLoaded(channelId: number, kind: "channel" | "dm") {
        // Populate the caller's role for this channel lazily, the first time it's
        // opened — needed so Delete's moderator gating works even before the
        // settings modal has ever been opened.
        if (kind === "channel" && !(channelId in myChannelRoles)) {
            getChannelMembers(channelId, token)
                .then(members => {
                    const me = members.find(m => m.user_id === userId);
                    if (me) setMyChannelRoles(prev => ({ ...prev, [channelId]: me.role }));
                })
                .catch(() => {});
        }

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

    function markRecentAndClearUnread(channelId: number) {
        dismissChannelToasts(channelId);
        setUnread(prev => { const n = { ...prev }; delete n[channelId]; return n; });
        setRecentIds(prev => [channelId, ...prev.filter(id => id !== channelId)].slice(0, 10));
    }

    async function openChannel(channelId: number, displayName: string, kind: "channel" | "dm" = "channel") {
        markRecentAndClearUnread(channelId);
        setActiveCh(channelId);
        setActiveKind(kind);
        setActiveName(displayName);
        setActivePage("chat");
        setOpenTabs(prev => prev.find(t => t.id === channelId) ? prev : [...prev, { id: channelId, name: displayName, kind }]);
        setPaletteOpen(false);
        await ensureChannelLoaded(channelId, kind);
    }

    async function fillFocusedPane(channelId: number, displayName: string, kind: "channel" | "dm") {
        markRecentAndClearUnread(channelId);
        setPaletteOpen(false);
        setActivePage("chat"); // navigating away from Friends must always surface the pane grid
        const targetId = focusedPaneId
            ?? (paneRoot !== null ? getLeaves(paneRoot).find(l => l.pane.kind !== "details")?.pane.paneId ?? null : null);
        if (targetId !== null) {
            setPaneRoot(prev => prev === null ? prev : replacePaneContent(prev, targetId, {
                paneId: targetId, kind, channelId, channelName: displayName,
            }));
            setFocusedPaneId(targetId);
        }
        await ensureChannelLoaded(channelId, kind);
    }

    /** Routes "navigate to this conversation" to the right place depending on
        whether pane mode is active — State 1 keeps today's single-active-channel
        behavior; pane mode fills whichever pane currently has focus. */
    function openOrFill(channelId: number, displayName: string, kind: "channel" | "dm") {
        if (paneRoot === null) openChannel(channelId, displayName, kind);
        else fillFocusedPane(channelId, displayName, kind);
    }

    function replacePaneContent(root: PaneTreeNode, paneId: string, content: PaneContent): PaneTreeNode {
        if (root.type === "leaf") {
            return root.pane.paneId === paneId ? makeLeaf(content) : root;
        }
        return { ...root, a: replacePaneContent(root.a, paneId, content), b: replacePaneContent(root.b, paneId, content) };
    }

    function closeTab(tabId: number) {
        if (activeChannelId === tabId) {
            const idx       = openTabs.findIndex(t => t.id === tabId);
            const remaining = openTabs.filter(t => t.id !== tabId);
            const adj       = remaining[idx] ?? remaining[idx - 1] ?? null;
            if (adj) openOrFill(adj.id, adj.name, adj.kind);
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
            const ids = prev.filter(t => t.channelId === channelId && !t.leaving && !t.persistent).map(t => t.id);
            if (ids.length === 0) return prev;
            ids.forEach(id => setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 220));
            return prev.map(t => t.channelId === channelId && !t.persistent ? { ...t, leaving: true } : t);
        });
    }

    async function openDmWith(partnerId: number) {
        const existing = dms.find(d => d.partner_id === partnerId);
        if (existing) { openOrFill(existing.channel_id, existing.partner_name, "dm"); return; }
        try {
            const { channel_id } = await openDm(partnerId, token);
            const name = usernames[partnerId] ?? `user ${partnerId}`;
            setDms(prev => [{ channel_id, partner_id: partnerId, partner_name: name }, ...prev]);
            openOrFill(channel_id, name, "dm");
        } catch { /* ignore */ }
    }

    async function handleCreateChannel() {
        const name = paletteQuery.trim().replace(/^#/, "");
        if (!name) return;
        try {
            const res = await createChannel(name, token, {
                category:   createCategory.trim() || undefined,
                is_private: createPrivate,
            });
            setChannels(prev => [...prev, {
                id: res.channel_id, name,
                category: createCategory.trim() || undefined,
                is_private: createPrivate,
            }]);
            if (res.invite_code) {
                const tid = crypto.randomUUID();
                setToasts(prev => [...prev, {
                    id:          tid,
                    channelId:   res.channel_id,
                    channelName: name,
                    kind:        "channel",
                    senderName:  "Channel created",
                    preview:     `Invite code: ${res.invite_code}`,
                    leaving:     false,
                    persistent:  true,
                }]);
                setTimeout(() => dismissToast(tid), 8000);
            }
            setCreateCategory("");
            setCreatePrivate(false);
            setPaletteMode("default");
            openOrFill(res.channel_id, name, "channel");
        } catch { /* ignore */ }
    }

    async function handleJoinByCode() {
        const code = joinCodeDraft.trim();
        if (!code) return;
        try {
            const res = await joinByCode(code, token);
            setChannels(prev => prev.some(c => c.id === res.channel_id)
                ? prev
                : [...prev, { id: res.channel_id, name: res.name, is_private: true }]);
            setJoinCodeDraft("");
            setPaletteMode("default");
            openOrFill(res.channel_id, res.name, "channel");
        } catch {
            setToasts(prev => [...prev, {
                id:          crypto.randomUUID(),
                channelId:   -1,
                channelName: "",
                kind:        "channel",
                senderName:  "Join failed",
                preview:     "Invalid or expired invite code",
                leaving:     false,
            }]);
        }
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

    async function handleDeleteAccount() {
        await deleteAccount(token).catch(() => {});
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
                { kind: "action", id: "browse-channels", label: "Browse all channels", icon: "🗂" },
                { kind: "action", id: "join-private", label: "Join private channel", icon: "🔒" },
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
            openOrFill(item.id, item.name, "channel");
        } else if (item.kind === "dm") {
            if (item.id < 0) {
                openDmWith(item.partnerId);
            } else {
                openOrFill(item.id, item.name, "dm");
            }
        } else if (item.kind === "action") {
            if (item.id === "friends") { setActivePage("friends"); setPaletteOpen(false); }
            if (item.id === "create")  setPaletteMode("create-options");
            if (item.id === "browse-channels") setPaletteMode("browse");
            if (item.id === "join-private")    setPaletteMode("join-code");
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
            if (paletteMode !== "default") {
                setPaletteMode("default");
            } else {
                setPaletteOpen(false);
            }
        }
    }

    /* Keep latest-value refs in sync (runs every render, before any effect) */
    tabsForKeys.current   = openTabs;
    activeForKeys.current = activeChannelId;
    channelsRef.current   = channels;
    dmsRef.current        = dms;
    usernamesRef.current  = usernames;
    paletteModeRef.current = paletteMode;
    paneRootRef.current    = paneRoot;
    visibleChannelIdsRef.current = paneRoot === null
        ? (activeChannelId !== null ? [activeChannelId] : [])
        : getLeaves(paneRoot).map(l => l.pane.channelId).filter((id): id is number => id !== null);

    /* ── Command island actions ─────────────────────────── */

    function handleIslandAction(action: IslandAction) {
        setIslandOpen(false);
        if (action === "channels") {
            setPaletteOpen(true); setPaletteMode("browse"); setPaletteQuery(""); setPaletteIdx(0);
        } else if (action === "messages") {
            setPaletteOpen(true); setPaletteMode("default"); setPaletteQuery(""); setPaletteIdx(0);
        } else if (action === "users") {
            setActivePage("friends");
        } else if (action === "notifications") {
            setNotifOpen(true);
        } else if (action === "settings") {
            const focusedChannelId = focusedPaneId !== null
                ? (findLeafById(paneRoot, focusedPaneId)?.pane.channelId ?? null)
                : activeChannelId;
            if (focusedChannelId !== null) {
                setSettingsChannelId(focusedChannelId);
                setSettingsOpen(true);
            }
        }
        // "activity" and "more" are reserved for future icons — no action yet.
    }

    /** Closes the pane identified by `paneId`, promoting the remaining leaf
        back to the State-1 tab list when only one real pane is left (or
        clearing the active channel entirely when none remain). Shared by
        the Ctrl+Shift+W keybind (usePaneKeybinds) and the visible pane-close
        buttons in ChatView's minimal header and PaneGrid's own header. */
    function closePane(paneId: string) {
        if (paneRoot === null) return;
        const result = removePane(paneRoot, paneId);
        if (result === null || result.type === "leaf") {
            const survivor = result?.type === "leaf" ? result.pane : null;
            setPaneRoot(null);
            if (survivor && survivor.channelId !== null) {
                const channelId = survivor.channelId;
                const kind = survivor.kind === "dm" ? "dm" : "channel";
                setActiveCh(channelId);
                setActiveName(survivor.channelName);
                setActiveKind(kind);
                // Restore this channel to the State 1 tab list — it may have
                // been filled into a pane mid-tiling without ever going
                // through openChannel/setOpenTabs.
                setOpenTabs(prev => prev.find(t => t.id === channelId)
                    ? prev
                    : [...prev, { id: channelId, name: survivor.channelName, kind }]);
            } else {
                setActiveCh(null);
                setActiveName("");
            }
            setFocusedPaneId(null);
            return;
        }
        setPaneRoot(result);
        const remaining = getLeaves(result);
        if (!remaining.some(l => l.pane.paneId === focusedPaneId)) {
            setFocusedPaneId(remaining[0]?.pane.paneId ?? null);
        }
    }

    /** Opens (or reuses) a Details pane for `channelId`, tiled beside
        `sourcePaneId` — or, if pane mode isn't active yet, beside a
        synthesized first leaf built from the current State-1 conversation.
        Per spec, this never changes chromeState on its own — deriveChromeState
        already guarantees that by ignoring "details" leaves. */
    function openDetailsForPane(channelId: number, channelName: string, sourcePaneId: string | null) {
        if (countLeaves(paneRoot) >= MAX_PANES) return;
        const detailsContent: PaneContent = {
            paneId: crypto.randomUUID(), kind: "details", channelId,
            channelName: `${channelName} details`,
        };
        if (paneRoot === null) {
            const firstLeaf = makeLeaf({
                paneId: sourcePaneId ?? crypto.randomUUID(),
                kind: activeChannelKind, channelId, channelName,
            });
            setPaneRoot(splitDirectional(firstLeaf, firstLeaf.pane.paneId, detailsContent, "right"));
            setFocusedPaneId(firstLeaf.pane.paneId);
            return;
        }
        if (sourcePaneId === null) return;
        setPaneRoot(prev => prev === null ? prev : splitDirectional(prev, sourcePaneId, detailsContent, "right"));
    }

    /* ── Per-pane content dispatch ───────────────────────── */

    function sendToChannel(channelId: number, text: string) {
        const now = Math.floor(Date.now() / 1000);
        const clientId = crypto.randomUUID();
        setMessages(prev => ({
            ...prev,
            [channelId]: [...(prev[channelId] ?? []), { userId, text, timestamp: now, pending: true, clientId }],
        }));
        socketRef.current?.sendText(channelId, text);
    }

    const pinInChannel = useCallback(async (channelId: number, msgId: number) => {
        await pinMessage(msgId, token).catch(() => {});
        const list = await getChannelPins(channelId, token).catch(() => [] as PinnedMessage[]);
        setPins(prev => ({ ...prev, [channelId]: list }));
    }, [token]);

    const unpinInChannel = useCallback(async (channelId: number, msgId: number) => {
        await unpinMessage(msgId, token).catch(() => {});
        setPins(prev => ({ ...prev, [channelId]: (prev[channelId] ?? []).filter(p => p.message_id !== msgId) }));
    }, [token]);

    // Stable callbacks for the solo ChatView — MessageRow's React.memo only
    // works if these don't change identity on every unrelated render.
    // (renderPaneContent below doesn't get the same treatment — it's a
    // plain helper, not a component, so it can't hold its own useCallback.)
    const handleSoloReact = useCallback((msgId: number, emoji: string) => {
        if (activeChannelId !== null) socketRef.current?.sendReaction(activeChannelId, msgId, emoji);
    }, [activeChannelId]);
    const handleSoloEdit = useCallback((msgId: number, text: string) => {
        if (activeChannelId !== null) socketRef.current?.sendEdit(activeChannelId, msgId, text);
    }, [activeChannelId]);
    const handleSoloDelete = useCallback((msgId: number) => {
        if (activeChannelId !== null) socketRef.current?.sendDelete(activeChannelId, msgId);
    }, [activeChannelId]);
    const handleSoloPin = useCallback((msgId: number) => {
        if (activeChannelId !== null) pinInChannel(activeChannelId, msgId);
    }, [activeChannelId, pinInChannel]);
    const handleSoloUnpin = useCallback((msgId: number) => {
        if (activeChannelId !== null) unpinInChannel(activeChannelId, msgId);
    }, [activeChannelId, unpinInChannel]);
    const handleSoloUserClick = useCallback((uid: number) => {
        setDrawerUid(uid);
        setDrawerOpen(true);
        resolveProfile(uid);
    }, [resolveProfile]);

    function renderPaneContent(pane: PaneContent) {
        if (pane.kind === "notification") {
            return (
                <NotifPanel
                    channels={channels}
                    dms={dms}
                    unreads={unreadByChannel}
                    onNavigate={(id, name, kind) => openOrFill(id, name, kind)}
                    onClose={() => {}}
                />
            );
        }
        if (pane.kind === "details") {
            return <DetailsPane channelId={pane.channelId} messages={pane.channelId !== null ? (messages[pane.channelId] ?? []) : []} />;
        }
        if (pane.channelId === null) {
            return (
                <div className="pane-empty-content">
                    <svg className="pane-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
                        <path d="M12 9v6M9 12h6" />
                    </svg>
                    <p className="pane-empty-label">Empty pane</p>
                    <p className="pane-empty-kbd">Press <kbd>Ctrl K</kbd> to fill</p>
                </div>
            );
        }
        const channelId = pane.channelId;
        const role: ChannelRole = myChannelRoles[channelId] ?? "member";
        return (
            <ChatView
                channelId={channelId}
                channelName={pane.channelName}
                isDm={pane.kind === "dm"}
                myRole={role}
                onOpenSettings={pane.kind === "channel" ? () => { setSettingsChannelId(channelId); setSettingsOpen(true); } : undefined}
                onOpenDetails={() => openDetailsForPane(channelId, pane.channelName, pane.paneId)}
                headerMode={chromeState === "state1" ? "full" : chromeState === "state2" ? "none" : "minimal"}
                onClosePane={() => closePane(pane.paneId)}
                messages={messages[channelId] ?? []}
                usernames={usernames}
                currentUserId={userId}
                myUsername={myName}
                typingNames={[...(typingUsers[channelId] ?? new Map()).keys()].map(uid => usernames[uid] ?? `user ${uid}`)}
                connected={connected}
                hasMore={hasMore[channelId] ?? false}
                loadingMore={loadingMore.has(channelId)}
                reactions={reactions[channelId] ?? {}}
                pins={pins[channelId] ?? []}
                mentionUsers={mentionUsers}
                onSend={text => sendToChannel(channelId, text)}
                onTyping={() => socketRef.current?.sendTyping(channelId)}
                onLoadMore={() => loadMoreMessages(channelId)}
                onReact={(msgId, emoji) => socketRef.current?.sendReaction(channelId, msgId, emoji)}
                onEdit={(msgId, text) => socketRef.current?.sendEdit(channelId, msgId, text)}
                onDelete={msgId => socketRef.current?.sendDelete(channelId, msgId)}
                onPin={msgId => pinInChannel(channelId, msgId)}
                onUnpin={msgId => unpinInChannel(channelId, msgId)}
                onUserClick={uid => { setDrawerUid(uid); setDrawerOpen(true); resolveProfile(uid); }}
            />
        );
    }

    /* ── Derived values ─────────────────────────────────── */

    const myName    = usernames[userId] ?? `user ${userId}`;
    const myProfile = profiles[userId];

    const totalUnread = Object.values(unreadByChannel).reduce((s, n) => s + n, 0);

    const myRole: ChannelRole = activeChannelId !== null ? (myChannelRoles[activeChannelId] ?? "member") : "member";

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

    const chromeState = deriveChromeState(paneRoot, lastMultiPaneState);

    /** The tiled/single-conversation content for <main> — same element whether
        chromeState is state1 (rendered bare) or state2/3 (rendered inside the
        ".dw-tiled-body" row alongside the reserved ".dw-tiled-rail" chrome strip). */
    const paneContent = paneRoot !== null ? (
        <PaneGrid
            root={paneRoot}
            chromeState={chromeState === "state2" ? "state2" : "state3"}
            focusedPaneId={focusedPaneId}
            pillHovered={pillHovered}
            onFocusPane={setFocusedPaneId}
            onHoverPane={setHoveredPaneId}
            onOpenDetails={paneId => {
                const leaf = findLeafById(paneRoot, paneId);
                if (!leaf || leaf.pane.channelId === null) return;
                openDetailsForPane(leaf.pane.channelId, leaf.pane.channelName, paneId);
            }}
            onClosePane={closePane}
            onResizeSplit={(path, ratio) => setPaneRoot(prev => prev === null ? prev : resizeSplit(prev, path, ratio))}
            renderContent={renderPaneContent}
        />
    ) : activeChannelId !== null ? (
        <motion.div
            layoutId={`solo-${activeChannelId}`}
            layout
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="pane-solo-cell"
        >
            <ChatView
                channelId={activeChannelId}
                channelName={activeDisplayName}
                isDm={activeChannelKind === "dm"}
                myRole={myRole}
                onOpenSettings={() => { setSettingsChannelId(activeChannelId); setSettingsOpen(true); }}
                onOpenDetails={() => openDetailsForPane(activeChannelId, activeDisplayName, null)}
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
                onSend={text => sendToChannel(activeChannelId, text)}
                onTyping={() => socketRef.current?.sendTyping(activeChannelId)}
                onLoadMore={() => loadMoreMessages(activeChannelId)}
                onReact={handleSoloReact}
                onEdit={handleSoloEdit}
                onDelete={handleSoloDelete}
                onPin={handleSoloPin}
                onUnpin={handleSoloUnpin}
                onUserClick={handleSoloUserClick}
            />
        </motion.div>
    ) : (
        <EmptyContent />
    );

    /* ── Render ─────────────────────────────────────────── */

    return (
        <div className="dw-shell dw-shell-v3">
            <CornerBranches />
            {/* ── Top bar ─────────────────────────────── */}
            {/* State 1 keeps the full floating bar with the utility cluster (notif/friends/avatar).
                State 2/3 render only the chrome shape (pill/circle), reserved in-flow inside the
                ".dw-tiled-rail" strip alongside <main> (see below) — the utility cluster tucks away
                entirely in those states, reachable only via the Dynamic Island or Ctrl+K per the
                design spec. */}
            {chromeState === "state1" && (
                <header className="dw-topbar" role="banner">
                    {!islandOpen && (
                        <PaneChrome
                            mode={chromeState}
                            tabs={openTabs}
                            activeTabId={activeChannelId}
                            onSelectTab={(id, name, kind) => openOrFill(id, name, kind)}
                            onCloseTab={closeTab}
                            paneLeaves={paneRoot !== null ? getLeaves(paneRoot) : []}
                            focusedPaneId={focusedPaneId}
                            onFocusPane={setFocusedPaneId}
                            onPillHoverChange={setPillHovered}
                            totalUnread={totalUnread}
                            onLogoClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); setPaletteMode("default"); }}
                            onToggleMultiPaneState={() => setLastMultiPaneState(toggleMultiPaneState)}
                        />
                    )}

                    <div className="dw-topbar-actions">
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
                                    onNavigate={(id, name, kind) => openOrFill(id, name, kind)}
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
            )}

            <ConnectionBanner connected={connected} />

            {/* ── Content ─────────────────────────────── */}
            <main className="dw-content" aria-label="Main content">
                {activePage === "friends" ? (
                    <Suspense fallback={null}>
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
                    </Suspense>
                ) : chromeState !== "state1" ? (
                    /* State 2/3 — the chrome pill/circle is reserved in-flow space next to
                       the tiled content, Hyprland-status-bar style, instead of floating on
                       top of it. See .dw-tiled-rail / .dw-tiled-body in darkwood.css. */
                    <div className="dw-tiled-body">
                        {!islandOpen && (
                            <div className="dw-tiled-rail">
                                <PaneChrome
                                    mode={chromeState}
                                    tabs={openTabs}
                                    activeTabId={activeChannelId}
                                    onSelectTab={(id, name, kind) => openOrFill(id, name, kind)}
                                    onCloseTab={closeTab}
                                    paneLeaves={paneRoot !== null ? getLeaves(paneRoot) : []}
                                    focusedPaneId={focusedPaneId}
                                    onFocusPane={setFocusedPaneId}
                                    onPillHoverChange={setPillHovered}
                                    totalUnread={totalUnread}
                                    onLogoClick={() => { setPaletteOpen(v => !v); setPaletteQuery(""); setPaletteIdx(0); setPaletteMode("default"); }}
                                    onToggleMultiPaneState={() => setLastMultiPaneState(toggleMultiPaneState)}
                                />
                                {/* Notifications still need to be reachable (via the Dynamic Island's
                                    "notifications" action) even though the bell button itself is gone
                                    in this state — anchor the panel to the rail instead of the viewport. */}
                                {notifOpen && (
                                    <div className="dw-notif-wrap-floating" ref={notifRef}>
                                        <NotifPanel
                                            channels={channels}
                                            dms={dms}
                                            unreads={unreadByChannel}
                                            onNavigate={(id, name, kind) => openOrFill(id, name, kind)}
                                            onClose={() => setNotifOpen(false)}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="dw-tiled-content">
                            {paneContent}
                        </div>
                    </div>
                ) : (
                    paneContent
                )}
            </main>

            <CommandIsland open={islandOpen} onSelect={handleIslandAction} onClose={() => setIslandOpen(false)} />

            {settingsOpen && settingsChannelId !== null && (() => {
                const settingsChannel = channels.find(c => c.id === settingsChannelId);
                if (!settingsChannel) return null;
                return (
                    <Suspense fallback={null}>
                        <ChannelSettingsModal
                            channelId={settingsChannelId}
                            channelName={settingsChannel.name}
                            description={settingsChannel.description}
                            category={settingsChannel.category}
                            isPrivate={settingsChannel.is_private}
                            token={token}
                            currentUserId={userId}
                            myRole={myChannelRoles[settingsChannelId] ?? "member"}
                            onClose={() => setSettingsOpen(false)}
                            onUpdated={updates => setChannels(prev => prev.map(c => (
                                c.id === settingsChannelId ? { ...c, ...updates } : c
                            )))}
                        />
                    </Suspense>
                );
            })()}

            {/* ── Command palette ──────────────────────── */}
            {paletteOpen && (
                <>
                    <div
                        className="dw-palette-backdrop"
                        onClick={() => { setPaletteOpen(false); setPaletteMode("default"); }}
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

                        {paletteMode === "join-code" && (
                            <div className="dw-palette-join-code">
                                <input
                                    className="dw-palette-input"
                                    placeholder="Enter invite code…"
                                    value={joinCodeDraft}
                                    onChange={e => setJoinCodeDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") handleJoinByCode(); }}
                                    autoFocus
                                    aria-label="Invite code"
                                />
                                <button className="dw-modal-btn-primary" onClick={handleJoinByCode}>
                                    Join
                                </button>
                            </div>
                        )}

                        {paletteMode === "create-options" && (
                            <div className="dw-palette-create-options">
                                <div className="dw-palette-create-name">
                                    Create <span className="dw-palette-hash">#</span>
                                    {paletteQuery.trim().replace(/^#/, "")}
                                </div>
                                <input
                                    className="dw-palette-input"
                                    placeholder="Category (optional)"
                                    value={createCategory}
                                    onChange={e => setCreateCategory(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") handleCreateChannel(); }}
                                    autoFocus
                                    aria-label="Channel category"
                                />
                                <label className="dw-palette-create-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={createPrivate}
                                        onChange={e => setCreatePrivate(e.target.checked)}
                                    />
                                    Private channel
                                </label>
                                <button className="dw-modal-btn-primary" onClick={handleCreateChannel}>
                                    Create channel
                                </button>
                            </div>
                        )}

                        {paletteMode === "browse" && (
                            <ul className="dw-palette-list" id="palette-list" role="listbox">
                                {Object.entries(
                                    channels.reduce<Record<string, Channel[]>>((groups, ch) => {
                                        const key = ch.category?.trim() || "Channels";
                                        (groups[key] ??= []).push(ch);
                                        return groups;
                                    }, {}),
                                ).map(([groupName, chans]) => (
                                    <Fragment key={groupName}>
                                        <li className="dw-palette-category" role="presentation">{groupName}</li>
                                        {chans.map(ch => (
                                            <li
                                                key={ch.id}
                                                className="dw-palette-item"
                                                role="option"
                                                aria-selected={false}
                                                onMouseDown={e => { e.preventDefault(); openOrFill(ch.id, ch.name, "channel"); setPaletteOpen(false); }}
                                            >
                                                <span className="dw-palette-icon dw-palette-hash">#</span>
                                                <span className="dw-palette-label">{ch.name}</span>
                                            </li>
                                        ))}
                                    </Fragment>
                                ))}
                            </ul>
                        )}

                        {paletteMode === "default" && paletteItems.length > 0 && (
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

                        {paletteMode === "default" && paletteItems.length === 0 && q && (
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
                    onDeleteAccount={handleDeleteAccount}
                />
            )}

            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />

            {/* ── Toast notifications ──────────────────── */}
            <ToastContainer
                toasts={toasts}
                onDismiss={dismissToast}
                onNavigate={(id, name, kind) => openOrFill(id, name, kind)}
            />
        </div>
    );
}

