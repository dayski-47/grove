// src/types.ts

export interface AuthResponse {
    token: string;
    user_id: number;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateChannelResponse {
  channel_id: number;
}

export interface HistoricMessage {
  id: number;
  user_id: number;
  text: string;
  timestamp: number;
}

export const MessageType = {
  TEXT:        0x01,
  IMAGE:       0x02,
  TYPING:      0x03,
  PRESENCE:    0x04,
  CALL_SIGNAL: 0x05,
} as const;

export interface ParsedMessage {
  msgType: number;
  userId: number;
  channelId: number;
  timestamp: number;
  text: string;
}