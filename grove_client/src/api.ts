// src/api.ts
import { API_BASE } from "./config";
import type {
    AuthResponse,
    RegisterRequest,
    LoginRequest,
    CreateChannelResponse,
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

export interface UserProfile {
    id: number;
    username: string;
}

export async function getUser(
    userId: number,
    token: string
): Promise<UserProfile> {
    const res = await fetch(`${API_BASE}/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`User fetch failed: ${res.status}`);
    return (await res.json()) as UserProfile;
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