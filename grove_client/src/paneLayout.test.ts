import { describe, it, expect } from "vitest";
import {
    makeLeaf, countLeaves, getLeaves, findLeafById, rebalance, splitAuto, splitDirectional, removePane,
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

describe("splitAuto", () => {
    it("splits a single leaf into a 2-leaf tree", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitAuto(root, "p1", pane("p2", 2)) as SplitNode;
        expect(result.type).toBe("split");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("alternates split axis with each additional split", () => {
        const root = makeLeaf(pane("p1"));
        const afterFirst = splitAuto(root, "p1", pane("p2", 2)) as SplitNode;
        expect(afterFirst.axis).toBe("row");

        const afterSecond = splitAuto(afterFirst, "p2", pane("p3", 3));
        const secondSplit = findSplitContaining(afterSecond, "p2");
        expect(secondSplit?.axis).toBe("column");
    });

    it("is a no-op once at MAX_PANES", () => {
        let root: PaneTreeNode = makeLeaf(pane("p1"));
        root = splitAuto(root, "p1", pane("p2", 2));
        root = splitAuto(root, "p2", pane("p3", 3));
        root = splitAuto(root, "p3", pane("p4", 4));
        expect(countLeaves(root)).toBe(4);
        const attempt = splitAuto(root, "p4", pane("p5", 5));
        expect(attempt).toBe(root);
        expect(countLeaves(attempt)).toBe(4);
    });

    it("is a no-op when the target id does not exist", () => {
        const root = makeLeaf(pane("p1"));
        const attempt = splitAuto(root, "missing", pane("p2", 2));
        expect(attempt).toBe(root);
    });
});

function findSplitContaining(node: PaneTreeNode, paneId: string): SplitNode | null {
    if (node.type === "leaf") return null;
    if (findLeafById(node, paneId) === null) return null;
    if (findLeafById(node.a, paneId) !== null && node.a.type === "leaf") return node;
    if (findLeafById(node.b, paneId) !== null && node.b.type === "leaf") return node;
    return findSplitContaining(node.a, paneId) ?? findSplitContaining(node.b, paneId);
}

describe("splitDirectional", () => {
    it("places the new pane to the left (row axis, new pane first)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "left") as SplitNode;
        expect(result.axis).toBe("row");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p2", "p1"]);
    });

    it("places the new pane to the right (row axis, new pane second)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "right") as SplitNode;
        expect(result.axis).toBe("row");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("places the new pane above (column axis, new pane first)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "up") as SplitNode;
        expect(result.axis).toBe("column");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p2", "p1"]);
    });

    it("places the new pane below (column axis, new pane second)", () => {
        const root = makeLeaf(pane("p1"));
        const result = splitDirectional(root, "p1", pane("p2", 2), "down") as SplitNode;
        expect(result.axis).toBe("column");
        expect(getLeaves(result).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });

    it("is a no-op once at MAX_PANES", () => {
        let root: PaneTreeNode = makeLeaf(pane("p1"));
        root = splitAuto(root, "p1", pane("p2", 2));
        root = splitAuto(root, "p2", pane("p3", 3));
        root = splitAuto(root, "p3", pane("p4", 4));
        const attempt = splitDirectional(root, "p4", pane("p5", 5), "right");
        expect(attempt).toBe(root);
    });
});

describe("removePane", () => {
    it("returns null when removing the only leaf", () => {
        const root = makeLeaf(pane("p1"));
        expect(removePane(root, "p1")).toBeNull();
    });

    it("collapses a 2-leaf split down to the surviving leaf", () => {
        const root = split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2)));
        const result = removePane(root, "p1");
        expect(result?.type).toBe("leaf");
        expect((result as { type: "leaf"; pane: PaneContent } | null)?.pane.paneId).toBe("p2");
    });

    it("collapses a nested split, keeping the rest of the tree", () => {
        const root = split(makeLeaf(pane("p1")), split(makeLeaf(pane("p2", 2)), makeLeaf(pane("p3", 3))));
        const result = removePane(root, "p2");
        expect(countLeaves(result)).toBe(2);
        expect(getLeaves(result!).map(l => l.pane.paneId)).toEqual(["p1", "p3"]);
    });

    it("leaves the tree unchanged when the id is not found", () => {
        const root = split(makeLeaf(pane("p1")), makeLeaf(pane("p2", 2)));
        const result = removePane(root, "missing");
        expect(getLeaves(result!).map(l => l.pane.paneId)).toEqual(["p1", "p2"]);
    });
});
