import { describe, it, expect } from "vitest";
import {
    makeLeaf, countLeaves, getLeaves, findLeafById, rebalance,
    type PaneContent, type PaneTreeNode, type SplitNode,
} from "./paneLayout";

function pane(paneId: string, channelId: number | null = 1): PaneContent {
    return { paneId, kind: "channel", channelId, channelName: `chan-${channelId}` };
}

function split(a: PaneTreeNode, b: PaneTreeNode): SplitNode {
    return { type: "split", axis: "row", ratio: 0.5, a, b };
}

describe("countLeaves", () => {
    it("returns 0 for a null tree", () => {
        expect(countLeaves(null)).toBe(0);
    });

    it("returns 1 for a single leaf", () => {
        expect(countLeaves(makeLeaf(pane("p1")))).toBe(1);
    });

    it("counts leaves across nested splits", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(countLeaves(tree)).toBe(3);
    });
});

describe("getLeaves", () => {
    it("returns leaves in left-to-right, depth-first order", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(getLeaves(tree).map(l => l.pane.paneId)).toEqual(["p1", "p2", "p3"]);
    });

    it("returns an empty array for a null tree", () => {
        expect(getLeaves(null)).toEqual([]);
    });
});

describe("findLeafById", () => {
    it("finds a leaf anywhere in the tree", () => {
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(pane("p3"))));
        expect(findLeafById(tree, "p3")?.pane.paneId).toBe("p3");
    });

    it("returns null when the id is not present", () => {
        const tree = makeLeaf(pane("p1"));
        expect(findLeafById(tree, "nope")).toBeNull();
    });

    it("returns null for a null tree", () => {
        expect(findLeafById(null, "p1")).toBeNull();
    });
});

describe("rebalance", () => {
    it("leaves a single leaf untouched", () => {
        const leaf = makeLeaf(pane("p1"));
        expect(rebalance(leaf)).toEqual(leaf);
    });

    it("gives equal-weight kinds a 0.5 ratio", () => {
        const tree = split(makeLeaf(pane("p1")), makeLeaf(pane("p2"))) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        expect(result.ratio).toBeCloseTo(0.5);
    });

    it("weights a channel pane heavier than a notification pane", () => {
        const notifPane: PaneContent = { paneId: "p2", kind: "notification", channelId: null, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), makeLeaf(notifPane)) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        // channel weight 1.0, notification weight 0.6 -> 1.0 / (1.0 + 0.6) = 0.625
        expect(result.ratio).toBeCloseTo(0.625, 3);
    });

    it("weights a details pane the same as a notification pane", () => {
        const detailsPane: PaneContent = { paneId: "p2", kind: "details", channelId: 1, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), makeLeaf(detailsPane)) as SplitNode;
        const result = rebalance(tree) as SplitNode;
        expect(result.ratio).toBeCloseTo(0.625, 3);
    });

    it("recurses into nested splits", () => {
        const notifPane: PaneContent = { paneId: "p3", kind: "notification", channelId: null, channelName: "" };
        const tree = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2")), makeLeaf(notifPane)));
        const result = rebalance(tree) as SplitNode;
        const inner = result.b as SplitNode;
        expect(inner.ratio).toBeCloseTo(0.625, 3);
    });
});
