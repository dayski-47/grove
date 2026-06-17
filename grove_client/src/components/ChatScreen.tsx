// src/components/ChatScreen.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import { getHistory, joinChannel, createChannel, getUser, listChannels } from "../api";
import type { ParsedMessage, SignalingMessage } from "../types";
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
    token:     string;
    userId:    number;
    onLogout:  () => void;
}) {
    const [channelId, setChannelId]     = useState<number | null>(null);
    const [channels, setChannels]       = useState<Channel[]>([]);
    const [messages, setMessages]       = useState<DisplayMessage[]>([]);
    const [connected, setConnected]     = useState(false);
    const [usernames, setUsernames]     = useState<Record<number, string>>({});
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    const socketRef                     = useRef<GroveSocket | null>(null);
    const channelIdRef                  = useRef(channelId);

    useEffect(() => {
        channelIdRef.current = channelId;
    }, [channelId]);

    function resolveUsername(uid: number) {
        setUsernames((prev) => {
            if (uid in prev) return prev;
            getUser(uid, token)
                .then((profile) => setUsernames((p) => ({ ...p, [uid]: profile.username })))
                .catch(() => setUsernames((p) => ({ ...p, [uid]: `user ${uid}` })));
            return { ...prev, [uid]: `user ${uid}` };
        });
    }

    const sendSignaling = useCallback(
        (msg: SignalingMessage) => {
            socketRef.current?.sendSignaling(msg);
        },
        [],
    );

    const { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal } =
        useWebRTC(userId, sendSignaling);

    useEffect(() => {
        const socket = new GroveSocket(
            token,
            userId,
            (msg: ParsedMessage) => {
                if (msg.channelId === channelIdRef.current) {
                    setMessages((prev) => [
                        ...prev,
                        { userId: msg.userId, text: msg.text, timestamp: msg.timestamp },
                    ]);
                    resolveUsername(msg.userId);
                }
            },
            (isConnected) => setConnected(isConnected),
            (presenceUserId, online) => {
                setOnlineUsers((prev) => {
                    const next = new Set(prev);
                    if (online) {
                        next.add(presenceUserId);
                        resolveUsername(presenceUserId);
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
            [...new Set(history.map((m) => m.user_id))].forEach(resolveUsername);
        }
        load().catch(console.error);
    }, [channelId, token]);

    function handleSend(text: string) {
        if (channelId === null) return;
        socketRef.current?.sendText(channelId, text);
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
                <MessageList
                    messages={messages}
                    currentUserId={userId}
                    usernames={usernames}
                />
                <MessageInput
                    onSend={handleSend}
                    disabled={!connected || channelId === null}
                />
            </div>
            <audio id="grove-remote-audio" autoPlay style={{ display: "none" }} />
        </div>
    );
}
