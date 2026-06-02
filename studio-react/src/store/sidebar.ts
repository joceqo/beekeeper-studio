import { create } from "zustand";

interface SidebarState {
  collapsed: boolean;
  width: number;
  activeConnectionId: string | null;
  expandedConnections: Record<string, boolean>;
  toggle: () => void;
  setWidth: (w: number) => void;
  setActiveConnection: (id: string) => void;
  toggleConnection: (id: string) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  width: 248,
  // No hardcoded connection id: the Sidebar resolves the real connection list on
  // mount and selects the first one. Works in both mock and MCP.
  activeConnectionId: null,
  expandedConnections: {},
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setWidth: (w) => set({ width: Math.max(180, Math.min(440, w)) }),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
  toggleConnection: (id) =>
    set((s) => ({
      expandedConnections: {
        ...s.expandedConnections,
        [id]: !s.expandedConnections[id],
      },
    })),
}));
