// src/components/MessageInput.tsx
import { useRef, useState } from "react";

export function MessageInput({
    onSend,
    onTyping,
    disabled,
}: {
    onSend:     (text: string) => void;
    onTyping?:  () => void;
    disabled:   boolean;
}) {
    const [text, setText] = useState("");
    const lastTypingSent  = useRef(0);

    function submit() {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        setText(e.target.value);
        // Throttle: at most one TYPING frame every 2.5 s while the user types
        const now = Date.now();
        if (onTyping && now - lastTypingSent.current > 2500) {
            lastTypingSent.current = now;
            onTyping();
        }
    }

    return (
        <div className="grove-input-bar">
            <div className="grove-input-bar-inner">
                <input
                    className="grove-message-field"
                    placeholder={disabled ? "connecting…" : "say something…"}
                    value={text}
                    disabled={disabled}
                    aria-label="Message input"
                    onChange={handleChange}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
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
