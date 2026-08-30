// Sits below the top bar, visible regardless of chrome state — the existing
// tiny topbar dot is easy to miss entirely; this is the version you can't.
export function ConnectionBanner({ connected }: { connected: boolean }) {
    if (connected) return null;

    return (
        <div className="dw-connection-banner" role="status" aria-live="polite">
            <span className="dw-connection-banner-dot" aria-hidden="true" />
            Reconnecting to Grove…
        </div>
    );
}
