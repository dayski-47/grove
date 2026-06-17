// src/components/HomeScreen.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import { getHistory, joinChannel, createChannel, getUser, listChannels } from "../api";
import { MessageType, type ParsedMessage, type SignalingMessage } from "../types";
import type { DisplayMessage } from "./MessageList";
import { ChannelWindow } from "./ChannelWindow";
import { TaskBar } from "./TaskBar";
import { CallPopup } from "./CallPopup";
import { useWebRTC } from "../useWebRTC";

const TILE_ACCENTS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

interface Channel { id: number; name: string; }
interface WindowState { channelId: number; x: number; y: number; zIndex: number; }

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
    const [messages, setMessages]       = useState<Record<number, DisplayMessage[]>>({});
    const [connected, setConnected]     = useState(false);
    const [usernames, setUsernames]     = useState<Record<number, string>>({});
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<number, Map<number, number>>>({});
    const [windows, setWindows]         = useState<WindowState[]>([]);
    const [newChannelName, setNewChannelName] = useState("");

    const socketRef  = useRef<GroveSocket | null>(null);
    const loadedRef  = useRef<Set<number>>(new Set());
    const zRef       = useRef(100);

    const resolveUsername = useCallback((uid: number, known?: string) => {
        if (known) { setUsernames(p => ({ ...p, [uid]: known })); return; }
        setUsernames(prev => {
            if (uid in prev) return prev;
            getUser(uid, token)
                .then(p  => setUsernames(u => ({ ...u, [uid]: p.username })))
                .catch(() => setUsernames(u => ({ ...u, [uid]: `user ${uid}` })));
            return { ...prev, [uid]: `user ${uid}` };
        });
    }, [token]);

    const sendSignaling = useCallback(
        (msg: SignalingMessage) => { socketRef.current?.sendSignaling(msg); },
        [],
    );

    const { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal } =
        useWebRTC(userId, sendSignaling);

    // Expire typing after 3 s of silence
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
            token,
            userId,
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
                setMessages(prev => {
                    const arr = prev[msg.channelId] ?? [];
                    return {
                        ...prev,
                        [msg.channelId]: [
                            ...arr,
                            { userId: msg.userId, text: msg.text, timestamp: msg.timestamp },
                        ],
                    };
                });
                resolveUsername(msg.userId);
            },
            (isConn) => setConnected(isConn),
            (presenceUserId, online, name) => {
                setOnlineUsers(prev => {
                    const next = new Set(prev);
                    if (online) { next.add(presenceUserId); resolveUsername(presenceUserId, name); }
                    else next.delete(presenceUserId);
                    return next;
                });
            },
            handleSignal,
        );
        socket.connect();
        socketRef.current = socket;

        listChannels(token)
            .then(chs => setChannels(chs.map(c => ({ id: c.id, name: c.name }))))
            .catch(console.error);

        return () => socket.disconnect();
    }, [token, userId, handleSignal, resolveUsername]);

    async function openChannel(channelId: number) {
        // Bring existing window to front
        const exists = windows.find(w => w.channelId === channelId);
        if (exists) {
            zRef.current++;
            setWindows(prev => prev.map(w =>
                w.channelId === channelId ? { ...w, zIndex: zRef.current } : w,
            ));
            return;
        }

        // Join and load history on first open
        if (!loadedRef.current.has(channelId)) {
            loadedRef.current.add(channelId);
            try {
                await joinChannel(channelId, token);
                const history = await getHistory(channelId, token);
                const msgs = history.slice().reverse().map(m => ({
                    userId:    m.user_id,
                    text:      m.text,
                    timestamp: m.timestamp,
                }));
                setMessages(prev => ({ ...prev, [channelId]: msgs }));
                [...new Set(history.map(m => m.user_id))].forEach(uid => resolveUsername(uid));
            } catch { /* already joined */ }
        }

        // Cascade new window position
        const offset = (windows.length % 8) * 28;
        zRef.current++;
        setWindows(prev => [
            ...prev,
            { channelId, x: 60 + offset, y: 40 + offset, zIndex: zRef.current },
        ]);
    }

    async function handleCreateChannel() {
        const name = newChannelName.trim();
        if (!name) return;
        try {
            const res = await createChannel(name, token);
            const newChannel = { id: res.channel_id, name };
            setChannels(prev => [...prev, newChannel]);
            setNewChannelName("");
            openChannel(res.channel_id);
        } catch { console.error("Failed to create channel"); }
    }

    const myName = usernames[userId] ?? `user ${userId}`;

    return (
        <div className="grove-home">
            {/* Wii U channel tile grid */}
            <div className="grove-tiles" role="main">
                {channels.map((ch, i) => {
                    const accent = TILE_ACCENTS[i % TILE_ACCENTS.length];
                    const isOpen = windows.some(w => w.channelId === ch.id);
                    return (
                        <div
                            key={ch.id}
                            className="grove-tile-float"
                            style={{ animationDelay: `${(i % 6) * 0.4}s` }}
                        >
                            <button
                                className={`grove-tile${isOpen ? " grove-tile-open" : ""}`}
                                onClick={() => openChannel(ch.id)}
                                aria-label={`Open channel ${ch.name}${isOpen ? " (open)" : ""}`}
                                aria-pressed={isOpen}
                            >
                                <div className="grove-tile-accent" style={{ background: accent }} />
                                <div className="grove-tile-body">
                                    <span className="grove-tile-hash" aria-hidden="true">#</span>
                                    <span className="grove-tile-name">{ch.name}</span>
                                </div>
                            </button>
                        </div>
                    );
                })}

                {/* New channel tile */}
                <div
                    className="grove-tile-float"
                    style={{ animationDelay: `${(channels.length % 6) * 0.4}s` }}
                >
                    <div className="grove-tile grove-tile-new" aria-label="Create a new channel">
                        <div className="grove-tile-accent" style={{ background: "rgba(100,140,180,0.45)" }} />
                        <div className="grove-tile-body" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <input
                                className="grove-tile-input"
                                placeholder="new channel"
                                value={newChannelName}
                                onChange={e => setNewChannelName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleCreateChannel(); }}
                                aria-label="New channel name"
                                onClick={e => e.stopPropagation()}
                            />
                            <button
                                className="grove-tile-create"
                                onClick={handleCreateChannel}
                                aria-label="Create channel"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5"  y1="12" x2="19" y2="12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating channel windows */}
            {windows.map(w => {
                const ch          = channels.find(c => c.id === w.channelId);
                const chMessages  = messages[w.channelId] ?? [];
                const chTyping    = [...(typingUsers[w.channelId] ?? new Map()).keys()]
                    .map(uid => usernames[uid] ?? `user ${uid}`);
                return (
                    <ChannelWindow
                        key={w.channelId}
                        channelName={ch?.name ?? "…"}
                        messages={chMessages}
                        usernames={usernames}
                        currentUserId={userId}
                        typingNames={chTyping}
                        connected={connected}
                        x={w.x}
                        y={w.y}
                        zIndex={w.zIndex}
                        onSend={text   => socketRef.current?.sendText(w.channelId, text)}
                        onTyping={()   => socketRef.current?.sendTyping(w.channelId)}
                        onClose={()    => setWindows(prev => prev.filter(p => p.channelId !== w.channelId))}
                        onFocus={()    => {
                            zRef.current++;
                            setWindows(prev => prev.map(p =>
                                p.channelId === w.channelId ? { ...p, zIndex: zRef.current } : p,
                            ));
                        }}
                        onDrag={(x, y) => setWindows(prev => prev.map(p =>
                            p.channelId === w.channelId ? { ...p, x, y } : p,
                        ))}
                    />
                );
            })}

            {/* Draggable call popup */}
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

            {/* Bottom taskbar */}
            <TaskBar
                userId={userId}
                username={myName}
                connected={connected}
                onlineUsers={onlineUsers}
                usernames={usernames}
                onCall={initiateCall}
                onLogout={onLogout}
            />

            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />
        </div>
    );
}
