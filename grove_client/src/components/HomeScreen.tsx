// src/components/HomeScreen.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import {
    getHistory, joinChannel, createChannel, listChannels,
    openDm, listDms, listFriends, addFriend, getChannelReactions, logout,
    updateAbout, getUserProfile,
} from "../api";
import {
    MessageType, type ParsedMessage, type SignalingMessage,
    type DmInfo, type FriendInfo, type ReactionUpdate, type EditUpdate,
    type DeleteUpdate, type UserProfile,
} from "../types";
import type { DisplayMessage } from "./MessageList";
import { ChannelWindow } from "./ChannelWindow";
import { ChannelListWindow } from "./ChannelListWindow";
import { FriendsWindow } from "./FriendsWindow";
import { DmsWindow } from "./DmsWindow";
import { TaskBar } from "./TaskBar";
import { CallPopup } from "./CallPopup";
import { UserPopover } from "./UserPopover";
import { ProfileMenu, type ActivityStatus } from "./ProfileMenu";
import { useWebRTC } from "../useWebRTC";
import { packMessage } from "../protocol";

const APP_TILE_COLORS: Record<string, string> = {
    channels: "linear-gradient(135deg, #1a7fd4 0%, #0a52a8 100%)",
    friends:  "linear-gradient(135deg, #2d8a3c 0%, #1a5828 100%)",
    dms:      "linear-gradient(135deg, #7b52c8 0%, #4a2e8c 100%)",
};

interface Channel { id: number; name: string; }
interface WindowState {
    channelId:   number;
    x:           number;
    y:           number;
    zIndex:      number;
    kind:        "channel" | "dm";
    displayName: string;
    partnerId?:  number;
}
type AppKind = "channels" | "friends" | "dms";
interface AppWindowState { kind: AppKind; x: number; y: number; zIndex: number; }

type EmojiMap     = Record<string, { count: number; byMe: boolean }>;
type ReactionsMap = Record<number, EmojiMap>;

interface PopoverState {
    userId: number;
    x:      number;
    y:      number;
}

export function HomeScreen({
    token,
    userId,
    onLogout,
}: {
    token:    string;
    userId:   number;
    onLogout: () => void;
}) {
    const [channels, setChannels]       = useState<Channel[]>([]);
    const [dms, setDms]                 = useState<DmInfo[]>([]);
    const [friends, setFriends]         = useState<FriendInfo[]>([]);
    const [messages, setMessages]       = useState<Record<number, DisplayMessage[]>>({});
    const [connected, setConnected]     = useState(false);
    const [usernames, setUsernames]     = useState<Record<number, string>>({});
    const [profiles, setProfiles]       = useState<Record<number, UserProfile>>({});
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<number, Map<number, number>>>({});
    const [windows, setWindows]         = useState<WindowState[]>([]);
    const [appWindows, setAppWindows]   = useState<AppWindowState[]>([]);
    const [reactions, setReactions]     = useState<Record<number, ReactionsMap>>({});
    const [popover, setPopover]         = useState<PopoverState | null>(null);
    const [myAbout, setMyAbout]         = useState(() => localStorage.getItem("grove_about") ?? "");
    const [myStatus, setMyStatus]       = useState<ActivityStatus>(
        () => (localStorage.getItem("grove_status") as ActivityStatus) ?? "online",
    );

    const socketRef   = useRef<GroveSocket | null>(null);
    const loadedRef   = useRef<Set<number>>(new Set());
    const zRef        = useRef(100);
    const oldestIdRef = useRef<Record<number, number>>({});
    const [hasMore,     setHasMore]     = useState<Record<number, boolean>>({});
    const [loadingMore, setLoadingMore] = useState<Set<number>>(new Set());

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

    const sendSignaling = useCallback(
        (msg: SignalingMessage) => { socketRef.current?.sendSignaling(msg); },
        [],
    );

    const { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal } =
        useWebRTC(userId, sendSignaling);

    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            setTypingUsers(prev => {
                let changed = false;
                const next = { ...prev };
                for (const key of Object.keys(next)) {
                    const chId    = Number(key);
                    const nextMap = new Map(next[chId]);
                    for (const [uid, ts] of nextMap) {
                        if (now - ts > 3000) { nextMap.delete(uid); changed = true; }
                    }
                    next[chId] = nextMap;
                }
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const socket = new GroveSocket(
            token, userId,
            (msg: ParsedMessage) => {
                if (msg.msgType === MessageType.TYPING) {
                    if (msg.userId !== userId) {
                        setTypingUsers(prev => {
                            const chMap = new Map(prev[msg.channelId] ?? []);
                            chMap.set(msg.userId, Date.now());
                            return { ...prev, [msg.channelId]: chMap };
                        });
                        resolveUsername(msg.userId);
                    }
                    return;
                }

                if (msg.msgType === MessageType.REACTION) {
                    const update = JSON.parse(msg.text) as ReactionUpdate;
                    setReactions(prev => {
                        const chMap  = { ...(prev[msg.channelId] ?? {}) };
                        const msgMap = { ...(chMap[update.message_id] ?? {}) };
                        if (update.count <= 0) {
                            delete msgMap[update.emoji];
                        } else {
                            const wasByMe = msgMap[update.emoji]?.byMe ?? false;
                            msgMap[update.emoji] = {
                                count: update.count,
                                byMe:  update.action === "add"
                                    ? (update.user_id === userId ? true  : wasByMe)
                                    : (update.action === "remove" && update.user_id === userId ? false : wasByMe),
                            };
                        }
                        chMap[update.message_id] = msgMap;
                        return { ...prev, [msg.channelId]: chMap };
                    });
                    return;
                }

                if (msg.msgType === MessageType.EDIT) {
                    const update = JSON.parse(msg.text) as EditUpdate;
                    setMessages(prev => {
                        const arr = prev[msg.channelId];
                        if (!arr) return prev;
                        return {
                            ...prev,
                            [msg.channelId]: arr.map(m =>
                                m.id === update.message_id
                                    ? { ...m, text: update.text, edited: true }
                                    : m,
                            ),
                        };
                    });
                    return;
                }

                if (msg.msgType === MessageType.DELETE) {
                    const update = JSON.parse(msg.text) as DeleteUpdate;
                    setMessages(prev => {
                        const arr = prev[msg.channelId];
                        if (!arr) return prev;
                        return {
                            ...prev,
                            [msg.channelId]: arr.map(m =>
                                m.id === update.message_id
                                    ? { ...m, text: "", deleted: true }
                                    : m,
                            ),
                        };
                    });
                    return;
                }

                if (msg.msgType === MessageType.TEXT) {
                    setMessages(prev => {
                        const arr = prev[msg.channelId] ?? [];
                        return {
                            ...prev,
                            [msg.channelId]: [
                                ...arr,
                                { id: msg.msgId, userId: msg.userId, text: msg.text, timestamp: msg.timestamp },
                            ],
                        };
                    });
                    resolveUsername(msg.userId);
                }
            },
            (isConn) => setConnected(isConn),
            (presenceUserId, online, name) => {
                setOnlineUsers(prev => {
                    const next = new Set(prev);
                    if (online) { next.add(presenceUserId); resolveUsername(presenceUserId, name); }
                    else        next.delete(presenceUserId);
                    return next;
                });
                setFriends(prev => prev.map(f =>
                    f.user_id === presenceUserId ? { ...f, online } : f,
                ));
            },
            handleSignal,
        );
        socket.connect();
        socketRef.current = socket;

        listChannels(token).then(chs => setChannels(chs.map(c => ({ id: c.id, name: c.name })))).catch(console.error);
        listDms(token).then(list => { setDms(list); list.forEach(d => resolveUsername(d.partner_id, d.partner_name)); }).catch(console.error);
        listFriends(token).then(setFriends).catch(console.error);
        resolveProfile(userId);

        return () => socket.disconnect();
    }, [token, userId, handleSignal, resolveUsername, resolveProfile]);

    // Broadcast status changes to other users
    function handleStatusChange(status: ActivityStatus) {
        setMyStatus(status);
        localStorage.setItem("grove_status", status);
        // Send a PRESENCE frame from the client to update others
        if (socketRef.current) {
            const ws = (socketRef.current as unknown as { ws: WebSocket | null }).ws;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(packMessage(MessageType.PRESENCE, userId, 0, status));
            }
        }
    }

    async function handleAboutSave(text: string) {
        setMyAbout(text);
        localStorage.setItem("grove_about", text);
        setProfiles(prev => {
            if (!prev[userId]) return prev;
            return { ...prev, [userId]: { ...prev[userId], about: text } };
        });
        await updateAbout(text, token).catch(() => {});
    }

    function bumpZ(): number {
        zRef.current++;
        return zRef.current;
    }

    async function openChannel(channelId: number, displayName: string, kind: "channel" | "dm" = "channel", partnerId?: number) {
        const exists = windows.find(w => w.channelId === channelId);
        if (exists) {
            const z = bumpZ();
            setWindows(prev => prev.map(w => w.channelId === channelId ? { ...w, zIndex: z } : w));
            return;
        }
        if (!loadedRef.current.has(channelId)) {
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
                        id:        m.id,
                        userId:    m.user_id,
                        text:      m.text,
                        timestamp: m.timestamp,
                        edited:    m.edited,
                        deleted:   m.deleted,
                    })),
                }));
                if (history.length > 0) {
                    oldestIdRef.current[channelId] = history[history.length - 1].id;
                }
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
            } catch { /* already member or join failed */ }
        }
        const offset = (windows.length % 8) * 28;
        setWindows(prev => [...prev, {
            channelId, x: 60 + offset, y: 40 + offset, zIndex: bumpZ(),
            kind, displayName, partnerId,
        }]);
    }

    async function handleJoinById(channelId: number) {
        // Try to open — if user isn't a member, joinChannel will add them
        const existing = channels.find(c => c.id === channelId);
        const name = existing?.name ?? `channel ${channelId}`;
        openChannel(channelId, name, "channel");
        if (!existing) {
            // Refresh channel list after join
            listChannels(token).then(chs => setChannels(chs.map(c => ({ id: c.id, name: c.name })))).catch(console.error);
        }
    }

    async function loadMoreMessages(channelId: number) {
        const before = oldestIdRef.current[channelId];
        if (!before) return;
        setLoadingMore(prev => new Set(prev).add(channelId));
        try {
            const older = await getHistory(channelId, token, before);
            if (older.length === 0) {
                setHasMore(prev => ({ ...prev, [channelId]: false }));
                return;
            }
            const prepend = older.slice().reverse().map(m => ({
                id:        m.id,
                userId:    m.user_id,
                text:      m.text,
                timestamp: m.timestamp,
                edited:    m.edited,
                deleted:   m.deleted,
            }));
            oldestIdRef.current[channelId] = older[older.length - 1].id;
            if (older.length < 50) setHasMore(prev => ({ ...prev, [channelId]: false }));
            setMessages(prev => ({
                ...prev,
                [channelId]: [...prepend, ...(prev[channelId] ?? [])],
            }));
            [...new Set(older.map(m => m.user_id))].forEach(uid => resolveUsername(uid));
        } catch { console.error("load more failed"); }
        finally {
            setLoadingMore(prev => { const s = new Set(prev); s.delete(channelId); return s; });
        }
    }

    async function openDmWith(partnerId: number) {
        const existing = dms.find(d => d.partner_id === partnerId);
        if (existing) { openChannel(existing.channel_id, existing.partner_name, "dm", partnerId); return; }
        try {
            const { channel_id } = await openDm(partnerId, token);
            const partnerName    = usernames[partnerId] ?? `user ${partnerId}`;
            const newDm: DmInfo  = { channel_id, partner_id: partnerId, partner_name: partnerName };
            setDms(prev => [newDm, ...prev]);
            openChannel(channel_id, partnerName, "dm", partnerId);
        } catch (e) { console.error("Failed to open DM", e); }
    }

    function openAppWindow(kind: AppKind) {
        const exists = appWindows.find(w => w.kind === kind);
        if (exists) {
            const z = bumpZ();
            setAppWindows(prev => prev.map(w => w.kind === kind ? { ...w, zIndex: z } : w));
            return;
        }
        const offset = (appWindows.length % 4) * 32;
        setAppWindows(prev => [...prev, { kind, x: 80 + offset, y: 60 + offset, zIndex: bumpZ() }]);
    }

    async function handleCreateChannel(name: string) {
        try {
            const res = await createChannel(name, token);
            const ch  = { id: res.channel_id, name };
            setChannels(prev => [...prev, ch]);
            openChannel(res.channel_id, name, "channel");
        } catch { console.error("Failed to create channel"); }
    }

    async function handleAddFriend(uid: number) {
        try {
            await addFriend(uid, token);
            const updated = await listFriends(token);
            setFriends(updated);
        } catch { console.error("Failed to add friend"); }
    }

    async function handleLogout() {
        await logout(token).catch(() => {});
        onLogout();
    }

    function handleUserHover(hoveredUserId: number, event: React.MouseEvent) {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        setPopover({ userId: hoveredUserId, x: rect.left, y: rect.bottom + 6 });
        resolveProfile(hoveredUserId);
    }

    const myName = usernames[userId] ?? `user ${userId}`;
    const myProfile = profiles[userId];

    return (
        <div className="grove-home" onClick={() => setPopover(null)}>
            <div className="grove-app-tiles" role="main">
                {(["channels", "friends", "dms"] as const).map((kind, i) => {
                    const labels: Record<string, string> = {
                        channels: "Channels",
                        friends:  "Friends",
                        dms:      "Messages",
                    };
                    const isOpen = appWindows.some(w => w.kind === kind);
                    return (
                        <div
                            key={kind}
                            className="grove-tile-float"
                            style={{ animationDelay: `${i * 0.5}s` }}
                        >
                            <button
                                className={`grove-app-tile${isOpen ? " grove-tile-open" : ""}`}
                                onClick={() => openAppWindow(kind)}
                                aria-label={labels[kind]}
                                aria-pressed={isOpen}
                            >
                                <div className="grove-app-tile-orb" style={{ background: APP_TILE_COLORS[kind] }}>
                                    <AppIcon kind={kind} />
                                </div>
                                <span className="grove-app-tile-label">{labels[kind]}</span>
                            </button>
                        </div>
                    );
                })}
            </div>

            {appWindows.map(aw => {
                if (aw.kind === "channels") return (
                    <ChannelListWindow
                        key="channels"
                        channels={channels}
                        openChannelIds={new Set(windows.filter(w => w.kind === "channel").map(w => w.channelId))}
                        x={aw.x} y={aw.y} zIndex={aw.zIndex}
                        onOpen={(id, name) => openChannel(id, name, "channel")}
                        onClose={() => setAppWindows(prev => prev.filter(w => w.kind !== "channels"))}
                        onFocus={() => { const z = bumpZ(); setAppWindows(prev => prev.map(w => w.kind === "channels" ? { ...w, zIndex: z } : w)); }}
                        onDrag={(x, y) => setAppWindows(prev => prev.map(w => w.kind === "channels" ? { ...w, x, y } : w))}
                        onCreateChannel={handleCreateChannel}
                        onJoinById={handleJoinById}
                    />
                );
                if (aw.kind === "friends") return (
                    <FriendsWindow
                        key="friends"
                        friends={friends}
                        token={token}
                        x={aw.x} y={aw.y} zIndex={aw.zIndex}
                        onClose={() => setAppWindows(prev => prev.filter(w => w.kind !== "friends"))}
                        onFocus={() => { const z = bumpZ(); setAppWindows(prev => prev.map(w => w.kind === "friends" ? { ...w, zIndex: z } : w)); }}
                        onDrag={(x, y) => setAppWindows(prev => prev.map(w => w.kind === "friends" ? { ...w, x, y } : w))}
                        onDm={openDmWith}
                        onCall={initiateCall}
                        onAddFriend={handleAddFriend}
                    />
                );
                if (aw.kind === "dms") return (
                    <DmsWindow
                        key="dms"
                        dms={dms}
                        onlineUsers={onlineUsers}
                        openChannelIds={new Set(windows.filter(w => w.kind === "dm").map(w => w.channelId))}
                        x={aw.x} y={aw.y} zIndex={aw.zIndex}
                        onOpen={(cid, name, pid) => openChannel(cid, name, "dm", pid)}
                        onClose={() => setAppWindows(prev => prev.filter(w => w.kind !== "dms"))}
                        onFocus={() => { const z = bumpZ(); setAppWindows(prev => prev.map(w => w.kind === "dms" ? { ...w, zIndex: z } : w)); }}
                        onDrag={(x, y) => setAppWindows(prev => prev.map(w => w.kind === "dms" ? { ...w, x, y } : w))}
                    />
                );
                return null;
            })}

            {windows.map(w => {
                const chMessages  = messages[w.channelId] ?? [];
                const chTyping    = [...(typingUsers[w.channelId] ?? new Map()).keys()].map(uid => usernames[uid] ?? `user ${uid}`);
                const chReactions = reactions[w.channelId] ?? {};
                return (
                    <ChannelWindow
                        key={w.channelId}
                        channelName={w.displayName}
                        isDm={w.kind === "dm"}
                        partnerId={w.partnerId}
                        messages={chMessages}
                        usernames={usernames}
                        currentUserId={userId}
                        typingNames={chTyping}
                        connected={connected}
                        x={w.x} y={w.y} zIndex={w.zIndex}
                        hasMore={hasMore[w.channelId] ?? false}
                        loadingMore={loadingMore.has(w.channelId)}
                        reactions={chReactions}
                        onSend={text       => socketRef.current?.sendText(w.channelId, text)}
                        onTyping={()       => socketRef.current?.sendTyping(w.channelId)}
                        onClose={()        => setWindows(prev => prev.filter(p => p.channelId !== w.channelId))}
                        onFocus={()        => { const z = bumpZ(); setWindows(prev => prev.map(p => p.channelId === w.channelId ? { ...p, zIndex: z } : p)); }}
                        onDrag={(x, y)     => setWindows(prev => prev.map(p => p.channelId === w.channelId ? { ...p, x, y } : p))}
                        onLoadMore={()     => loadMoreMessages(w.channelId)}
                        onReact={(msgId, emoji) => socketRef.current?.sendReaction(w.channelId, msgId, emoji)}
                        onEdit={(msgId, text)   => socketRef.current?.sendEdit(w.channelId, msgId, text)}
                        onDelete={(msgId)       => socketRef.current?.sendDelete(w.channelId, msgId)}
                        onUserHover={handleUserHover}
                    />
                );
            })}

            {callState !== "idle" && (
                <CallPopup
                    callState={callState}
                    remoteUserId={remoteUserId}
                    usernames={usernames}
                    onAccept={acceptCall}
                    onDecline={declineCall}
                    onHangup={hangup}
                />
            )}

            {popover && profiles[popover.userId] && (
                <UserPopover
                    profile={profiles[popover.userId]}
                    isOnline={onlineUsers.has(popover.userId)}
                    anchorX={popover.x}
                    anchorY={popover.y}
                    currentUserId={userId}
                    onDm={openDmWith}
                    onCall={initiateCall}
                    onClose={() => setPopover(null)}
                />
            )}

            <TaskBar
                userId={userId}
                username={myName}
                connected={connected}
                onlineUsers={onlineUsers}
                usernames={usernames}
                onCall={initiateCall}
                onDm={openDmWith}
                onLogout={handleLogout}
                profileSlot={
                    <ProfileMenu
                        userId={userId}
                        username={myName}
                        about={myProfile?.about ?? myAbout}
                        status={myStatus}
                        onStatusChange={handleStatusChange}
                        onAboutSave={handleAboutSave}
                    />
                }
            />

            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />
        </div>
    );
}

function AppIcon({ kind }: { kind: "channels" | "friends" | "dms" }) {
    if (kind === "channels") return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
    );
    if (kind === "friends") return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
    );
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
        </svg>
    );
}
