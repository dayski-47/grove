import { describe, it, expect } from "vitest";
import {
    makeLeaf, countLeaves, getLeaves, findLeafById,
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
