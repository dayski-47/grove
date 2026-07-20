import { useEffect, useState } from "react";

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*";

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomChar(): string {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function shuffle(text: string, revealedCount: number): string {
    return text
        .split("")
        .map((char, i) => (char === " " || i < revealedCount ? char : randomChar()))
        .join("");
}

/**
 * Reveals `text` left-to-right over `durationMs`, scrambling unrevealed
 * characters in the meantime. Ported from reactbits' DecryptedText,
 * simplified to a mount-only reveal (no hover/click/view-triggered modes)
 * and stripped of its framer-motion dependency — this is a plain
 * setInterval character-swap, framer-motion was never load-bearing there.
 */
export function useDecryptReveal(text: string, durationMs = 500): string {
    const [display, setDisplay] = useState(text);

    useEffect(() => {
        if (prefersReducedMotion() || text.length === 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setDisplay(text);
            return;
        }

        const tickMs = Math.max(16, Math.floor(durationMs / text.length));
        let revealed = 0;
         
        setDisplay(shuffle(text, 0));

        const id = setInterval(() => {
            revealed += 1;
            setDisplay(shuffle(text, revealed));
            if (revealed >= text.length) clearInterval(id);
        }, tickMs);

        return () => clearInterval(id);
    }, [text, durationMs]);

    return display;
}
