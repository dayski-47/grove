// src/components/MessageInput.tsx
import { useEffect, useRef, useState } from "react";

export function MessageInput({
    onSend,
    onTyping,
    disabled,
    mentionUsers = [],
}: {
    onSend:        (text: string) => void;
    onTyping?:     () => void;
    disabled:      boolean;
    mentionUsers?: { id: number; name: string }[];
}) {
    const [text, setText]               = useState("");
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const lastTypingSent                = useRef(0);
    const inputRef                      = useRef<HTMLInputElement>(null);

    const suggestions = mentionQuery !== null
        ? mentionUsers.filter(u => u.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6)
        : [];

    function submit() {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
        setMentionQuery(null);
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        setText(val);

        // Throttle typing indicator
        const now = Date.now();
        if (onTyping && now - lastTypingSent.current > 2500) {
            lastTypingSent.current = now;
            onTyping();
        }

        // Detect @mention trigger
        const cursor = e.target.selectionStart ?? val.length;
        const before = val.slice(0, cursor);
        const match  = before.match(/@(\w*)$/);
        if (match) {
            setMentionQuery(match[1]);
            setMentionIndex(0);
        } else {
            setMentionQuery(null);
        }
    }

    function completeMention(name: string) {
        const cursor   = inputRef.current?.selectionStart ?? text.length;
        const before   = text.slice(0, cursor);
        const after    = text.slice(cursor);
        const replaced = before.replace(/@(\w*)$/, `@${name} `);
        const next     = replaced + after;
        setText(next);
        setMentionQuery(null);
        inputRef.current?.focus();
        // Move cursor to after the inserted mention
        const newPos = replaced.length;
        setTimeout(() => inputRef.current?.setSelectionRange(newPos, newPos), 0);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (suggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex(i => (i + 1) % suggestions.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex(i => (i - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === "Tab" || e.key === "Enter") {
                if (suggestions[mentionIndex]) {
                    e.preventDefault();
                    completeMention(suggestions[mentionIndex].name);
                    return;
                }
            }
            if (e.key === "Escape") {
                setMentionQuery(null);
                return;
            }
        }
        if (e.key === "Enter") submit();
    }

    // Close mention list on outside click
    useEffect(() => {
        if (mentionQuery === null) return;
        function onDown(e: MouseEvent) {
            if (!(e.target as Element).closest(".grove-mention-dropdown")) {
                setMentionQuery(null);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [mentionQuery]);

    return (
        <div className="grove-input-bar">
            {/* @mention autocomplete */}
            {suggestions.length > 0 && (
                <div className="grove-mention-dropdown" role="listbox" aria-label="Mention suggestions">
                    {suggestions.map((u, i) => (
                        <button
                            key={u.id}
                            className={`grove-mention-option${i === mentionIndex ? " active" : ""}`}
                            role="option"
                            aria-selected={i === mentionIndex}
                            onMouseDown={e => { e.preventDefault(); completeMention(u.name); }}
                        >
                            <span className="grove-mention-option-at">@</span>
                            {u.name}
                        </button>
                    ))}
                </div>
            )}

            <div className="grove-input-bar-inner">
                <input
                    ref={inputRef}
                    className="grove-message-field"
                    placeholder={disabled ? "connecting…" : "say something… (@mention someone)"}
                    value={text}
                    disabled={disabled}
                    aria-label="Message input"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                <button
                    className="grove-send"
                    onClick={submit}
                    disabled={disabled}
                    aria-label="Send message"
                >
                    Send
                </button>
            </div>
        </div>
    );
}
