import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
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
    const prevCountsRef  = useRef<Record<string, number> | null>(null);

    // react-hooks/refs flags this ref.current read inside a useMemo body.
    // Safe here: the ref only drives a cosmetic "pop" class, is written from
    // the effect below (never during render), and re-renders are already
    // driven by the reactions prop, not by this ref.
    const poppingEmojis = useMemo(() => {
        const popping = new Set<string>();
        // eslint-disable-next-line react-hooks/refs -- see comment above useMemo
        const prevCounts = prevCountsRef.current;
        if (prevCounts === null) return popping;

        const prevMap = new Map(Object.entries(prevCounts));
        for (const [emoji, info] of msgReactions) {
            if (prevMap.get(emoji) !== info.count) popping.add(emoji);
        }
        return popping;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- msgReactions is a fresh array every render; reactions is the stable dep that actually changes.
    }, [reactions]);

    useEffect(() => {
        const next: Record<string, number> = {};
        for (const [emoji, info] of msgReactions) next[emoji] = info.count;
        prevCountsRef.current = next;
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
                    {msgReactions.map(([emoji, info]) => (
                        <button
                            key={`${emoji}-${info.count}`}
                            className={`dw-reaction${info.byMe ? " mine" : ""}${poppingEmojis.has(emoji) ? " pop" : ""}`}
                            onClick={() => m.id !== undefined && onReact(m.id, emoji)}
                            title={info.byMe ? `You reacted ${emoji}` : `React with ${emoji}`}
                        >
                            {emoji}
                            <span className="dw-reaction-count">{info.count}</span>
                        </button>
                    ))}
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
