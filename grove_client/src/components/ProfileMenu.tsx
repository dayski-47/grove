// src/components/ProfileMenu.tsx
import { useEffect, useRef, useState } from "react";

export type ActivityStatus = "online" | "idle" | "dnd" | "offline";

const STATUS_LABELS: Record<ActivityStatus, string> = {
    online:  "Online",
    idle:    "Idle",
    dnd:     "Do Not Disturb",
    offline: "Appear Offline",
};

const STATUS_COLORS: Record<ActivityStatus, string> = {
    online:  "#6ab870",
    idle:    "#a08030",
    dnd:     "#c15050",
    offline: "#3d5240",
};

// Fan upward from the avatar — angles measured clockwise from "up" (0° = straight up).
// Negative angles go left, positive go right. Items spread above the avatar, not rightward.
const MENU_ITEMS = [
    { key: "about",    label: "About Me",   angle: -26, icon: "👤" },
    { key: "status",   label: "Set Status", angle:   0, icon: "🌿" },
    { key: "settings", label: "Settings",   angle:  26, icon: "⚙️" },
] as const;

const RADIUS = 82;

function radialPos(angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: Math.sin(rad) * RADIUS,
        y: -Math.cos(rad) * RADIUS,
    };
}

interface AboutModalProps {
    current: string;
    onSave:  (text: string) => void;
    onClose: () => void;
}

function AboutModal({ current, onSave, onClose }: AboutModalProps) {
    const [text, setText] = useState(current);
    return (
        <div className="grove-modal-overlay" onClick={onClose}>
            <div
                className="grove-modal"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-label="Edit About Me"
            >
                <h2 className="grove-modal-title">About Me</h2>
                <p className="grove-modal-hint">Tell people a little about yourself (280 chars max)</p>
                <textarea
                    className="grove-modal-textarea"
                    value={text}
                    onChange={e => setText(e.target.value.slice(0, 280))}
                    rows={4}
                    maxLength={280}
                    autoFocus
                />
                <div className="grove-modal-chars">{text.length}/280</div>
                <div className="grove-modal-actions">
                    <button className="grove-btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="grove-btn-primary" onClick={() => { onSave(text); onClose(); }}>Save</button>
                </div>
            </div>
        </div>
    );
}

interface StatusPickerProps {
    current:    ActivityStatus;
    customText: string;
    onPick:     (s: ActivityStatus) => void;
    onCustom:   (text: string) => void;
    onClose:    () => void;
}

function StatusPicker({ current, customText, onPick, onCustom, onClose }: StatusPickerProps) {
    const ref       = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState(customText);

    useEffect(() => {
        function onClickOut(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener("mousedown", onClickOut);
        return () => document.removeEventListener("mousedown", onClickOut);
    }, [onClose]);

    return (
        <div className="grove-status-picker" ref={ref} role="menu" aria-label="Set status">
            {(Object.entries(STATUS_LABELS) as [ActivityStatus, string][]).map(([s, label]) => (
                <button
                    key={s}
                    className={`grove-status-pick-row${s === current ? " active" : ""}`}
                    onClick={() => { onPick(s); }}
                    role="menuitem"
                >
                    <span className="grove-status-dot" style={{ background: STATUS_COLORS[s] }} />
                    {label}
                </button>
            ))}
            <div className="grove-status-custom-wrap">
                <input
                    className="grove-status-custom-input"
                    placeholder="Custom status… (emoji welcome 🎮)"
                    value={draft}
                    maxLength={50}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") { onCustom(draft.trim()); onClose(); }
                        if (e.key === "Escape") onClose();
                    }}
                    aria-label="Custom status text"
                />
                <button
                    className="grove-btn-primary grove-btn-sm"
                    onClick={() => { onCustom(draft.trim()); onClose(); }}
                >Set</button>
            </div>
        </div>
    );
}

export function ProfileMenu({
    username,
    about,
    status,
    customStatusText = "",
    onStatusChange,
    onCustomStatusChange,
    onAboutSave,
}: {
    userId?:              number;
    username:             string;
    about:                string;
    status:               ActivityStatus;
    customStatusText?:    string;
    onStatusChange:       (s: ActivityStatus) => void;
    onCustomStatusChange: (text: string) => void;
    onAboutSave:          (text: string) => void;
}) {
    const [open,        setOpen]        = useState(false);
    const [showAbout,   setShowAbout]   = useState(false);
    const [showStatus,  setShowStatus]  = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onClickOut(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
                setShowStatus(false);
            }
        }
        document.addEventListener("mousedown", onClickOut);
        return () => document.removeEventListener("mousedown", onClickOut);
    }, [open]);

    const initial = username.slice(0, 1).toUpperCase();

    return (
        <>
            {/* Full-screen blur when menu open */}
            {open && <div className="grove-profile-menu-backdrop" onClick={() => setOpen(false)} />}

            <div className="grove-profile-menu-anchor" ref={containerRef}>
                {/* Radial items */}
                {open && MENU_ITEMS.map(item => {
                    const pos = radialPos(item.angle);
                    return (
                        <button
                            key={item.key}
                            className="grove-radial-item"
                            style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
                            aria-label={item.label}
                            title={item.label}
                            onClick={() => {
                                if (item.key === "about")    { setShowAbout(true);  setOpen(false); }
                                if (item.key === "status")   { setShowStatus(v => !v); }
                                if (item.key === "settings") { /* future */ setOpen(false); }
                            }}
                        >
                            <span className="grove-radial-item-icon">{item.icon}</span>
                            <span className="grove-radial-item-label">{item.label}</span>
                        </button>
                    );
                })}

                {/* Status picker attached to the status radial item */}
                {open && showStatus && (() => {
                    const pos = radialPos(45);
                    return (
                        <div
                            className="grove-status-picker-wrap"
                            style={{ transform: `translate(${pos.x + 44}px, ${pos.y}px)` }}
                        >
                            <StatusPicker
                                current={status}
                                customText={customStatusText}
                                onPick={s => { onStatusChange(s); }}
                                onCustom={text => onCustomStatusChange(text)}
                                onClose={() => setShowStatus(false)}
                            />
                        </div>
                    );
                })()}

                {/* Profile button */}
                <button
                    className={`grove-profile-btn${open ? " open" : ""}`}
                    onClick={() => setOpen(v => !v)}
                    aria-label={`${username} — ${STATUS_LABELS[status]}. Click to open profile menu.`}
                    aria-expanded={open}
                >
                    <div
                        className="grove-profile-btn-avatar"
                        style={{
                            background: `radial-gradient(circle at 38% 30%, rgba(255,255,255,0.88) 0%, #1a7fd4 45%, #0a52a8cc 100%)`,
                        }}
                    >
                        {initial}
                        <span
                            className="grove-profile-status-dot"
                            style={{ background: STATUS_COLORS[status] }}
                        />
                    </div>
                </button>
            </div>

            {showAbout && (
                <AboutModal
                    current={about}
                    onSave={onAboutSave}
                    onClose={() => setShowAbout(false)}
                />
            )}
        </>
    );
}

export { STATUS_COLORS, STATUS_LABELS };
