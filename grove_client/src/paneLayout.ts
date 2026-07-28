/**
 * Pure pane-tiling logic (dwindle tree + chrome-state derivation). No React,
 * no DOM — kept this way so it can be unit tested directly (see
 * paneLayout.test.ts). AppShell.tsx is the only consumer.
 */

export type PaneKind = "channel" | "dm" | "notification" | "details";

/**
 * `channelId` is null for a pane created via split that hasn't been filled
 * yet (Ctrl+K assigns it). For "notification" panes it's always null — that
 * pane isn't scoped to one channel, it lists unreads across all channels.
 */
export interface PaneContent {
    paneId:      string;
    kind:        PaneKind;
    channelId:   number | null;
    channelName: string;
}

export type SplitAxis = "row" | "column";
export type SplitDirection = "left" | "right" | "up" | "down";

export interface LeafNode {
    type: "leaf";
    pane: PaneContent;
}

export interface SplitNode {
    type:  "split";
    axis:  SplitAxis;
    ratio: number;
    a:     PaneTreeNode;
    b:     PaneTreeNode;
}

export type PaneTreeNode = LeafNode | SplitNode;

export const MAX_PANES = 4;

export const PANE_KIND_WEIGHT: Record<PaneKind, number> = {
    channel:      1.0,
    dm:           1.0,
    notification: 0.6,
    details:      0.6,
};

function weightOf(node: PaneTreeNode): number {
    if (node.type === "leaf") return PANE_KIND_WEIGHT[node.pane.kind];
    return (weightOf(node.a) + weightOf(node.b)) / 2;
}

export function rebalance(node: PaneTreeNode): PaneTreeNode {
    if (node.type === "leaf") return node;
    const a  = rebalance(node.a);
    const b  = rebalance(node.b);
    const wa = weightOf(a);
    const wb = weightOf(b);
    return { ...node, a, b, ratio: wa / (wa + wb) };
}

export function makeLeaf(pane: PaneContent): LeafNode {
    return { type: "leaf", pane };
}

export function makeEmptyPaneContent(paneId: string): PaneContent {
    return { paneId, kind: "channel", channelId: null, channelName: "" };
}

export function countLeaves(node: PaneTreeNode | null): number {
    if (node === null) return 0;
    if (node.type === "leaf") return 1;
    return countLeaves(node.a) + countLeaves(node.b);
}

export function getLeaves(node: PaneTreeNode | null): LeafNode[] {
    if (node === null) return [];
    if (node.type === "leaf") return [node];
    return [...getLeaves(node.a), ...getLeaves(node.b)];
}

export function findLeafById(node: PaneTreeNode | null, paneId: string): LeafNode | null {
    if (node === null) return null;
    if (node.type === "leaf") return node.pane.paneId === paneId ? node : null;
    return findLeafById(node.a, paneId) ?? findLeafById(node.b, paneId);
}

function nextAxis(depth: number): SplitAxis {
    return depth % 2 === 0 ? "row" : "column";
}

function replaceLeaf(
    node: PaneTreeNode,
    targetId: string,
    depth: number,
    build: (leaf: LeafNode, depth: number) => PaneTreeNode,
): PaneTreeNode {
    if (node.type === "leaf") {
        return node.pane.paneId === targetId ? build(node, depth) : node;
    }
    return {
        ...node,
        a: replaceLeaf(node.a, targetId, depth + 1, build),
        b: replaceLeaf(node.b, targetId, depth + 1, build),
    };
}

export function splitAuto(root: PaneTreeNode, targetPaneId: string, newPane: PaneContent): PaneTreeNode {
    if (countLeaves(root) >= MAX_PANES) return root;
    if (findLeafById(root, targetPaneId) === null) return root;
    const next = replaceLeaf(root, targetPaneId, 0, (leaf, depth) => ({
        type: "split",
        axis: nextAxis(depth),
        ratio: 0.5,
        a: leaf,
        b: makeLeaf(newPane),
    }));
    return rebalance(next);
}

export function splitDirectional(
    root: PaneTreeNode,
    targetPaneId: string,
    newPane: PaneContent,
    direction: SplitDirection,
): PaneTreeNode {
    if (countLeaves(root) >= MAX_PANES) return root;
    if (findLeafById(root, targetPaneId) === null) return root;

    const axis: SplitAxis = (direction === "left" || direction === "right") ? "row" : "column";
    const newPaneFirst = direction === "left" || direction === "up";

    const next = replaceLeaf(root, targetPaneId, 0, leaf => ({
        type: "split",
        axis,
        ratio: 0.5,
        a: newPaneFirst ? makeLeaf(newPane) : leaf,
        b: newPaneFirst ? leaf : makeLeaf(newPane),
    }));
    return rebalance(next);
}

export function removePane(root: PaneTreeNode, paneId: string): PaneTreeNode | null {
    if (root.type === "leaf") {
        return root.pane.paneId === paneId ? null : root;
    }
    const a = removePane(root.a, paneId);
    const b = removePane(root.b, paneId);
    if (a === null) return b;
    if (b === null) return a;
    return rebalance({ type: "split", axis: root.axis, ratio: root.ratio, a, b });
}
