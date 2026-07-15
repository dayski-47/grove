import { MessageActions } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { avatarBg, formatTime, initial, type MessageRowProps } from "./shared";

export function OutgoingRow({
    m, name, myUsername, isCont, isPinned, reactions,
    editingId, editText, onEditChange, onEditSubmit, onEditCancel,
    onStartEdit, onDelete, onReact, onPin, onUnpin, onUserClick,
}: MessageRowProps) {
    const isEditing   = m.id !== undefined && editingId === m.id;
    const rowClass    = ["dw-msg-row", "own", isCont ? "cont" : "", m.pending ? "pending" : ""].filter(Boolean).join(" ");
    const showActions = m.id !== undefined && !m.deleted && !isEditing;

    return (
        <div className={rowClass}>
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
}
