import { useEffect, useRef, useState } from "react";

export type IslandAction = "settings" | "channels" | "messages" | "users" | "notifications" | "activity" | "more";

interface IslandItem {
    action: IslandAction;
    label:  string;
    icon:   string;
    /** "activity" and "more" are reserved for future icons per the design
        spec ("extensible, not fixed forever") — real, inert buttons rather
        than a stubbed promise. */
    inert?: boolean;
}

const ISLAND_ITEMS: IslandItem[] = [
    { action: "settings",      label: "Settings",      icon: "⚙" },
    { action: "channels",      label: "Channels",      icon: "#" },
    { action: "messages",      label: "Messages",      icon: "💬" },
    { action: "users",         label: "Users",         icon: "👤" },
    { action: "notifications", label: "Notifications", icon: "🔔" },
    { action: "activity",      label: "Activity",      icon: "⚡", inert: true },
    { action: "more",          label: "More",          icon: "…",  inert: true },
];

export interface CommandIslandProps {
    open:     boolean;
    onSelect: (action: IslandAction) => void;
    onClose:  () => void;
}

export function CommandIsland({ open, onSelect, onClose }: CommandIslandProps) {
    const [focusIdx, setFocusIdx] = useState(0);
    const prevOpenRef = useRef(open);

    // eslint-disable-next-line react-hooks/refs
    if (open && !prevOpenRef.current) {
        setFocusIdx(0);
    }
    // eslint-disable-next-line react-hooks/refs
    prevOpenRef.current = open;

    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setFocusIdx(i => Math.min(i + 1, ISLAND_ITEMS.length - 1));
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setFocusIdx(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const item = ISLAND_ITEMS[focusIdx];
                if (!item.inert) onSelect(item.action);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, focusIdx, onSelect, onClose]);

    if (!open) return null;

    return (
        <div className="command-island-backdrop" onClick={onClose} aria-hidden="true">
            <div
                className="command-island"
                role="menu"
                aria-label="Command island"
                onClick={e => e.stopPropagation()}
            >
                {ISLAND_ITEMS.map((item, i) => (
                    <button
                        key={item.action}
                        role="menuitem"
                        className={`command-island-item${i === focusIdx ? " focused" : ""}${item.inert ? " inert" : ""}`}
                        onMouseEnter={() => setFocusIdx(i)}
                        onClick={() => !item.inert && onSelect(item.action)}
                        aria-label={item.label}
                        title={item.inert ? `${item.label} (coming soon)` : item.label}
                        disabled={item.inert}
                    >
                        <span aria-hidden="true">{item.icon}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
