// src/socket.ts
import { WS_BASE } from "./config";
import { packMessage, unpackMessage } from "./protocol";
import { MessageType, type ParsedMessage } from "./types";

type MessageHandler = (msg: ParsedMessage) => void;
type StatusHandler  = (connected: boolean) => void;

export class GroveSocket {
    private ws:        WebSocket | null = null;
    private token:     string;
    private userId:    number;
    private onMessage: MessageHandler;
    private onStatus:  StatusHandler;

    constructor(
        token:     string,
        userId:    number,
        onMessage: MessageHandler,
        onStatus:  StatusHandler
    ) {
        this.token     = token;
        this.userId    = userId;
        this.onMessage = onMessage;
        this.onStatus  = onStatus;
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
            this.onMessage(msg);
            } catch (err) {
            console.error("Failed to parse incoming message", err);
            }
        }
        };
    }

    sendText(channelId: number, text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.warn("Socket not open");
        return;
        }
        const buffer = packMessage(
        MessageType.TEXT,
        this.userId,
        channelId,
        text
        );
        this.ws.send(buffer);
    }

    disconnect(): void {
        this.ws?.close();
        this.ws = null;
    }
}