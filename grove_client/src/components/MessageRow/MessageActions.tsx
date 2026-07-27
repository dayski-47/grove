interface MessageActionsProps {
    isOwn:        boolean;
    canModerate?: boolean;
    isPinned:     boolean;
    side:         "left" | "right";
    onEdit:       () => void;
    onDelete:     () => void;
    onPin:        () => void;
    onUnpin:      () => void;
}

export function MessageActions({ isOwn, canModerate = false, isPinned, side, onEdit, onDelete, onPin, onUnpin }: MessageActionsProps) {
    // Edit stays author-only — the backend's moderator bypass is delete-only
    // (Task 13). Delete is available to the author OR a moderator/owner.
    const canDelete = isOwn || canModerate;
    return (
        <div className={`dw-msg-actions ${side}`} aria-label="Message actions">
            {isOwn && (
                <button className="dw-msg-action" title="Edit" onClick={onEdit} aria-label="Edit message">
                    <EditIcon />
                </button>
            )}
            {canDelete && (
                <button
                    className="dw-msg-action danger"
                    title="Delete"
                    onClick={() => { if (window.confirm("Delete this message?")) onDelete(); }}
                    aria-label="Delete message"
                >
                    <TrashIcon />
                </button>
            )}
            <button
                className={`dw-msg-action${isPinned ? " active" : ""}`}
                title={isPinned ? "Unpin" : "Pin"}
                onClick={isPinned ? onUnpin : onPin}
                aria-label={isPinned ? "Unpin message" : "Pin message"}
            >
                <PinIcon />
            </button>
        </div>
    );
}

function EditIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
    );
}

function PinIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/>
        </svg>
    );
}
