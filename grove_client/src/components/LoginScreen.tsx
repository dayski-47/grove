// src/components/LoginScreen.tsx
import { useEffect, useState } from "react";
import { login, register } from "../api";
import { saveSession } from "../auth";

function ClockDisplay() {
    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return (
        <>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
    );
}

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
            setError(err instanceof Error ? err.message : "something went wrong");
        } finally {
            setLoading(false);
        }
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === "Enter") handleSubmit();
    }

    return (
        <div className="grove-login">
            <div className="grove-login-scene">
                {/* Hero panel — colored gradient cap with orb + wordmark */}
                <div className="grove-login-hero">
                    <div className="grove-login-orb" role="img" aria-label="Grove logo">
                        ❦
                    </div>
                    <div className="grove-login-wordmark">
                        <h1>Grove</h1>
                        <p>a quiet place to gather</p>
                    </div>
                </div>

                {/* Form body — white glass panel below hero */}
                <div className="grove-login-form" role="main">
                    {mode === "register" && (
                        <div className="grove-login-field">
                            <label className="grove-login-label" htmlFor="grove-username">
                                username
                            </label>
                            <input
                                id="grove-username"
                                className="grove-input"
                                placeholder="letters, numbers, underscores"
                                value={username}
                                autoComplete="username"
                                aria-label="Username"
                                onChange={(e) => setUsername(e.target.value)}
                                onKeyDown={handleKey}
                            />
                        </div>
                    )}

                    <div className="grove-login-field">
                        <label className="grove-login-label" htmlFor="grove-email">
                            email
                        </label>
                        <input
                            id="grove-email"
                            className="grove-input"
                            placeholder="you@example.com"
                            type="email"
                            value={email}
                            autoComplete="email"
                            aria-label="Email"
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={handleKey}
                        />
                    </div>

                    <div className="grove-login-field">
                        <label className="grove-login-label" htmlFor="grove-password">
                            password
                        </label>
                        <div className="grove-login-row">
                            <input
                                id="grove-password"
                                className="grove-input"
                                placeholder={mode === "register" ? "min 8 chars, letter + number + symbol" : "your password"}
                                type="password"
                                value={password}
                                autoComplete={mode === "login" ? "current-password" : "new-password"}
                                aria-label="Password"
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleKey}
                                style={{ flex: 1 }}
                            />
                            <button
                                className="grove-login-go"
                                onClick={handleSubmit}
                                disabled={loading}
                                aria-label={mode === "login" ? "Sign in" : "Create account"}
                            >
                                {loading ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                    </svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                        <polyline points="12 5 19 12 12 19"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="grove-error" role="alert">
                            {error}
                        </div>
                    )}

                    <div className="grove-login-switch">
                        <button
                            className="grove-link"
                            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                        >
                            {mode === "login"
                                ? "new here? create an account"
                                : "already have an account? sign in"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Win7-style bottom bar */}
            <div className="grove-login-bar" aria-hidden="true">
                <span className="grove-login-bar-time">
                    <ClockDisplay />
                </span>
                <button className="grove-login-bar-btn" aria-label="Accessibility options">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
                    </svg>
                </button>
                <button className="grove-login-bar-btn" aria-label="Network status">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1.42 9A16 16 0 0 1 22.58 9"/>
                        <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                        <circle cx="12" cy="20" r="1" fill="currentColor"/>
                    </svg>
                </button>
            </div>
        </div>
    );
}
