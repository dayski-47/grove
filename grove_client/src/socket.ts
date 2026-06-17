// src/socket.ts
import { WS_BASE } from "./config";
import { packMessage, unpackMessage } from "./protocol";
import { MessageType, type ParsedMessage, type SignalingMessage } from "./types";

type MessageHandler  = (msg: ParsedMessage) => void;
type StatusHandler   = (connected: boolean) => void;
type PresenceHandler = (userId: number, online: boolean, name?: string) => void;
type SignalHandler   = (msg: SignalingMessage) => void;

export class GroveSocket {
    private ws:         WebSocket | null = null;
    private token:      string;
    private userId:     number;
    private onMessage:  MessageHandler;
    private onStatus:   StatusHandler;
    private onPresence: PresenceHandler | null;
    private onSignal:   SignalHandler | null;

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
        const url = `${WS_BASE}?token=${encodeURIComponent(this.token)}`;
        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen  = () => this.onStatus(true);
        this.ws.onclose = () => this.onStatus(false);
        this.ws.onerror = () => this.onStatus(false);

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                try {
                    const msg = unpackMessage(event.data);
                    if (msg.msgType === MessageType.PRESENCE) {
                        // payload format: "status" or "status:name"
                        const colonIdx = msg.text.indexOf(":");
                        const status = colonIdx === -1 ? msg.text : msg.text.slice(0, colonIdx);
                        const name   = colonIdx === -1 ? undefined : msg.text.slice(colonIdx + 1);
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

    sendText(channelId: number, text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("Socket not open");
            return;
        }
        const buffer = packMessage(MessageType.TEXT, this.userId, channelId, text);
        this.ws.send(buffer);
    }

    sendSignaling(msg: SignalingMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("Socket not open");
            return;
        }
        const json = JSON.stringify(msg);
        const buffer = packMessage(MessageType.CALL_SIGNAL, this.userId, 0, json);
        this.ws.send(buffer);
    }

    disconnect(): void {
        this.ws?.close();
        this.ws = null;
    }
}
