import { useEffect, useRef, type KeyboardEvent } from "react";
import { parseMarkdown, QUICK_EMOJIS, type ReactionInfo } from "./shared";
import type { DisplayMessage } from "../MessageList";

interface MessageBodyProps {
    m:            DisplayMessage;
    myUsername:   string;
    isEditing:    boolean;
    editText:     string;
    onEditChange: (t: string) => void;
    onEditSubmit: () => void;
    onEditCancel: () => void;
    reactions:    Record<string, ReactionInfo> | undefined;
    onReact:      (id: number, emoji: string) => void;
}

export function MessageBody({
    m, myUsername, isEditing, editText,
    onEditChange, onEditSubmit, onEditCancel,
    reactions, onReact,
}: MessageBodyProps) {
    const msgReactions   = reactions ? Object.entries(reactions) : [];
    const prevCountsRef  = useRef<Map<string, number> | null>(null);
    const prevCounts     = prevCountsRef.current;

    useEffect(() => {
        prevCountsRef.current = new Map(msgReactions.map(([emoji, info]) => [emoji, info.count]));
    });

    function handleEditKey(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter")  { e.preventDefault(); onEditSubmit(); }
        if (e.key === "Escape") onEditCancel();
    }

    return (
        <>
            <div>
                {m.deleted ? (
                    <span className="dw-msg-deleted">message deleted</span>
                ) : isEditing ? (
                    <div className="dw-edit-wrap">
                        <input
                            className="dw-edit-input"
                            value={editText}
                            onChange={e => onEditChange(e.target.value)}
                            onKeyDown={handleEditKey}
                            autoFocus
                            aria-label="Edit message"
                        />
                        <span className="dw-edit-hint">Enter to save · Esc to cancel</span>
                    </div>
                ) : (
                    <span className="dw-msg-text">
                        {parseMarkdown(m.text, myUsername)}
                    </span>
                )}
                {m.edited && !m.deleted && !isEditing && (
                    <span className="dw-msg-edited-tag">(edited)</span>
                )}
            </div>

            {msgReactions.length > 0 && (
                <div className="dw-reactions" aria-label="Reactions">
                    {msgReactions.map(([emoji, info]) => {
                        const justChanged = prevCounts !== null && prevCounts.get(emoji) !== info.count;
                        return (
                            <button
                                key={`${emoji}-${info.count}`}
                                className={`dw-reaction${info.byMe ? " mine" : ""}${justChanged ? " pop" : ""}`}
                                onClick={() => m.id !== undefined && onReact(m.id, emoji)}
                                title={info.byMe ? `You reacted ${emoji}` : `React with ${emoji}`}
                            >
                                {emoji}
                                <span className="dw-reaction-count">{info.count}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {m.id !== undefined && !m.deleted && !isEditing && (
                <div className="dw-emoji-pick" aria-label="Quick react">
                    {QUICK_EMOJIS.map(e => (
                        <button key={e} className="dw-emoji-btn" title={`React ${e}`} onClick={() => onReact(m.id!, e)}>
                            {e}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
