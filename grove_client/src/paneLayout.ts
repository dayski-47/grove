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
