// src/components/ChatScreen.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import { getHistory, joinChannel, createChannel, getUser, listChannels } from "../api";
import { MessageType, type ParsedMessage, type SignalingMessage } from "../types";
import { ChannelSidebar, type Channel } from "./ChannelSidebar";
import { MessageList, type DisplayMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { CallUI } from "./CallUI";
import { useWebRTC } from "../useWebRTC";

export function ChatScreen({
    token,
    userId,
    onLogout,
}: {
    token:    string;
    userId:   number;
    onLogout: () => void;
}) {
    const [channelId, setChannelId]     = useState<number | null>(null);
    const [channels, setChannels]       = useState<Channel[]>([]);
    const [messages, setMessages]       = useState<DisplayMessage[]>([]);
    const [connected, setConnected]     = useState(false);
    const [usernames, setUsernames]     = useState<Record<number, string>>({});
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    // userId → timestamp of last TYPING frame received
    const [typingUsers, setTypingUsers] = useState<Map<number, number>>(new Map());
    const socketRef                     = useRef<GroveSocket | null>(null);
    const channelIdRef                  = useRef(channelId);

    useEffect(() => { channelIdRef.current = channelId; }, [channelId]);

    // Expire typing indicators after 3 s of silence
    useEffect(() => {
        if (typingUsers.size === 0) return;
        const timer = setInterval(() => {
            const now = Date.now();
            setTypingUsers((prev) => {
                const next = new Map(prev);
                let changed = false;
                for (const [uid, ts] of next) {
                    if (now - ts > 3000) { next.delete(uid); changed = true; }
                }
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [typingUsers.size]);

    // Falls back to API fetch if name wasn't in the presence frame
    function resolveUsername(uid: number, known?: string) {
        if (known) {
            setUsernames((p) => ({ ...p, [uid]: known }));
            return;
        }
        setUsernames((prev) => {
            if (uid in prev) return prev;
            getUser(uid, token)
                .then((profile) => setUsernames((p) => ({ ...p, [uid]: profile.username })))
                .catch(() => setUsernames((p) => ({ ...p, [uid]: `user ${uid}` })));
            return { ...prev, [uid]: `user ${uid}` };
        });
    }

    const sendSignaling = useCallback(
        (msg: SignalingMessage) => { socketRef.current?.sendSignaling(msg); },
        [],
    );

    const { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal } =
        useWebRTC(userId, sendSignaling);

    useEffect(() => {
        const socket = new GroveSocket(
            token,
            userId,
            (msg: ParsedMessage) => {
                if (msg.msgType === MessageType.TYPING) {
                    if (msg.userId !== userId) {
                        setTypingUsers((prev) => {
                            const next = new Map(prev);
                            next.set(msg.userId, Date.now());
                            return next;
                        });
                        resolveUsername(msg.userId);
                    }
                    return;
                }
                if (msg.channelId === channelIdRef.current) {
                    setMessages((prev) => [
                        ...prev,
                        { userId: msg.userId, text: msg.text, timestamp: msg.timestamp },
                    ]);
                    resolveUsername(msg.userId);
                }
            },
            (isConnected) => setConnected(isConnected),
            // Presence handler now receives optional name from "status:name" frame
            (presenceUserId, online, name) => {
                setOnlineUsers((prev) => {
                    const next = new Set(prev);
                    if (online) {
                        next.add(presenceUserId);
                        resolveUsername(presenceUserId, name);
                    } else {
                        next.delete(presenceUserId);
                    }
                    return next;
                });
            },
            handleSignal,
        );
        socket.connect();
        socketRef.current = socket;

        listChannels(token)
            .then((chs) => {
                setChannels(chs.map((c) => ({ id: c.id, name: c.name })));
                if (chs.length > 0) setChannelId(chs[0].id);
            })
            .catch(console.error);

        return () => socket.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, userId]);

    useEffect(() => {
        if (channelId === null) return;
        async function load() {
            await joinChannel(channelId!, token);
            const history = await getHistory(channelId!, token);
            setMessages(
                history.slice().reverse().map((m) => ({
                    userId:    m.user_id,
                    text:      m.text,
                    timestamp: m.timestamp,
                })),
            );
            [...new Set(history.map((m) => m.user_id))].forEach((uid) => resolveUsername(uid));
        }
        load().catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, token]);

    function handleSend(text: string) {
        if (channelId === null) return;
        socketRef.current?.sendText(channelId, text);
    }

    function handleTyping() {
        if (channelId === null) return;
        socketRef.current?.sendTyping(channelId);
    }

    async function handleCreateChannel(name: string) {
        try {
            const res = await createChannel(name, token);
            setChannels((prev) => [...prev, { id: res.channel_id, name }]);
            setChannelId(res.channel_id);
        } catch {
            console.error("Failed to create channel");
        }
    }

    const currentChannel = channels.find((c) => c.id === channelId) ?? null;

    const typingNames = [...typingUsers.keys()]
        .map((uid) => usernames[uid] ?? `user ${uid}`);

    return (
        <div className="grove-chat">
            <ChannelSidebar
                currentChannel={channelId}
                channels={channels}
                onSelectChannel={setChannelId}
                onCreateChannel={handleCreateChannel}
                onLogout={onLogout}
                connected={connected}
                onlineUsers={onlineUsers}
                currentUserId={userId}
                usernames={usernames}
                onCall={initiateCall}
            />
            <div className="grove-main">
                <CallUI
                    callState={callState}
                    remoteUserId={remoteUserId}
                    usernames={usernames}
                    onAccept={acceptCall}
                    onDecline={declineCall}
                    onHangup={hangup}
                />
                {/* Channel header bar */}
                <div className="grove-channel-header">
                    <span className="grove-ch-hash" aria-hidden="true">#</span>
                    <span className="grove-ch-name">
                        {currentChannel?.name ?? "—"}
                    </span>
                </div>
                <MessageList
                    messages={messages}
                    currentUserId={userId}
                    usernames={usernames}
                />
                <div className="grove-typing" aria-live="polite" aria-atomic="true">
                    {typingNames.length > 0 && (
                        <>
                            <span>{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>
                            <span className="grove-typing-dots" aria-hidden="true">
                                <span /><span /><span />
                            </span>
                        </>
                    )}
                </div>
                <MessageInput
                    onSend={handleSend}
                    onTyping={handleTyping}
                    disabled={!connected || channelId === null}
                />
            </div>
            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />
        </div>
    );
}
