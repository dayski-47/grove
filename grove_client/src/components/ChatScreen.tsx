// src/components/ChatScreen.tsx
import { useEffect, useRef, useState } from "react";
import { GroveSocket } from "../socket";
import { getHistory, joinChannel, createChannel, getUser } from "../api";
import type { ParsedMessage, HistoricMessage } from "../types";
import { ChannelSidebar, type Channel } from "./ChannelSidebar";
import { MessageList, type DisplayMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function ChatScreen({
    token,
    userId,
    onLogout,
}: {
    token: string;
    userId: number;
    onLogout: () => void;
}) {
    const [channelId, setChannelId] = useState(1);
    const [channels, setChannels]   = useState<Channel[]>([
        { id: 1, name: "general" },
    ]);
    const [messages, setMessages]     = useState<DisplayMessage[]>([]);
    const [connected, setConnected]   = useState(false);
    const [usernames, setUsernames]   = useState<Record<number, string>>({});
    const socketRef                   = useRef<GroveSocket | null>(null);
    const channelIdRef                = useRef(channelId);

    // Keep ref in sync with state
    useEffect(() => {
        channelIdRef.current = channelId;
    }, [channelId]);

    async function resolveUsername(uid: number) {
        setUsernames((prev) => {
        if (prev[uid]) return prev; // already cached
        return prev;
        });
        setUsernames((prev) => {
        if (prev[uid]) return prev;
        getUser(uid, token)
            .then((profile) =>
            setUsernames((p) => ({ ...p, [uid]: profile.username }))
            )
            .catch(() =>
            setUsernames((p) => ({ ...p, [uid]: `user ${uid}` }))
            );
        return { ...prev, [uid]: `user ${uid}` }; // placeholder while loading
        });
    }

    // Open socket once on mount
    useEffect(() => {
        const socket = new GroveSocket(
        token,
        userId,
        (msg: ParsedMessage) => {
            if (msg.channelId === channelIdRef.current) {
            setMessages((prev) => [
                ...prev,
                {
                userId:    msg.userId,
                text:      msg.text,
                timestamp: msg.timestamp,
                },
            ]);
            resolveUsername(msg.userId);
            }
        },
        (isConnected) => setConnected(isConnected)
        );
        socket.connect();
        socketRef.current = socket;
        return () => socket.disconnect();
    }, [token, userId]);

    // Load history whenever channel changes
    useEffect(() => {
        async function load() {
        await joinChannel(channelId, token);
        const history: HistoricMessage[] = await getHistory(channelId, token);
        const reversed = history.slice().reverse();
        setMessages(
            reversed.map((m) => ({
            userId:    m.user_id,
            text:      m.text,
            timestamp: m.timestamp,
            }))
        );
        const uniqueIds = [...new Set(reversed.map((m) => m.user_id))];
        uniqueIds.forEach((id) => resolveUsername(id));
        }
        load().catch(console.error);
    }, [channelId, token]);

    function handleSend(text: string) {
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
        />
        <div className="grove-main">
            <MessageList
            messages={messages}
            currentUserId={userId}
            usernames={usernames}
            />
            <MessageInput onSend={handleSend} disabled={!connected} />
        </div>
        </div>
    );
}