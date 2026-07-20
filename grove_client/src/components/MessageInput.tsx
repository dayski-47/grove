import { useEffect, useRef, useState } from "react";
import { SendSpark, type SendSparkHandle } from "./motion/SendSpark";

export function MessageInput({
    onSend,
    onTyping,
    disabled,
    channelName = "",
    mentionUsers = [],
    onEditLastMessage,
}: {
    onSend:                (text: string) => void;
    onTyping?:             () => void;
    disabled:              boolean;
    channelName?:          string;
    mentionUsers?:         { id: number; name: string }[];
    onEditLastMessage?:    () => void;
}) {
    const [text, setText]               = useState("");
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const lastTypingSent                = useRef(0);
    const inputRef                      = useRef<HTMLTextAreaElement>(null);
    const sparkRef                      = useRef<SendSparkHandle>(null);

    const suggestions = mentionQuery !== null
        ? mentionUsers.filter(u => u.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6)
        : [];

    const hasText = text.trim().length > 0;

    function submit() {
        const trimmed = text.trim();
        if (!trimmed || disabled) return;
        onSend(trimmed);
        sparkRef.current?.burst();
        setText("");
        setMentionQuery(null);
        // Reset textarea height
        if (inputRef.current) inputRef.current.style.height = "auto";
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        const val = e.target.value;
        setText(val);

        // Auto-grow
        const el = inputRef.current;
        if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }

        // Throttle typing indicator
        const now = Date.now();
        if (onTyping && now - lastTypingSent.current > 2500) {
            lastTypingSent.current = now;
            onTyping();
        }

        // Detect @mention
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
        setText(replaced + after);
        setMentionQuery(null);
        inputRef.current?.focus();
        const newPos = replaced.length;
        setTimeout(() => inputRef.current?.setSelectionRange(newPos, newPos), 0);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (suggestions.length > 0) {
            if (e.key === "ArrowDown")  { e.preventDefault(); setMentionIndex(i => (i + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp")    { e.preventDefault(); setMentionIndex(i => (i - 1 + suggestions.length) % suggestions.length); return; }
            if ((e.key === "Tab" || e.key === "Enter") && suggestions[mentionIndex]) {
                e.preventDefault();
                completeMention(suggestions[mentionIndex].name);
                return;
            }
            if (e.key === "Escape") { setMentionQuery(null); return; }
        }
        if (e.key === "ArrowUp" && text === "" && onEditLastMessage) {
            e.preventDefault();
            onEditLastMessage();
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    useEffect(() => {
        if (mentionQuery === null) return;
        function onDown(e: MouseEvent) {
            if (!(e.target as Element).closest(".dw-mention-list")) setMentionQuery(null);
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [mentionQuery]);

    const placeholder = disabled
        ? "connecting…"
        : channelName
        ? `Message #${channelName}`
        : "Message…";

    return (
        <div className="dw-input-area">
            {suggestions.length > 0 && (
                <div className="dw-mention-list" role="listbox" aria-label="Mention suggestions">
                    {suggestions.map((u, i) => (
                        <button
                            key={u.id}
                            className={`dw-mention-opt${i === mentionIndex ? " active" : ""}`}
                            role="option"
                            aria-selected={i === mentionIndex}
                            onMouseDown={e => { e.preventDefault(); completeMention(u.name); }}
                        >
                            <span className="dw-mention-at">@</span>
                            {u.name}
                        </button>
                    ))}
                </div>
            )}

            <div className={`dw-input-box${disabled ? " offline" : ""}`}>
                <textarea
                    ref={inputRef}
                    className="dw-text-input"
                    placeholder={placeholder}
                    value={text}
                    disabled={disabled}
                    rows={1}
                    aria-label="Message input"
                    aria-multiline="true"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                <div className="dw-send-btn-wrap">
                    <button
                        className={`dw-send-btn${hasText ? " show" : ""}`}
                        onClick={submit}
                        disabled={disabled || !hasText}
                        aria-label="Send message"
                        tabIndex={hasText ? 0 : -1}
                    >
                        <SendIcon />
                    </button>
                    <SendSpark ref={sparkRef} color="var(--leaf-bright)" />
                </div>
            </div>
        </div>
    );
}

function SendIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
    );
}
