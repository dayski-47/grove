export function NotifPanel({
    channels, dms, unreads, onNavigate, onClose,
}: {
    channels:   { id: number; name: string }[];
    dms:        { channel_id: number; partner_name: string }[];
    unreads:    Record<number, number>;
    onNavigate: (id: number, name: string, kind: "channel" | "dm") => void;
    onClose:    () => void;
}) {
    const items = Object.entries(unreads)
        .filter(([, c]) => c > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([idStr, count]) => {
            const id   = Number(idStr);
            const ch   = channels.find(c => c.id === id);
            const dm   = dms.find(d => d.channel_id === id);
            const kind: "channel" | "dm" = ch ? "channel" : "dm";
            const name = ch?.name ?? dm?.partner_name ?? (kind === "dm" ? "Direct message" : `channel ${id}`);
            return { id, name, kind, count };
        });

    return (
        <div className="dw-notif-panel" role="menu" aria-label="Unread messages">
            <div className="dw-notif-header">Unread</div>
            {items.length === 0 ? (
                <div className="dw-notif-empty">All caught up</div>
            ) : items.map(({ id, name, kind, count }) => (
                <button
                    key={id}
                    className="dw-notif-item"
                    role="menuitem"
                    onClick={() => { onNavigate(id, name, kind); onClose(); }}
                >
                    <span className="dw-notif-prefix">{kind === "dm" ? "@" : "#"}</span>
                    <span className="dw-notif-name">{name}</span>
                    <span className="dw-notif-count">{count > 99 ? "99+" : count}</span>
                </button>
            ))}
        </div>
    );
}
