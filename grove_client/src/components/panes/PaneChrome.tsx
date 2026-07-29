import type { LeafNode } from "../../paneLayout";

export interface PaneChromeProps {
    mode:          "state1" | "state2" | "state3";
    tabs:          { id: number; name: string; kind: "channel" | "dm" }[];
    activeTabId:   number | null;
    onSelectTab:   (id: number, name: string, kind: "channel" | "dm") => void;
    onCloseTab:    (id: number) => void;
    paneLeaves:    LeafNode[];
    focusedPaneId: string | null;
    onFocusPane:   (paneId: string) => void;
    onPillHoverChange: (hovered: boolean) => void;
    totalUnread:   number;
    onLogoClick:   () => void;
    onToggleMultiPaneState: () => void;
}

export function PaneChrome({
    mode, tabs, activeTabId, onSelectTab, onCloseTab,
    paneLeaves, focusedPaneId, onFocusPane, onPillHoverChange,
    totalUnread, onLogoClick, onToggleMultiPaneState,
}: PaneChromeProps) {
    return (
        <div className={`pane-chrome pane-chrome-${mode}`} role="toolbar" aria-label="Grove navigation">
            <button className="pane-chrome-logo" onClick={onLogoClick} aria-label="Open command palette" title="Ctrl+K">
                <ChromeLeafIcon />
            </button>

            {mode === "state1" && (
                <div className="pane-chrome-tabs" role="tablist" aria-label="Open channels">
                    {tabs.length === 0 && (
                        <span className="pane-chrome-hint">Press <kbd>Ctrl K</kbd> to navigate</span>
                    )}
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            role="tab"
                            className={`pane-chrome-tab${tab.id === activeTabId ? " active" : ""}`}
                            aria-selected={tab.id === activeTabId}
                        >
                            <button className="pane-chrome-tab-main" onClick={() => onSelectTab(tab.id, tab.name, tab.kind)} title={tab.name}>
                                <span className="pane-chrome-tab-prefix">{tab.kind === "dm" ? "@" : "#"}</span>
                                <span className="pane-chrome-tab-name">{tab.name}</span>
                            </button>
                            <button className="pane-chrome-tab-close" onClick={e => { e.stopPropagation(); onCloseTab(tab.id); }} aria-label={`Close ${tab.name}`}>
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {mode === "state2" && (
                <button
                    className="pane-chrome-pill"
                    onClick={onToggleMultiPaneState}
                    onMouseEnter={() => onPillHoverChange(true)}
                    onMouseLeave={() => onPillHoverChange(false)}
                    aria-label="Expand pane labels"
                    title="Ctrl+Shift+]"
                >
                    {paneLeaves.map((leaf, i) => (
                        <span
                            key={leaf.pane.paneId}
                            className={`pane-chrome-pill-num${leaf.pane.paneId === focusedPaneId ? " active" : ""}`}
                            onMouseDown={e => { e.stopPropagation(); onFocusPane(leaf.pane.paneId); }}
                            onClick={e => e.stopPropagation()}
                        >
                            {i + 1}
                        </span>
                    ))}
                </button>
            )}

            {mode === "state3" && (
                <button className="pane-chrome-circle" onClick={onToggleMultiPaneState} aria-label="Collapse pane labels" title="Ctrl+Shift+[" />
            )}

            {totalUnread > 0 && (
                <span className="pane-chrome-unread" aria-label={`${totalUnread} unread`}>
                    {totalUnread > 99 ? "99+" : totalUnread}
                </span>
            )}
        </div>
    );
}

function ChromeLeafIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
    );
}
