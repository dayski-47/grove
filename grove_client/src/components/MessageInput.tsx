// src/components/MessageInput.tsx
import { useState } from "react";

export function MessageInput({
    onSend,
    disabled,
}: {
    onSend:   (text: string) => void;
    disabled: boolean;
}) {
    const [text, setText] = useState("");

    function submit() {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
    }

    return (
        <div className="grove-input-bar">
            {/* Glass capsule inner wrapper — focus-within drives the ring */}
            <div className="grove-input-bar-inner">
                <input
                    className="grove-message-field"
                    placeholder={disabled ? "connecting…" : "say something…"}
                    value={text}
                    disabled={disabled}
                    aria-label="Message input"
                    onChange={(e) => setText(e.target.value)}
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
