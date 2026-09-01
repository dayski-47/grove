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
    MemberInfo,
    ChannelRole,
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
    if (!text) return undefined as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 80)}`);
    }
}

export function register(req: RegisterRequest): Promise<AuthResponse> {
    return postJson<AuthResponse>("/api/auth/register", req);
}

export function login(req: LoginRequest): Promise<AuthResponse> {
    return postJson<AuthResponse>("/api/auth/login", req);
}

export interface ChannelInfo {
  id:           number;
  name:         string;
  description?: string;
  category?:    string;
  is_private:   boolean;
}

export function createChannel(
    name: string,
    token: string,
    options?: { description?: string; category?: string; is_private?: boolean },
    ): Promise<CreateChannelResponse> {
    return postJson<CreateChannelResponse>(
        "/api/channels/create",
        {
            name,
            description: options?.description,
            category:    options?.category,
            is_private:  options?.is_private ?? false,
        },
        token
    );
}

export function updateChannel(
    channelId: number,
    updates: { description?: string; category?: string; is_private?: boolean },
    token: string,
): Promise<{ invite_code: string | null }> {
    return fetch(`${API_BASE}/api/channels/${channelId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(updates),
    }).then(async res => {
        if (!res.ok) throw new Error(`Update channel failed: ${res.status}`);
        return res.json() as Promise<{ invite_code: string | null }>;
    });
}

export function regenerateInviteCode(
    channelId: number,
    token: string,
): Promise<{ invite_code: string }> {
    return postJson<{ invite_code: string }>(
        `/api/channels/${channelId}/invite-code/regenerate`,
        {},
        token,
    );
}

export function joinByCode(
    code: string,
    token: string,
): Promise<{ channel_id: number; name: string }> {
    return postJson<{ channel_id: number; name: string }>(
        "/api/channels/join-by-code",
        { code },
        token,
    );
}

export async function getChannelMembers(channelId: number, token: string): Promise<MemberInfo[]> {
    const res = await fetch(`${API_BASE}/api/channels/${channelId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch members: ${res.status}`);
    return (await res.json()) as MemberInfo[];
}

export function updateMemberRole(
    channelId: number,
    userId: number,
    role: ChannelRole,
    token: string,
): Promise<void> {
    return postJson<void>(
        `/api/channels/${channelId}/members/${userId}/role`,
        { role },
        token,
    );
}

export async function kickMember(channelId: number, userId: number, token: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/channels/${channelId}/members/${userId}`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Kick member failed: ${res.status}`);
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

export async function deleteAccount(token: string): Promise<void> {
    await fetch(`${API_BASE}/api/auth/account`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
}

export interface UnfurlResult {
    available:   boolean;
    url_hash:    string | null;
    title:       string | null;
    description: string | null;
    has_image:   boolean;
}

export async function unfurlLink(url: string, token: string): Promise<UnfurlResult> {
    const res = await fetch(`${API_BASE}/api/links/unfurl`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ url }),
    });
    if (!res.ok) {
        return { available: false, url_hash: null, title: null, description: null, has_image: false };
    }
    return res.json();
}

// <img> tags can't carry a custom Authorization header, so this embeds the
// token as a query param instead — the backend's AuthenticatedUser
// extractor accepts either (see chat_server/src/api/mod.rs).
export function imageProxyUrl(urlHash: string, token: string): string {
    return `${API_BASE}/api/links/image-proxy?url_hash=${encodeURIComponent(urlHash)}&token=${encodeURIComponent(token)}`;
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