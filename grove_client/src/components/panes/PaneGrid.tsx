import { getLeaves, type PaneContent, type PaneTreeNode } from "../../paneLayout";

const KIND_ACCENT: Record<PaneContent["kind"], string> = {
    channel:      "var(--leaf-bright)",
    dm:           "#5a9bd8",
    notification: "#d8a545",
    details:      "#a56ad8",
};

export interface PaneGridProps {
    root:          PaneTreeNode;
    chromeState:   "state2" | "state3";
    focusedPaneId: string | null;
    pillHovered:   boolean;
    onFocusPane:   (paneId: string) => void;
    onHoverPane:   (paneId: string | null) => void;
    onOpenDetails: (paneId: string) => void;
    renderContent: (pane: PaneContent) => React.ReactNode;
}

type PaneNodeProps = {
    node:      PaneTreeNode;
    indexById: Map<string, number>;
} & Omit<PaneGridProps, "root">;

export function PaneGrid({
    root, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, renderContent,
}: PaneGridProps) {
    const indexById = new Map(getLeaves(root).map((leaf, i) => [leaf.pane.paneId, i + 1]));
    return (
        <div className={`pane-grid-root${chromeState === "state2" && pillHovered ? " pane-grid-dimmed" : ""}`}>
            <PaneNode
                node={root}
                indexById={indexById}
                chromeState={chromeState}
                focusedPaneId={focusedPaneId}
                pillHovered={pillHovered}
                onFocusPane={onFocusPane}
                onHoverPane={onHoverPane}
                onOpenDetails={onOpenDetails}
                renderContent={renderContent}
            />
        </div>
    );
}

function PaneNode({
    node, indexById, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, renderContent,
}: PaneNodeProps) {
    if (node.type === "split") {
        return (
            <div className={`pane-split pane-split-${node.axis}`}>
                <div className="pane-split-cell" style={{ flex: node.ratio }}>
                    <PaneNode node={node.a} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} renderContent={renderContent} />
                </div>
                <div className="pane-split-cell" style={{ flex: 1 - node.ratio }}>
                    <PaneNode node={node.b} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} renderContent={renderContent} />
                </div>
            </div>
        );
    }

    const { pane } = node;
    const isFocused = pane.paneId === focusedPaneId;
    const paneIndex = indexById.get(pane.paneId) ?? 0;

    return (
        <div
            className={`pane-leaf${isFocused ? " focused" : ""}`}
            onMouseEnter={() => onHoverPane(pane.paneId)}
            onMouseLeave={() => onHoverPane(null)}
            onMouseDown={() => onFocusPane(pane.paneId)}
        >
            {chromeState === "state3" && (
                <div className="pane-leaf-header" style={{ borderLeftColor: KIND_ACCENT[pane.kind] }}>
                    <span className="pane-leaf-header-icon">{pane.kind === "dm" ? "@" : pane.kind === "channel" ? "#" : pane.kind === "details" ? "ⓘ" : "🔔"}</span>
                    <span className="pane-leaf-header-name">{pane.channelName || "Empty pane"}</span>
                    {pane.kind !== "details" && pane.channelId !== null && (
                        <button
                            className="pane-leaf-header-details-btn"
                            onClick={() => onOpenDetails(pane.paneId)}
                            aria-label="Open details"
                            title="Details"
                        >
                            ⓘ
                        </button>
                    )}
                </div>
            )}
            <div className="pane-leaf-content">
                {renderContent(pane)}
            </div>
            {chromeState === "state2" && pillHovered && (
                <div className="pane-leaf-reveal" aria-hidden="true">
                    <span className="pane-leaf-reveal-num">{paneIndex}</span>
                    <span className="pane-leaf-reveal-label">{pane.channelName || "empty"}</span>
                </div>
            )}
        </div>
    );
}
