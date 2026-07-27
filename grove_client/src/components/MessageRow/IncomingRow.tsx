import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function IncomingRow({
    m, name, myUsername, isOwn, canModerate, senderColor, isCont, isPinned, reactions,
    isNew, enterDelayMs,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    // "own-accent" (not "own") — this row never mirrors to the right, it only
    // gets the leaf accent treatment. "own" is reserved for OutgoingRow's
    // split-lane mirroring so the two don't collide when both classes could
    // theoretically apply to a left-aligned own message in group mode.
    const rowClass    = ["dw-msg-row", isCont ? "cont" : "", isOwn ? "own-accent" : "", m.pending ? "pending" : "", isNew ? "entering" : ""].filter(Boolean).join(" ");
    const rowStyle    = isNew && enterDelayMs > 0 ? { animationDelay: `${enterDelayMs}ms` } : undefined;
    const showActions = m.id !== undefined && !m.deleted && !isEditing;
    const authorStyle = !isOwn && senderColor ? { color: senderColor } : undefined;

    return (
        <div className={rowClass} style={rowStyle}>
            {isCont ? (
                <div className="dw-cont-space" aria-hidden="true">
                    <span className="dw-cont-time">{formatTime(m.timestamp)}</span>
                </div>
            ) : (
                <button
                    className="dw-msg-avatar"
                    style={{ background: avatarBg(m.userId) }}
                    onClick={onUserClick}
                    aria-label={`View ${name}'s profile`}
                >
                    {initial(name)}
                </button>
            )}

            <div className="dw-msg-body">
                {!isCont && (
                    <div className="dw-msg-meta">
                        <button
                            className={`dw-msg-author${isOwn ? " own" : ""}`}
                            style={authorStyle}
                            onClick={onUserClick}
                            aria-label={`View ${name}'s profile`}
                        >
                            {name}
                        </button>
                        <span className="dw-msg-time">{formatTime(m.timestamp)}</span>
                    </div>
                )}

                <MessageBody
                    m={m} myUsername={myUsername} isEditing={isEditing} editText={editText}
                    onEditChange={onEditChange} onEditSubmit={onEditSubmit} onEditCancel={onEditCancel}
                    reactions={reactions} onReact={onReact}
                />
            </div>

            {showActions && (
                <MessageActions
                    isOwn={isOwn} canModerate={canModerate} isPinned={isPinned} side="right"
                    onEdit={() => onStartEdit(m.id!, m.text)}
                    onDelete={() => onDelete(m.id!)}
                    onPin={() => onPin(m.id!)}
                    onUnpin={() => onUnpin(m.id!)}
                />
            )}
        </div>
    );
}
