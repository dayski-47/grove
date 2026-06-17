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

export interface DmInfo {
  channel_id:   number;
  partner_id:   number;
  partner_name: string;
}

export interface FriendInfo {
  user_id:  number;
  username: string;
  online:   boolean;
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

export interface SignalingOffer    { type: "CallOffer";    from: number; to: number; sdp: string; }
export interface SignalingAnswer   { type: "CallAnswer";   from: number; to: number; sdp: string; }
export interface SignalingIce      { type: "IceCandidate"; from: number; to: number; candidate: string; }
export interface SignalingHangup   { type: "CallHangup";   from: number; to: number; }
export type SignalingMessage = SignalingOffer | SignalingAnswer | SignalingIce | SignalingHangup;