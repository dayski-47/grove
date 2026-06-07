// src/auth.ts
import type { AuthResponse } from "./types";

const TOKEN_KEY   = "grove_token";
const USER_KEY    = "grove_user_id";

export function saveSession(auth: AuthResponse): void {
    sessionStorage.setItem(TOKEN_KEY, auth.token);
    sessionStorage.setItem(USER_KEY, String(auth.user_id));
}

export function getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
}

export function getUserId(): number | null {
    const id = sessionStorage.getItem(USER_KEY);
    return id ? Number(id) : null;
}

export function clearSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
}

export function isLoggedIn(): boolean {
    return getToken() !== null;
}