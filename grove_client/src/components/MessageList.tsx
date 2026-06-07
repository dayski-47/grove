// src/components/MessageList.tsx
import { useEffect, useRef } from "react";

export interface DisplayMessage {
    userId: number;
    text: string;
    timestamp: number;
}

export function MessageList({
    messages,
    currentUserId,
    usernames,
}: {
    messages: DisplayMessage[];
    currentUserId: number;
    usernames: Record<number, string>;
}) {
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="grove-messages">
        {messages.map((m, i) => (
            <div
            key={i}
            className={
                m.userId === currentUserId
                ? "grove-msg grove-msg-mine"
                : "grove-msg"
            }
            >
            <div className="grove-msg-author">
                {usernames[m.userId] ?? `user ${m.userId}`}
            </div>
            <div className="grove-msg-text">{m.text}</div>
            </div>
        ))}
        <div ref={bottomRef} />
        </div>
    );
}