import { useEffect, useRef, useState } from "react";
import { getToken } from "../../auth";
import { unfurlLink, imageProxyUrl } from "../../api";

interface PreviewState {
    title?:       string;
    description?: string;
    hasImage:     boolean;
    urlHash?:     string;
}

// One IntersectionObserver per card, disconnected after the first
// intersection — cheap, and avoids firing an unfurl call for every link in
// a long history the instant it mounts. Single caller, so this stays local
// rather than becoming a shared hook (see this project's hook-extraction rule).
function useOnceVisible(ref: React.RefObject<HTMLElement | null>): boolean {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (visible) return;
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [visible, ref]);
    return visible;
}

export function LinkPreviewCard({ url }: { url: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const visible = useOnceVisible(containerRef);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!visible) return;
        const token = getToken();
        if (!token) return;

        let cancelled = false;
        unfurlLink(url, token)
            .then(result => {
                if (cancelled || !result.available) return;
                setPreview({
                    title:       result.title ?? undefined,
                    description: result.description ?? undefined,
                    hasImage:    result.has_image,
                    urlHash:     result.url_hash ?? undefined,
                });
            })
            .catch(() => { /* no preview is a normal, silent outcome */ });

        return () => { cancelled = true; };
    }, [visible, url]);

    if (dismissed || !preview) {
        return <div ref={containerRef} aria-hidden="true" />;
    }

    const token = getToken();

    return (
        <div ref={containerRef} className="dw-link-preview">
            {preview.hasImage && preview.urlHash && token && (
                <img
                    className="dw-link-preview-img"
                    src={imageProxyUrl(preview.urlHash, token)}
                    alt=""
                    loading="lazy"
                />
            )}
            <div className="dw-link-preview-body">
                {preview.title && <div className="dw-link-preview-title">{preview.title}</div>}
                {preview.description && <div className="dw-link-preview-desc">{preview.description}</div>}
            </div>
            <button
                className="dw-link-preview-dismiss"
                aria-label="Dismiss preview"
                onClick={() => setDismissed(true)}
            >
                ×
            </button>
        </div>
    );
}
