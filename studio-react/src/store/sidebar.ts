import { create } from "zustand";

/**
 * Sidebar selection + explorer collapse state.
 *
 * Panel width/collapse for the whole sidebar now lives in the resizable-panels
 * layout (see store/layout.ts), so this store only tracks which connection is
 * active, which connections/folders are expanded, and which explorer groups
 * (schema folders + prefix sub-folders) are collapsed. Explorer collapse state
 * is persisted so the user's tree shape survives reloads.
 */

const EXPLORER_KEY = "studio-react.explorer.collapsed";

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPLORER_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsed(map: Record<string, boolean>) {
  try {
    localStorage.setItem(EXPLORER_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

interface SidebarState {
  activeConnectionId: string | null;
  expandedConnections: Record<string, boolean>;
  /** Collapsed explorer groups keyed by a stable group id (schema / prefix path). */
  explorerCollapsed: Record<string, boolean>;
  setActiveConnection: (id: string) => void;
  toggleConnection: (id: string) => void;
  toggleGroup: (id: string) => void;
  /** Read whether a group is collapsed; default-open unless explicitly collapsed. */
  isCollapsed: (id: string) => boolean;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  // No hardcoded connection id: the Sidebar resolves the real connection list on
  // mount and selects the first one. Works in both mock and MCP.
  activeConnectionId: null,
  expandedConnections: {},
  explorerCollapsed: readCollapsed(),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
  toggleConnection: (id) =>
    set((s) => ({
      expandedConnections: {
        ...s.expandedConnections,
        [id]: !s.expandedConnections[id],
      },
    })),
  toggleGroup: (id) =>
    set((s) => {
      const explorerCollapsed = { ...s.explorerCollapsed, [id]: !s.explorerCollapsed[id] };
      writeCollapsed(explorerCollapsed);
      return { explorerCollapsed };
    }),
  isCollapsed: (id) => !!get().explorerCollapsed[id],
}));
