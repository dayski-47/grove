// src/components/ChannelListWindow.tsx
import { useEffect, useRef, useState } from "react";

const TILE_ACCENTS = [
    "#1a7fd4","#2d8a3c","#7b52c8","#c07828",
    "#1a9090","#b03060","#4a70b8","#4a9060",
];

interface Channel { id: number; name: string; }

export function ChannelListWindow({
    channels,
    openChannelIds,
    x,
    y,
    zIndex,
    onOpen,
    onClose,
    onFocus,
    onDrag,
    onCreateChannel,
}: {
    channels:       Channel[];
    openChannelIds: Set<number>;
    x:              number;
    y:              number;
    zIndex:         number;
    onOpen:         (id: number, name: string) => void;
    onClose:        () => void;
    onFocus:        () => void;
    onDrag:         (x: number, y: number) => void;
    onCreateChannel:(name: string) => void;
}) {
    const [newName, setNewName] = useState("");
    const dragging = useRef(false);
    const offset   = useRef({ x: 0, y: 0 });

    function onChromeMouseDown(e: React.MouseEvent) {
        if ((e.target as HTMLElement).closest(".grove-window-controls")) return;
        dragging.current = true;
        offset.current   = { x: e.clientX - x, y: e.clientY - y };
        onFocus();
        e.preventDefault();
    }

    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!dragging.current) return;
            const nx = Math.max(0, Math.min(window.innerWidth  - 380, e.clientX - offset.current.x));
            const ny = Math.max(0, Math.min(window.innerHeight - 520, e.clientY - offset.current.y));
            onDrag(nx, ny);
        }
        function onMouseUp() { dragging.current = false; }
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup",   onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup",   onMouseUp);
        };
    }, [onDrag]);

    function handleCreate() {
        const n = newName.trim();
        if (!n) return;
        onCreateChannel(n);
        setNewName("");
    }

    return (
        <div
            className="grove-window grove-list-window"
            style={{ left: x, top: y, zIndex, width: 360, height: 480 }}
            onMouseDown={onFocus}
            role="dialog"
            aria-label="Channels"
        >
            <div className="grove-window-chrome" onMouseDown={onChromeMouseDown}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="grove-window-list-icon" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span className="grove-window-title">Channels</span>
                <div className="grove-window-controls">
                    <button className="grove-window-orb grove-window-close" onClick={onClose} aria-label="Close" />
                </div>
            </div>

            <div className="grove-list-body">
                <div className="grove-list-scroll" role="list">
                    {channels.map((ch, i) => {
                        const dot = TILE_ACCENTS[i % TILE_ACCENTS.length];
                        const isOpen = openChannelIds.has(ch.id);
                        return (
                            <button
                                key={ch.id}
                                className={`grove-list-row${isOpen ? " grove-list-row-open" : ""}`}
                                onClick={() => onOpen(ch.id, ch.name)}
                                role="listitem"
                                aria-label={`${ch.name}${isOpen ? " (open)" : ""}`}
                            >
                                <span className="grove-list-dot" style={{ background: dot }} aria-hidden="true" />
                                <span className="grove-list-row-hash" aria-hidden="true">#</span>
                                <span className="grove-list-row-name">{ch.name}</span>
                                {isOpen && <span className="grove-list-row-badge" aria-label="open">•</span>}
                            </button>
                        );
                    })}
                    {channels.length === 0 && (
                        <p className="grove-list-empty">No channels yet. Create one below.</p>
                    )}
                </div>

                <div className="grove-list-footer">
                    <input
                        className="grove-input"
                        placeholder="new channel name"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                        aria-label="New channel name"
                    />
                    <button
                        className="grove-btn-primary"
                        onClick={handleCreate}
                        aria-label="Create channel"
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}
