// src/api.ts
import { API_BASE } from "./config";
import type {
    ReactionSummary,
    UserProfile,
    PinnedMessage,
    AuthResponse,
    RegisterRequest,
    LoginRequest,
    CreateChannelResponse,
    DmInfo,
    FriendInfo,
    HistoricMessage,
} from "./types";

async function postJson<T>(
    path: string,
    body: unknown,
    token?: string
): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Request failed: ${res.status}`);
    }

    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
}

export function register(req: RegisterRequest): Promise<AuthResponse> {
    return postJson<AuthResponse>("/api/auth/register", req);
}

export function login(req: LoginRequest): Promise<AuthResponse> {
    return postJson<AuthResponse>("/api/auth/login", req);
}

export interface ChannelInfo {
  id: number;
  name: string;
}

export function createChannel(
    name: string,
    token: string
    ): Promise<CreateChannelResponse> {
    return postJson<CreateChannelResponse>(
        "/api/channels/create",
        { name },
        token
    );
}

export function joinChannel(
    channelId: number,
    token: string
): Promise<void> {
    return postJson<void>("/api/channels/join", { channel_id: channelId }, token);
}

export async function listChannels(token: string): Promise<ChannelInfo[]> {
  const res = await fetch(`${API_BASE}/api/channels`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return (await res.json()) as ChannelInfo[];
}

export async function listFriends(token: string): Promise<FriendInfo[]> {
    const res = await fetch(`${API_BASE}/api/friends`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch friends: ${res.status}`);
    return (await res.json()) as FriendInfo[];
}

export function addFriend(userId: number, token: string): Promise<void> {
    return postJson<void>("/api/friends/add", { user_id: userId }, token);
}

export function removeFriend(userId: number, token: string): Promise<void> {
    return postJson<void>("/api/friends/remove", { user_id: userId }, token);
}

export async function openDm(withUser: number, token: string): Promise<{ channel_id: number }> {
    return postJson<{ channel_id: number }>("/api/dm/open", { with_user: withUser }, token);
}

export async function listDms(token: string): Promise<DmInfo[]> {
    const res = await fetch(`${API_BASE}/api/dm/list`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch DMs: ${res.status}`);
    return (await res.json()) as DmInfo[];
}

export async function getHistory(
    channelId: number,
    token: string,
    before?: number,
    limit?: number
): Promise<HistoricMessage[]> {
    const params = new URLSearchParams({ channel_id: String(channelId) });
    if (before !== undefined) params.set("before", String(before));
    if (limit !== undefined) params.set("limit", String(limit));

    const res = await fetch(`${API_BASE}/api/messages/history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
    return (await res.json()) as HistoricMessage[];
}

export async function getChannelReactions(
    channelId: number,
    token: string,
): Promise<ReactionSummary[]> {
    const res = await fetch(
        `${API_BASE}/api/messages/reactions?channel_id=${channelId}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    return (await res.json()) as ReactionSummary[];
}

export async function logout(token: string): Promise<void> {
    await fetch(`${API_BASE}/api/auth/logout`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
}

export async function getUserProfile(userId: number, token: string): Promise<UserProfile> {
    const res = await fetch(`${API_BASE}/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("User not found");
    return (await res.json()) as UserProfile;
}

export async function searchUsers(query: string, token: string): Promise<UserProfile[]> {
    if (!query.trim()) return [];
    const res = await fetch(
        `${API_BASE}/api/users/search?q=${encodeURIComponent(query.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    return (await res.json()) as UserProfile[];
}

export async function getChannelPins(channelId: number, token: string): Promise<PinnedMessage[]> {
    const res = await fetch(`${API_BASE}/api/messages/pins?channel_id=${channelId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return (await res.json()) as PinnedMessage[];
}

export async function pinMessage(messageId: number, token: string): Promise<void> {
    await fetch(`${API_BASE}/api/messages/pin`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ message_id: messageId }),
    });
}

export async function unpinMessage(messageId: number, token: string): Promise<void> {
    await fetch(`${API_BASE}/api/messages/unpin`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ message_id: messageId }),
    });
}

export async function updateAbout(about: string, token: string): Promise<void> {
    await fetch(`${API_BASE}/api/users/me`, {
        method:  "PUT",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ about }),
    });
}