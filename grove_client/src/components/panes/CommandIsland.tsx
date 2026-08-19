import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BellGlyph, FriendsIcon, MessagesIcon, SettingsIcon, ActivityIcon } from "../appshell/icons";

export type IslandAction = "settings" | "channels" | "messages" | "users" | "notifications" | "activity" | "more";

function HashIcon() {
    return <span aria-hidden="true" className="hashlabel">#</span>;
}

function MoreDotsIcon() {
    return (
        <span aria-hidden="true" className="dots">
            <span /><span /><span />
        </span>
    );
}

interface IslandItem {
    action: IslandAction;
    label:  string;
    icon:   React.ComponentType;
    /** "activity" and "more" are reserved for future icons per the design
        spec ("extensible, not fixed forever") — real, inert buttons rather
        than a stubbed promise. */
    inert?: boolean;
}

const ISLAND_ITEMS: IslandItem[] = [
    { action: "settings",      label: "Settings",      icon: SettingsIcon },
    { action: "channels",      label: "Channels",      icon: HashIcon },
    { action: "messages",      label: "Messages",      icon: MessagesIcon },
    { action: "users",         label: "Users",         icon: FriendsIcon },
    { action: "notifications", label: "Notifications", icon: BellGlyph },
    { action: "activity",      label: "Activity",      icon: ActivityIcon, inert: true },
    { action: "more",          label: "More",          icon: MoreDotsIcon, inert: true },
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
            <motion.div
                layoutId="chrome-morph"
                layout
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="command-island"
                role="menu"
                aria-label="Command island"
                onClick={e => e.stopPropagation()}
            >
                {ISLAND_ITEMS.map((item, i) => {
                    const Icon = item.icon;
                    return (
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
                            <Icon />
                        </button>
                    );
                })}
            </motion.div>
        </div>
    );
}
