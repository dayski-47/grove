import { describe, it, expect } from "vitest";
import { PANE_LAYOUT_MODULE_LOADED } from "./paneLayout";

describe("paneLayout module", () => {
    it("loads", () => {
        expect(PANE_LAYOUT_MODULE_LOADED).toBe(true);
    });
});
