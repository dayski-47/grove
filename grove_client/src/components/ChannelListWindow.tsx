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
    onJoinById,
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
    onJoinById?:    (id: number) => void;
}) {
    const [newName,   setNewName]   = useState("");
    const [joinId,    setJoinId]    = useState("");
    const [joinError, setJoinError] = useState("");
    const [tab,       setTab]       = useState<"browse" | "create" | "join">("browse");
    const [copied,    setCopied]    = useState<number | null>(null);
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
            const nx = Math.max(0, Math.min(window.innerWidth  - 400, e.clientX - offset.current.x));
            const ny = Math.max(0, Math.min(window.innerHeight - 540, e.clientY - offset.current.y));
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
        setTab("browse");
    }

    function handleJoinById() {
        const id = Number(joinId.trim());
        if (!joinId.trim() || isNaN(id) || id <= 0) {
            setJoinError("Enter a valid channel ID");
            return;
        }
        setJoinError("");
        onJoinById?.(id);
        setJoinId("");
        setTab("browse");
    }

    function copyId(id: number) {
        navigator.clipboard.writeText(String(id)).catch(() => {});
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
    }

    return (
        <div
            className="grove-window grove-list-window"
            style={{ left: x, top: y, zIndex, width: 400, height: 520 }}
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

            {/* Tab bar */}
            <div className="grove-channel-tabs" role="tablist">
                {(["browse", "join", "create"] as const).map(t => (
                    <button
                        key={t}
                        className={`grove-channel-tab${tab === t ? " active" : ""}`}
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                    >
                        {t === "browse" ? "Browse" : t === "join" ? "Join by ID" : "Create"}
                    </button>
                ))}
            </div>

            <div className="grove-list-body">
                {tab === "browse" && (
                    <div className="grove-list-scroll" role="list">
                        {channels.map((ch, i) => {
                            const dot    = TILE_ACCENTS[i % TILE_ACCENTS.length];
                            const isOpen = openChannelIds.has(ch.id);
                            return (
                                <div key={ch.id} className={`grove-list-row grove-channel-row${isOpen ? " grove-list-row-open" : ""}`} role="listitem">
                                    <span className="grove-list-dot" style={{ background: dot }} aria-hidden="true" />
                                    <span className="grove-list-row-hash" aria-hidden="true">#</span>
                                    <button
                                        className="grove-channel-row-name"
                                        onClick={() => onOpen(ch.id, ch.name)}
                                        aria-label={`Open ${ch.name}`}
                                    >
                                        {ch.name}
                                    </button>
                                    <button
                                        className="grove-channel-id-badge"
                                        onClick={() => copyId(ch.id)}
                                        title="Click to copy channel ID"
                                        aria-label={`Channel ID: ${ch.id}. Click to copy.`}
                                    >
                                        {copied === ch.id ? "✓" : `#${ch.id}`}
                                    </button>
                                    {isOpen && <span className="grove-list-row-badge" aria-label="open">•</span>}
                                </div>
                            );
                        })}
                        {channels.length === 0 && (
                            <p className="grove-list-empty">No channels yet. Create one!</p>
                        )}
                    </div>
                )}

                {tab === "join" && (
                    <div className="grove-list-footer-panel">
                        <p className="grove-list-footer-hint">
                            Ask a friend to share their channel ID, then enter it here to join.
                        </p>
                        <input
                            className="grove-input"
                            placeholder="Channel ID (e.g. 3)"
                            value={joinId}
                            onChange={e => { setJoinId(e.target.value); setJoinError(""); }}
                            onKeyDown={e => { if (e.key === "Enter") handleJoinById(); }}
                            type="number"
                            min="1"
                            aria-label="Channel ID to join"
                            autoFocus
                        />
                        <button className="grove-btn-primary" onClick={handleJoinById}>
                            Join Channel
                        </button>
                        {joinError && <p className="grove-list-footer-error">{joinError}</p>}
                    </div>
                )}

                {tab === "create" && (
                    <div className="grove-list-footer-panel">
                        <p className="grove-list-footer-hint">
                            New channels are private by default. Share the channel ID to invite others.
                        </p>
                        <input
                            className="grove-input"
                            placeholder="Channel name"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                            aria-label="New channel name"
                            autoFocus
                        />
                        <button className="grove-btn-primary" onClick={handleCreate}>
                            Create Channel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
