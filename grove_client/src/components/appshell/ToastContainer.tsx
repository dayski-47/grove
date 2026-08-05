export type Toast = {
    id:          string;
    channelId:   number;
    channelName: string;
    kind:        "channel" | "dm";
    senderName:  string;
    preview:     string;
    leaving:     boolean;
    persistent?: boolean;
};

export function ToastContainer({ toasts, onDismiss, onNavigate }: {
    toasts:     Toast[];
    onDismiss:  (id: string) => void;
    onNavigate: (channelId: number, name: string, kind: "channel" | "dm") => void;
}) {
    if (toasts.length === 0) return null;
    return (
        <div className="gv-toast-container" aria-live="polite" aria-label="Notifications">
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={`gv-toast${t.leaving ? " leaving" : ""}`}
                    onClick={() => onNavigate(t.channelId, t.channelName, t.kind)}
                    role="alert"
                >
                    <div className="gv-toast-channel">{t.kind === "dm" ? "@" : "#"}{t.channelName}</div>
                    <div className="gv-toast-sender">{t.senderName}</div>
                    <div className="gv-toast-preview">{t.preview}</div>
                    <button
                        className="gv-toast-close"
                        onClick={e => { e.stopPropagation(); onDismiss(t.id); }}
                        aria-label="Dismiss"
                    >×</button>
                    <div className="gv-toast-bar" />
                </div>
            ))}
        </div>
    );
}
