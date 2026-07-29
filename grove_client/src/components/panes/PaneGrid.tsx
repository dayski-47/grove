import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getLeaves, type PaneContent, type PaneTreeNode, type SplitPath } from "../../paneLayout";

// eslint-disable-next-line react-refresh/only-export-components -- shared color map, not a component; reused by PaneChrome.tsx
export const KIND_ACCENT: Record<PaneContent["kind"], string> = {
    channel:      "var(--leaf-bright)",
    dm:           "#5a9bd8",
    notification: "#d8a545",
    details:      "#a56ad8",
};

// A nested split doesn't have its own stable id, but its leftmost leaf's
// paneId is stable and unique — use it to key subtrees across renders so
// AnimatePresence can tell which branch is "staying" vs "new" on a split.
function firstLeafId(node: PaneTreeNode): string {
    return node.type === "leaf" ? node.pane.paneId : firstLeafId(node.a);
}

export interface PaneGridProps {
    root:          PaneTreeNode;
    chromeState:   "state2" | "state3";
    focusedPaneId: string | null;
    pillHovered:   boolean;
    onFocusPane:   (paneId: string) => void;
    onHoverPane:   (paneId: string | null) => void;
    onOpenDetails: (paneId: string) => void;
    onClosePane:   (paneId: string) => void;
    onResizeSplit: (path: SplitPath, ratio: number) => void;
    renderContent: (pane: PaneContent) => React.ReactNode;
}

type PaneNodeProps = {
    node:      PaneTreeNode;
    path:      SplitPath;
    indexById: Map<string, number>;
} & Omit<PaneGridProps, "root">;

export function PaneGrid({
    root, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, onClosePane, onResizeSplit, renderContent,
}: PaneGridProps) {
    const indexById = new Map(getLeaves(root).map((leaf, i) => [leaf.pane.paneId, i + 1]));
    return (
        <div className={`pane-grid-root${chromeState === "state2" && pillHovered ? " pane-grid-dimmed" : ""}`}>
            <PaneNode
                node={root}
                path={[]}
                indexById={indexById}
                chromeState={chromeState}
                focusedPaneId={focusedPaneId}
                pillHovered={pillHovered}
                onFocusPane={onFocusPane}
                onHoverPane={onHoverPane}
                onOpenDetails={onOpenDetails}
                onClosePane={onClosePane}
                onResizeSplit={onResizeSplit}
                renderContent={renderContent}
            />
        </div>
    );
}

function PaneNode({
    node, path, indexById, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, onClosePane, onResizeSplit, renderContent,
}: PaneNodeProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    if (node.type === "split") {
        return (
            <div className={`pane-split pane-split-${node.axis}`} ref={containerRef}>
                <AnimatePresence initial={false}>
                    <motion.div
                        key={firstLeafId(node.a)}
                        className="pane-split-cell"
                        layout
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ flex: node.ratio }}
                    >
                        <PaneNode node={node.a} path={[...path, "a"]} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} onClosePane={onClosePane} onResizeSplit={onResizeSplit} renderContent={renderContent} />
                    </motion.div>
                    <SplitDivider
                        key="divider"
                        axis={node.axis}
                        containerRef={containerRef}
                        onResize={ratio => onResizeSplit(path, ratio)}
                    />
                    <motion.div
                        key={firstLeafId(node.b)}
                        className="pane-split-cell"
                        layout
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ flex: 1 - node.ratio }}
                    >
                        <PaneNode node={node.b} path={[...path, "b"]} indexById={indexById} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} onClosePane={onClosePane} onResizeSplit={onResizeSplit} renderContent={renderContent} />
                    </motion.div>
                </AnimatePresence>
            </div>
        );
    }

    const { pane } = node;
    const isFocused = pane.paneId === focusedPaneId;
    const paneIndex = indexById.get(pane.paneId) ?? 0;
    // Channel/dm panes render their own header via ChatView's headerMode prop
    // (see AppShell's renderPaneContent) — PaneGrid only owns the header for
    // pane kinds that have no header of their own: details, notification, and
    // the empty (unfilled) placeholder.
    const ownsHeader = pane.kind === "details" || pane.kind === "notification" || pane.channelId === null;

    return (
        <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={`pane-leaf${isFocused ? " focused" : ""}`}
            onMouseEnter={() => onHoverPane(pane.paneId)}
            onMouseLeave={() => onHoverPane(null)}
            onMouseDown={() => onFocusPane(pane.paneId)}
        >
            {chromeState === "state3" && ownsHeader && (
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
                    <button
                        className="pane-leaf-header-close-btn"
                        onClick={() => onClosePane(pane.paneId)}
                        aria-label="Close pane"
                        title="Close pane"
                    >
                        ×
                    </button>
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
        </motion.div>
    );
}

function SplitDivider({
    axis, containerRef, onResize,
}: {
    axis: "row" | "column";
    containerRef: React.RefObject<HTMLDivElement | null>;
    onResize: (ratio: number) => void;
}) {
    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        e.preventDefault();
        const containerEl = containerRef.current;
        if (!containerEl) return;
        // Re-bind to a non-nullable const: `container.current` narrowing above
        // doesn't survive into the nested function declarations below.
        const container: HTMLDivElement = containerEl;
        e.currentTarget.setPointerCapture(e.pointerId);

        function handleMove(moveEvent: PointerEvent) {
            const rect = container.getBoundingClientRect();
            const ratio = axis === "row"
                ? (moveEvent.clientX - rect.left) / rect.width
                : (moveEvent.clientY - rect.top) / rect.height;
            onResize(ratio);
        }
        function handleUp() {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
        }
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
    }

    return (
        <div className={`pane-split-handle pane-split-handle-${axis}`} onPointerDown={handlePointerDown}>
            <div className="pane-split-handle-bar" />
        </div>
    );
}
