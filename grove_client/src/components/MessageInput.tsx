// src/components/MessageInput.tsx
import { useState } from "react";

export function MessageInput({
    onSend,
    disabled,
}: {
    onSend: (text: string) => void;
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
        <input
            className="grove-message-field"
            placeholder={disabled ? "connecting…" : "say something…"}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            }}
        />
        <button className="grove-send" onClick={submit} disabled={disabled}>
            send
        </button>
        </div>
    );
}