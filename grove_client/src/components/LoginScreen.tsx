import { useState } from "react";
import { login, register } from "../api";
import { saveSession } from "../auth";

function passwordStrength(pw: string): number {
    if (pw.length < 4) return 0;
    let score = 0;
    if (pw.length >= 8)            score++;
    if (/[A-Za-z]/.test(pw))      score++;
    if (/[0-9]/.test(pw))         score++;
    if (/[^A-Za-z0-9]/.test(pw))  score++;
    return score;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];

/* ── Forest tree panel ─────────────────────────────────────── */

function GroveForest({ side }: { side: "left" | "right" }) {
    const id = `gvf-${side}`;
    return (
        <div
            className="gv-forest"
            style={{
                left:      side === "left"  ? 0 : "auto",
                right:     side === "right" ? 0 : "auto",
                transform: side === "right" ? "scaleX(-1)" : undefined,
            }}
            aria-hidden="true"
        >
            <svg viewBox="0 0 280 900" preserveAspectRatio="xMidYMid slice">
                <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%"   stopColor="#010301" stopOpacity="1"/>
                        <stop offset="52%"  stopColor="#010301" stopOpacity="0.88"/>
                        <stop offset="100%" stopColor="#010301" stopOpacity="0"/>
                    </linearGradient>
                </defs>

                {/* Base fill */}
                <rect x="0" y="0" width="280" height="900" fill="#010301"/>

                {/* Canopy overhead */}
                <ellipse cx="60"  cy="-35" rx="140" ry="88"  fill="#020502"/>
                <ellipse cx="195" cy="-15" rx="120" ry="72"  fill="#030603"/>

                {/* Tree 1 — back, tallest */}
                <ellipse cx="28"  cy="155" rx="54"  ry="128" fill="#020502"/>
                <ellipse cx="26"  cy="302" rx="41"  ry="84"  fill="#020502"/>
                <rect    x="20"   y="386" width="14" height="514" fill="#020502"/>

                {/* Tree 2 */}
                <ellipse cx="82"  cy="222" rx="50"  ry="115" fill="#030603"/>
                <ellipse cx="80"  cy="350" rx="38"  ry="80"  fill="#030603"/>
                <rect    x="75"   y="430" width="12" height="470" fill="#030603"/>

                {/* Tree 3 */}
                <ellipse cx="135" cy="192" rx="54"  ry="122" fill="#030703"/>
                <ellipse cx="132" cy="333" rx="43"  ry="90"  fill="#030703"/>
                <rect    x="127"  y="423" width="13" height="477" fill="#030703"/>

                {/* Tree 4 — foreground */}
                <ellipse cx="186" cy="258" rx="60"  ry="135" fill="#040904"/>
                <ellipse cx="183" cy="406" rx="48"  ry="100" fill="#040904"/>
                <rect    x="177"  y="506" width="14" height="394" fill="#040904"/>

                {/* Tree 5 — clearing edge */}
                <ellipse cx="238" cy="218" rx="56"  ry="124" fill="#050a05"/>
                <ellipse cx="235" cy="361" rx="45"  ry="94"  fill="#050a05"/>
                <rect    x="230"  y="455" width="12" height="445" fill="#050a05"/>

                {/* Ground mass */}
                <rect    x="0"    y="808" width="280" height="92"  fill="#010301"/>
                <ellipse cx="130" cy="816" rx="200"  ry="55"  fill="#010301"/>

                {/* Fade toward clearing */}
                <rect x="0" y="0" width="280" height="900" fill={`url(#${id})`}/>
            </svg>
        </div>
    );
}

/* ── Firefly positions ─────────────────────────────────────── */

const FIREFLIES: { left: string; top: string; delay: string; cls: string }[] = [
    { left:  "7%", top: "22%", delay:  "0s",   cls: "" },
    { left: "14%", top: "65%", delay: "1.4s",  cls: "gv-firefly-b" },
    { left: "21%", top: "38%", delay: "2.8s",  cls: "" },
    { left:  "5%", top: "52%", delay: "0.9s",  cls: "gv-firefly-c" },
    { left: "17%", top: "80%", delay: "3.6s",  cls: "gv-firefly-b" },
    { left: "11%", top: "14%", delay: "5.1s",  cls: "" },
    { left: "76%", top: "27%", delay: "1.9s",  cls: "" },
    { left: "83%", top: "61%", delay: "0.5s",  cls: "gv-firefly-c" },
    { left: "91%", top: "42%", delay: "2.3s",  cls: "gv-firefly-b" },
    { left: "71%", top: "76%", delay: "4.2s",  cls: "" },
    { left: "86%", top: "16%", delay: "1.1s",  cls: "gv-firefly-d" },
    { left: "89%", top: "86%", delay: "3.3s",  cls: "gv-firefly-b" },
];

/* ── Component ─────────────────────────────────────────────── */

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
    const [mode, setMode]         = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [error, setError]       = useState("");
    const [loading, setLoading]   = useState(false);
    const [entering, setEntering] = useState(false);

    const strength = mode === "register" ? passwordStrength(password) : 0;

    async function handleSubmit() {
        setError("");
        setLoading(true);
        try {
            const auth = mode === "login"
                ? await login({ email, password })
                : await register({ username, email, password });
            saveSession(auth);
            setEntering(true);
            setTimeout(() => onLogin(), 650);
        } catch (err) {
            setError(err instanceof Error ? err.message : "something went wrong");
            setLoading(false);
        }
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === "Enter") handleSubmit();
    }

    function switchMode(m: "login" | "register") {
        setMode(m);
        setError("");
    }

    return (
        <div className={`dw-login${entering ? " gv-entering" : ""}`}>
            {/* Forest panels */}
            <GroveForest side="left" />
            <GroveForest side="right" />

            {/* Fireflies */}
            {FIREFLIES.map((f, i) => (
                <div
                    key={i}
                    className={`gv-firefly ${f.cls}`}
                    style={{ left: f.left, top: f.top, animationDelay: f.delay }}
                    aria-hidden="true"
                />
            ))}

            {/* Ground mist */}
            <div className="gv-mist" aria-hidden="true" />

            {/* Login card */}
            <div className="dw-login-card" role="main">
                <div className="dw-login-brand">
                    <div className="dw-login-brand-name">grove</div>
                    <div className="dw-login-brand-rule" />
                </div>

                <div className="dw-login-tabs" role="tablist">
                    <button
                        className={`dw-login-tab${mode === "login" ? " active" : ""}`}
                        role="tab"
                        aria-selected={mode === "login"}
                        onClick={() => switchMode("login")}
                    >
                        sign in
                    </button>
                    <button
                        className={`dw-login-tab${mode === "register" ? " active" : ""}`}
                        role="tab"
                        aria-selected={mode === "register"}
                        onClick={() => switchMode("register")}
                    >
                        create account
                    </button>
                </div>

                {mode === "register" && (
                    <div className="dw-login-field">
                        <input
                            className="dw-login-input"
                            id="dw-username"
                            placeholder="username"
                            value={username}
                            autoComplete="username"
                            aria-label="Username"
                            onChange={e => setUsername(e.target.value)}
                            onKeyDown={handleKey}
                            autoFocus
                        />
                    </div>
                )}

                <div className="dw-login-field">
                    <input
                        className="dw-login-input"
                        id="dw-email"
                        placeholder="email"
                        type="email"
                        value={email}
                        autoComplete="email"
                        aria-label="Email"
                        onChange={e => setEmail(e.target.value)}
                        onKeyDown={handleKey}
                        autoFocus={mode === "login"}
                    />
                </div>

                <div className="dw-login-field">
                    <input
                        className="dw-login-input"
                        id="dw-password"
                        placeholder={mode === "register" ? "password (8+ chars, letter + number + symbol)" : "password"}
                        type="password"
                        value={password}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        aria-label="Password"
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={handleKey}
                    />
                    {mode === "register" && password.length > 0 && (
                        <div
                            className="dw-strength"
                            role="meter"
                            aria-label={`Password strength: ${STRENGTH_LABELS[strength]}`}
                            aria-valuenow={strength}
                            aria-valuemin={0}
                            aria-valuemax={4}
                        >
                            {[1, 2, 3, 4].map(n => (
                                <div
                                    key={n}
                                    className={`dw-strength-seg${strength >= n ? ` s${strength}` : ""}`}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {error && (
                    <div className="dw-login-error" role="alert">{error}</div>
                )}

                <button
                    className="dw-login-submit"
                    onClick={handleSubmit}
                    disabled={loading || entering}
                    aria-label={mode === "login" ? "Sign in" : "Create account"}
                >
                    {loading ? <LoadingSpinner /> : mode === "login" ? "sign in" : "create account"}
                </button>
            </div>
        </div>
    );
}

function LoadingSpinner() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" style={{ animation: "spin 1s linear infinite" }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
    );
}
