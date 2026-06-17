// src/protocol.ts
import { MessageType, type ParsedMessage } from "./types";

const HEADER_SIZE = 15;

export function packMessage(
    msgType: number,
    userId: number,
    channelId: number,
    text: string
): ArrayBuffer {
    const textBytes = new TextEncoder().encode(text);
    const buffer    = new ArrayBuffer(HEADER_SIZE + textBytes.length);
    const view      = new DataView(buffer);
    const timestamp = Math.floor(Date.now() / 1000);
    view.setUint8(0,  msgType);
    view.setUint32(1,  userId,    true);
    view.setUint32(5,  channelId, true);
    view.setUint32(9,  timestamp, true);
    view.setUint16(13, textBytes.length, true);
    new Uint8Array(buffer, HEADER_SIZE).set(textBytes);
    return buffer;
}

export function unpackMessage(buffer: ArrayBuffer): ParsedMessage {
    if (buffer.byteLength < HEADER_SIZE) {
        throw new Error("Buffer too small");
    }

    const view      = new DataView(buffer);
    const msgType   = view.getUint8(0);
    const userId    = view.getUint32(1,  true);
    const channelId = view.getUint32(5,  true);
    const timestamp = view.getUint32(9,  true);
    const textLen   = view.getUint16(13, true);

    if (buffer.byteLength < HEADER_SIZE + textLen) {
        throw new Error("Incomplete message");
    }

    // TEXT messages carry an 8-byte u64 LE message ID before the UTF-8 text.
    if (msgType === MessageType.TEXT && textLen >= 8) {
        const lo    = view.getUint32(HEADER_SIZE,     true);
        const hi    = view.getUint32(HEADER_SIZE + 4, true);
        const msgId = hi * 0x100000000 + lo; // safe for IDs up to 2^53-1
        const text  = new TextDecoder().decode(
            new Uint8Array(buffer, HEADER_SIZE + 8, textLen - 8),
        );
        return { msgType, userId, channelId, timestamp, text, msgId };
    }

    const text = new TextDecoder().decode(new Uint8Array(buffer, HEADER_SIZE, textLen));
    return { msgType, userId, channelId, timestamp, text };
}
