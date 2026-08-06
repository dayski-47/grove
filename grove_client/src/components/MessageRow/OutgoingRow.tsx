import { memo } from "react";
import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export const OutgoingRow = memo(function OutgoingRow({
    m, name, myUsername, isCont, isPinned, reactions,
    isNew, enterDelayMs,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    const rowClass    = ["dw-msg-row", "own", isCont ? "cont" : "", m.pending ? "pending" : "", isNew ? "entering" : ""].filter(Boolean).join(" ");
    const rowStyle    = isNew && enterDelayMs > 0 ? { animationDelay: `${enterDelayMs}ms` } : undefined;
    const showActions = m.id !== undefined && !m.deleted && !isEditing;

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
                    onClick={e => onUserClick(m.userId, e)}
                    aria-label={`View ${name}'s profile`}
                >
                    {initial(name)}
                </button>
            )}

            <div className="dw-msg-body">
                {!isCont && (
                    <div className="dw-msg-meta">
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
                    isOwn={true} isPinned={isPinned} side="left"
                    onEdit={() => onStartEdit(m.id!, m.text)}
                    onDelete={() => onDelete(m.id!)}
                    onPin={() => onPin(m.id!)}
                    onUnpin={() => onUnpin(m.id!)}
                />
            )}
        </div>
    );
});
