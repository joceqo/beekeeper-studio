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
const FAVORITES_KEY = "studio-react.sidebar.tableFavorites";

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

function readFavorites(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeFavorites(map: Record<string, boolean>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function tableFavoriteKey(connectionId: string, schema: string, table: string): string {
  return `${connectionId}::${schema}.${table}`;
}

interface SidebarState {
  activeConnectionId: string | null;
  expandedConnections: Record<string, boolean>;
  /** Collapsed explorer groups keyed by a stable group id (schema / prefix path). */
  explorerCollapsed: Record<string, boolean>;
  /** Bumped to make the Sidebar re-fetch its connection list (e.g. after a save). */
  connectionsRevision: number;
  /** Favorite tables keyed by connection + qualified table name. */
  tableFavorites: Record<string, boolean>;
  /** Connections with a live backend connection (each shows a green dot). */
  connectedIds: Set<string>;
  /** Connections currently connecting (each shows a spinner). */
  connectingIds: Set<string>;
  setActiveConnection: (id: string) => void;
  markConnected: (id: string) => void;
  markDisconnected: (id: string) => void;
  markConnecting: (id: string) => void;
  clearConnecting: (id: string) => void;
  toggleConnection: (id: string) => void;
  toggleGroup: (id: string) => void;
  /** Read whether a group is collapsed; default-open unless explicitly collapsed. */
  isCollapsed: (id: string) => boolean;
  /** Trigger a refresh of the sidebar's connection list. */
  refreshConnections: () => void;
  toggleTableFavorite: (connectionId: string, schema: string, table: string) => void;
  isTableFavorite: (connectionId: string | null, schema: string, table: string) => boolean;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  // No hardcoded connection id: the Sidebar resolves the real connection list on
  // mount and selects the first one. Works in both mock and MCP.
  activeConnectionId: null,
  expandedConnections: {},
  explorerCollapsed: readCollapsed(),
  connectionsRevision: 0,
  tableFavorites: readFavorites(),
  connectedIds: new Set(),
  connectingIds: new Set(),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
  markConnected: (id) =>
    set((s) => {
      const connectedIds = new Set(s.connectedIds).add(id);
      const connectingIds = new Set(s.connectingIds);
      connectingIds.delete(id);
      return { connectedIds, connectingIds };
    }),
  markDisconnected: (id) =>
    set((s) => {
      const connectedIds = new Set(s.connectedIds);
      connectedIds.delete(id);
      return { connectedIds };
    }),
  markConnecting: (id) => set((s) => ({ connectingIds: new Set(s.connectingIds).add(id) })),
  clearConnecting: (id) =>
    set((s) => {
      const connectingIds = new Set(s.connectingIds);
      connectingIds.delete(id);
      return { connectingIds };
    }),
  refreshConnections: () => set((s) => ({ connectionsRevision: s.connectionsRevision + 1 })),
  toggleTableFavorite: (connectionId, schema, table) =>
    set((s) => {
      const key = tableFavoriteKey(connectionId, schema, table);
      const tableFavorites = { ...s.tableFavorites };
      if (tableFavorites[key]) delete tableFavorites[key];
      else tableFavorites[key] = true;
      writeFavorites(tableFavorites);
      return { tableFavorites };
    }),
  isTableFavorite: (connectionId, schema, table) =>
    connectionId
      ? !!get().tableFavorites[tableFavoriteKey(connectionId, schema, table)]
      : false,
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
