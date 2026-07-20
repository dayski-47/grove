import { useDecryptReveal } from "../../hooks/useDecryptReveal";

interface DecryptRevealProps {
    text:        string;
    durationMs?: number;
    className?:  string;
}

/**
 * Visual-only scramble-to-reveal text. The parent element must supply the
 * real accessible name (aria-label or its own text) since this span is
 * aria-hidden — it exists purely as decoration over the parent's content.
 */
export function DecryptReveal({ text, durationMs, className }: DecryptRevealProps) {
    const display = useDecryptReveal(text, durationMs);
    return (
        <span className={className} aria-hidden="true">
            {display}
        </span>
    );
}
