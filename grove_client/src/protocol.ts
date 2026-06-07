// src/protocol.ts 

import {  
    // MessageType, 
    type ParsedMessage } from "./types";

const HEADER_SIZE = 15;

export function packMessage(
    msgType: number,
    userId: number,
    channelId: number,
    text: string
): ArrayBuffer {
    const textBytes = new TextEncoder().encode(text);
    const buffer = new ArrayBuffer(HEADER_SIZE + textBytes.length);
    const view = new DataView(buffer);
    const timestamp = Math.floor(Date.now() / 1000);
    view.setUint8(0, msgType);                   // msg_type
    view.setUint32(1, userId, true);             // user_id      (LE)
    view.setUint32(5, channelId, true);          // channel_id   (LE)
    view.setUint32(9, timestamp, true);          // timestamp    (LE)
    view.setUint16(13, textBytes.length, true);  // text_len     (LE)

    new Uint8Array(buffer, HEADER_SIZE).set(textBytes);

    return buffer;
}

export function unpackMessage(buffer: ArrayBuffer): ParsedMessage {

    if (buffer.byteLength < HEADER_SIZE) {
        throw new Error("Buffer too small");
    }

    const view = new DataView(buffer);

    const msgType   = view.getUint8(0);
    const userId    = view.getUint32(1, true);
    const channelId = view.getUint32(5, true);
    const timestamp = view.getUint32(9, true);
    const textLen   = view.getUint16(13, true);

    if (buffer.byteLength < HEADER_SIZE + textLen) {
        throw new Error("Incomplete message");
    }

    const payloadBytes = new Uint8Array(buffer, HEADER_SIZE, textLen);
    const text = new TextDecoder().decode(payloadBytes);

    return { msgType, userId, channelId, timestamp, text };
}
