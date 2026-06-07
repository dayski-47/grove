// src/components/LoginScreen.tsx
import { useState } from "react";
import { login, register } from "../api";
import { saveSession } from "../auth";

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
    const [mode, setMode]         = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [error, setError]       = useState("");
    const [loading, setLoading]   = useState(false);

    async function handleSubmit() {
        setError("");
        setLoading(true);
        try {
        const auth =
            mode === "login"
            ? await login({ email, password })
            : await register({ username, email, password });
        saveSession(auth);
        onLogin();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="grove-auth">
        <div className="grove-auth-card">
            <div className="grove-logo">
            <span className="grove-logo-mark">❦</span>
            <h1>Grove</h1>
            <p className="grove-tagline">a quiet place to gather</p>
            </div>

            {mode === "register" && (
            <input
                className="grove-input"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
            />
            )}

            <input
            className="grove-input"
            placeholder="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            />

            <input
            className="grove-input"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
            }}
            />

            {error && <div className="grove-error">{error}</div>}

            <button
            className="grove-button"
            onClick={handleSubmit}
            disabled={loading}
            >
            {loading
                ? "…"
                : mode === "login"
                ? "enter the grove"
                : "plant your roots"}
            </button>

            <button
            className="grove-link"
            onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
            }}
            >
            {mode === "login"
                ? "new here? create an account"
                : "already have an account? sign in"}
            </button>
        </div>
        </div>
    );
    }