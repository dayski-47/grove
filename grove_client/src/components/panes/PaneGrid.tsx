import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getLeaves, type PaneContent, type PaneTreeNode, type SplitPath } from "../../paneLayout";

/** A split-cell whose direct child is a leaf that already existed last
    render should skip its own enter fade — that leaf's `motion.div` carries
    a shared `layoutId` (see PaneNode's leaf branch) and drives the "real"
    animation via a FLIP from its old position/size to its new one. Layering
    the cell's opacity/scale entrance on top of that would hide the FLIP
    behind a fade instead of letting the shrink read as continuous motion.
    Nested (non-leaf) children and genuinely new leaves keep the entrance. */
function cellSkipsEntrance(child: PaneTreeNode, freshPaneIds: ReadonlySet<string>): boolean {
    return child.type === "leaf" && !freshPaneIds.has(child.pane.paneId);
}

// eslint-disable-next-line react-refresh/only-export-components -- shared color map, not a component; reused by PaneChrome.tsx
export const KIND_ACCENT: Record<PaneContent["kind"], string> = {
    channel:      "var(--leaf-bright)",
    dm:           "#5a9bd8",
    notification: "#d8a545",
    details:      "#a56ad8",
};

// Key subtrees by stable identity so AnimatePresence can tell which branch
// is "staying" vs "new" across a split-tree restructure. A leaf's own
// paneId is already stable; a split node carries its own `nodeId` (minted
// once at creation and preserved across resize/rebalance/promotion — see
// paneLayout.ts) specifically so that identity doesn't shift just because
// restructuring changed which leaf happens to sit leftmost underneath it.
// Keying by a derived "first leaf" id instead would remount (and silently
// wipe local state under) a subtree that never conceptually changed.
function cellKey(node: PaneTreeNode): string {
    return node.type === "leaf" ? node.pane.paneId : node.nodeId;
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
    node:          PaneTreeNode;
    path:          SplitPath;
    indexById:     Map<string, number>;
    freshPaneIds:  ReadonlySet<string>;
} & Omit<PaneGridProps, "root">;

export function PaneGrid({
    root, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, onClosePane, onResizeSplit, renderContent,
}: PaneGridProps) {
    const indexById = new Map(getLeaves(root).map((leaf, i) => [leaf.pane.paneId, i + 1]));

    // Diff this render's leaves against last render's to find paneIds that
    // are genuinely new (vs. a persisting leaf that just got wrapped in a
    // new split-cell one level deeper) — see cellSkipsEntrance above.
    const prevPaneIdsRef = useRef<ReadonlySet<string>>(new Set());
    const knownPaneIds = new Set(getLeaves(root).map(leaf => leaf.pane.paneId));
    // eslint-disable-next-line react-hooks/refs -- bookkeeping ref read in-render (same pattern as CommandIsland's prevOpenRef) to diff this render's leaves against last render's.
    const freshPaneIds = new Set([...knownPaneIds].filter(id => !prevPaneIdsRef.current.has(id)));
    // eslint-disable-next-line react-hooks/refs -- bookkeeping ref write in-render, mirrors CommandIsland's prevOpenRef.current = open pattern.
    prevPaneIdsRef.current = knownPaneIds;

    return (
        <div className={`pane-grid-root${chromeState === "state2" && pillHovered ? " pane-grid-dimmed" : ""}`}>
            <AnimatePresence initial={false}>
                <motion.div
                    key={cellKey(root)}
                    className="pane-split-cell"
                    layout
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                    <PaneNode
                        node={root}
                        path={[]}
                        indexById={indexById}
                        freshPaneIds={freshPaneIds}
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
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

function PaneNode({
    node, path, indexById, freshPaneIds, chromeState, focusedPaneId, pillHovered, onFocusPane, onHoverPane, onOpenDetails, onClosePane, onResizeSplit, renderContent,
}: PaneNodeProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    if (node.type === "split") {
        const aSkipsEntrance = cellSkipsEntrance(node.a, freshPaneIds);
        const bSkipsEntrance = cellSkipsEntrance(node.b, freshPaneIds);
        return (
            <div className={`pane-split pane-split-${node.axis}`} ref={containerRef}>
                <AnimatePresence initial={false}>
                    <motion.div
                        key={cellKey(node.a)}
                        className="pane-split-cell"
                        layout
                        initial={aSkipsEntrance ? false : { opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ flex: node.ratio }}
                    >
                        <PaneNode node={node.a} path={[...path, "a"]} indexById={indexById} freshPaneIds={freshPaneIds} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} onClosePane={onClosePane} onResizeSplit={onResizeSplit} renderContent={renderContent} />
                    </motion.div>
                    <SplitDivider
                        key="divider"
                        axis={node.axis}
                        containerRef={containerRef}
                        onResize={ratio => onResizeSplit(path, ratio)}
                    />
                    <motion.div
                        key={cellKey(node.b)}
                        className="pane-split-cell"
                        layout
                        initial={bSkipsEntrance ? false : { opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ flex: 1 - node.ratio }}
                    >
                        <PaneNode node={node.b} path={[...path, "b"]} indexById={indexById} freshPaneIds={freshPaneIds} chromeState={chromeState} focusedPaneId={focusedPaneId} pillHovered={pillHovered} onFocusPane={onFocusPane} onHoverPane={onHoverPane} onOpenDetails={onOpenDetails} onClosePane={onClosePane} onResizeSplit={onResizeSplit} renderContent={renderContent} />
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
            layoutId={pane.paneId}
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
