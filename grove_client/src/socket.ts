// src/socket.ts
import { WS_BASE } from "./config";
import { packMessage, unpackMessage } from "./protocol";
import { MessageType, type ParsedMessage, type SignalingMessage } from "./types";

type MessageHandler  = (msg: ParsedMessage) => void;
type StatusHandler   = (connected: boolean) => void;
type PresenceHandler = (userId: number, online: boolean, name?: string) => void;
type SignalHandler   = (msg: SignalingMessage) => void;

const BACKOFF_INITIAL = 1_000;
const BACKOFF_MAX     = 30_000;

export class GroveSocket {
    private ws:            WebSocket | null = null;
    private token:         string;
    private userId:        number;
    private onMessage:     MessageHandler;
    private onStatus:      StatusHandler;
    private onPresence:    PresenceHandler | null;
    private onSignal:      SignalHandler | null;
    private destroyed:     boolean = false;
    private reconnectMs:   number  = BACKOFF_INITIAL;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        token:      string,
        userId:     number,
        onMessage:  MessageHandler,
        onStatus:   StatusHandler,
        onPresence: PresenceHandler | null = null,
        onSignal:   SignalHandler   | null = null,
    ) {
        this.token      = token;
        this.userId     = userId;
        this.onMessage  = onMessage;
        this.onStatus   = onStatus;
        this.onPresence = onPresence;
        this.onSignal   = onSignal;
    }

    connect(): void {
        if (this.destroyed) return;
        const url = `${WS_BASE}?token=${encodeURIComponent(this.token)}`;
        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            this.reconnectMs = BACKOFF_INITIAL;
            this.onStatus(true);
        };

        this.ws.onclose = () => {
            this.onStatus(false);
            this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            // onclose fires right after onerror, so no need to schedule here
            this.onStatus(false);
        };

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                try {
                    const msg = unpackMessage(event.data);
                    if (msg.msgType === MessageType.PRESENCE) {
                        // payload: "status" or "status:name"
                        const colonIdx = msg.text.indexOf(":");
                        const status   = colonIdx === -1 ? msg.text : msg.text.slice(0, colonIdx);
                        const name     = colonIdx === -1 ? undefined : msg.text.slice(colonIdx + 1);
                        this.onPresence?.(msg.userId, status === "online", name);
                    } else {
                        this.onMessage(msg);
                    }
                } catch (err) {
                    console.error("Failed to parse incoming message", err);
                }
            } else if (typeof event.data === "string") {
                try {
                    const sig = JSON.parse(event.data) as SignalingMessage;
                    this.onSignal?.(sig);
                } catch (err) {
                    console.error("Failed to parse signaling message", err);
                }
            }
        };
    }

    private _scheduleReconnect(): void {
        if (this.destroyed) return;
        if (this.reconnectTimer !== null) return;
        // Jitter: ±20% of the base delay to spread out thundering herds
        const jitter = (Math.random() - 0.5) * 0.4 * this.reconnectMs;
        const delay  = Math.min(this.reconnectMs + jitter, BACKOFF_MAX);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
        this.reconnectMs = Math.min(this.reconnectMs * 2, BACKOFF_MAX);
    }

    sendText(channelId: number, text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(packMessage(MessageType.TEXT, this.userId, channelId, text));
    }

    sendTyping(channelId: number): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(packMessage(MessageType.TYPING, this.userId, channelId, ""));
    }

    sendReaction(channelId: number, messageId: number, emoji: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = JSON.stringify({ message_id: messageId, emoji });
        this.ws.send(packMessage(MessageType.REACTION, this.userId, channelId, payload));
    }

    sendEdit(channelId: number, messageId: number, text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = JSON.stringify({ message_id: messageId, text });
        this.ws.send(packMessage(MessageType.EDIT, this.userId, channelId, payload));
    }

    sendDelete(channelId: number, messageId: number): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = JSON.stringify({ message_id: messageId });
        this.ws.send(packMessage(MessageType.DELETE, this.userId, channelId, payload));
    }

    sendSignaling(msg: SignalingMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const json   = JSON.stringify(msg);
        const buffer = packMessage(MessageType.CALL_SIGNAL, this.userId, 0, json);
        this.ws.send(buffer);
    }

    disconnect(): void {
        this.destroyed = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
    }
}
