import { useEffect, useRef } from "react";

export interface PaneKeybindActions {
    isPaneModeActive:    () => boolean;
    getFocusedPaneId:    () => string | null;
    getHoveredPaneId:    () => string | null;
    onCreateSplit:       () => void;
    onDirectionalSplit:  (direction: "left" | "right" | "up" | "down") => void;
    onCollapseChrome:    () => void;
    onExpandChrome:      () => void;
    onToggleIsland:      () => void;
    onClosePane:         (paneId: string) => void;
    onSwitchToPaneIndex: (index: number) => void;
}

const ARROW_DIRECTION: Record<string, "left" | "right" | "up" | "down"> = {
    ArrowLeft:  "left",
    ArrowRight: "right",
    ArrowUp:    "up",
    ArrowDown:  "down",
};

/**
 * Registers the pane-tiling keybinds (Ctrl+Shift+Enter, Ctrl+Shift+<Arrow>,
 * Ctrl+Shift+[ / ], Ctrl+Shift+Space, Ctrl+Shift+W, Ctrl+1-8) once, for the
 * lifetime of the component. `actions` is read through a ref so this never
 * needs to re-register the listener — same convention as the paletteModeRef
 * effect in AppShell.tsx.
 */
export function usePaneKeybinds(actions: PaneKeybindActions): void {
    const actionsRef = useRef(actions);
    // eslint-disable-next-line react-hooks/refs
    actionsRef.current = actions;

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const a = actionsRef.current;

            if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
                e.preventDefault();
                a.onCreateSplit();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key in ARROW_DIRECTION) {
                e.preventDefault();
                a.onDirectionalSplit(ARROW_DIRECTION[e.key]);
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key === "[") {
                e.preventDefault();
                a.onCollapseChrome();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key === "]") {
                e.preventDefault();
                a.onExpandChrome();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.code === "Space") {
                e.preventDefault();
                a.onToggleIsland();
                return;
            }

            if (!a.isPaneModeActive()) return;

            // Plain Ctrl+W is a browser-reserved close-tab shortcut that
            // preventDefault() cannot reliably override (Firefox especially
            // ignores it outright) — Ctrl+Shift+W avoids the collision.
            if (e.ctrlKey && e.shiftKey && e.key === "W") {
                const targetId = a.getHoveredPaneId() ?? a.getFocusedPaneId();
                if (targetId === null) return;
                e.preventDefault();
                a.onClosePane(targetId);
                return;
            }

            const n = parseInt(e.key, 10);
            if (e.ctrlKey && !e.shiftKey && !e.altKey && n >= 1 && n <= 8) {
                e.preventDefault();
                a.onSwitchToPaneIndex(n - 1);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []); // safe — reads only actionsRef; every action is looked up fresh on each keypress
}
