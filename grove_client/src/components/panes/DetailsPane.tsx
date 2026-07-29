import type { DisplayMessage } from "../MessageList";

export interface DetailsPaneProps {
    channelId: number | null;
    messages:  DisplayMessage[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

function extractLinks(messages: DisplayMessage[]): string[] {
    const found: string[] = [];
    for (const m of messages) {
        if (m.deleted) continue;
        const matches = m.text.match(URL_PATTERN);
        if (matches) found.push(...matches);
    }
    // newest first, de-duplicated
    return [...new Set(found.reverse())];
}

export function DetailsPane({ channelId, messages }: DetailsPaneProps) {
    if (channelId === null) {
        return (
            <div className="details-pane details-pane-empty">
                <p>No channel selected.</p>
            </div>
        );
    }

    const links = extractLinks(messages);

    return (
        <div className="details-pane">
            <section className="details-pane-section">
                <h3 className="details-pane-heading">Shared Links</h3>
                {links.length === 0 ? (
                    <p className="details-pane-empty-text">No links shared yet.</p>
                ) : (
                    <ul className="details-pane-link-list">
                        {links.map((url, i) => (
                            <li key={i} className="details-pane-link-item">
                                <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="details-pane-section">
                <h3 className="details-pane-heading">Files</h3>
                <p className="details-pane-empty-text">Grove doesn't support file uploads yet.</p>
            </section>

            <section className="details-pane-section">
                <h3 className="details-pane-heading">Photos &amp; Videos</h3>
                <p className="details-pane-empty-text">Grove doesn't support media uploads yet.</p>
            </section>
        </div>
    );
}
