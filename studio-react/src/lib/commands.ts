import { useCallback, useMemo } from "react";
import {
  Command,
  Database,
  FileCode,
  FolderTree,
  Workflow,
  X,
  ChevronRight,
  ChevronLeft,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Settings,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  RefreshCw,
  Filter,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { useLayoutStore } from "@/store/layout";
import { useSidebarStore } from "@/store/sidebar";
import { useUiScaleStore } from "@/store/uiScale";
import { useUiStore } from "@/store/ui";
import { backend } from "@/ipc";
import { notify } from "@/ui";
import { primaryShortcut } from "./keymap";

export type CommandGroup = "Navigate" | "Tabs" | "View" | "Connection" | "Table" | "App";

export interface CommandDef {
  id: string;
  label: string;
  group: CommandGroup;
  icon?: LucideIcon;
  run: () => void;
  /** Display shortcut, resolved from DEFAULT_KEYMAP. */
  shortcut?: string;
  /** When false, the command is hidden/disabled in the current context. */
  enabled?: boolean;
}

/** The active connection id, preferring the sidebar selection then the tab. */
function activeConnectionId(): string | null {
  const sidebar = useSidebarStore.getState().activeConnectionId;
  if (sidebar) return sidebar;
  const tabs = useTabsStore.getState();
  const tab = tabs.tabs.find((t) => t.id === tabs.activeId);
  return tab?.connectionId ?? null;
}

/**
 * Build the command list + a `run(id)` dispatcher, wired to the real stores and
 * backend. Recomputed when the active tab changes so context-sensitive commands
 * (close tab, add filter) reflect the current state. This is the single source
 * of truth shared by the palette UI and the global keybindings.
 */
export function useCommands(): { commands: CommandDef[]; run: (id: string) => void } {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTableTab = activeTab?.kind === "table";

  const commands = useMemo<CommandDef[]>(() => {
    const ts = useTabsStore.getState;
    const ls = useLayoutStore.getState;
    const us = useUiStore.getState;
    const zs = useUiScaleStore.getState;

    const list: CommandDef[] = [
      // --- Navigate ---
      {
        id: "core.palette",
        label: "Command Palette",
        group: "Navigate",
        icon: Command,
        run: () => us().setPaletteOpen(true),
      },
      {
        id: "core.db-switcher",
        label: "Switch Connection",
        group: "Connection",
        icon: Database,
        run: () => us().setDbSwitcherOpen(true),
      },
      {
        id: "core.focus-explorer-search",
        label: "Focus Explorer Search",
        group: "Navigate",
        icon: Search,
        run: () => {
          // Ensure the sidebar is visible, then signal it to focus its input.
          if (ls().sidebarCollapsed) ls().toggle("sidebar");
          us().requestFocusSearch();
        },
      },

      // --- Tabs ---
      {
        id: "core.new-sql-tab",
        label: "New SQL Tab",
        group: "Tabs",
        icon: FileCode,
        run: () => ts().openQuery(),
      },
      {
        id: "core.new-explorer-tab",
        label: "New Explorer Tab",
        group: "Tabs",
        icon: FolderTree,
        run: () => {
          // The sidebar IS the explorer; opening this command reveals it and
          // focuses its search so the user can pick a table.
          if (ls().sidebarCollapsed) ls().toggle("sidebar");
          us().requestFocusSearch();
        },
      },
      {
        id: "core.schema-graph",
        label: "Open Schema Graph",
        group: "Tabs",
        icon: Workflow,
        run: () => {
          const conn = activeConnectionId();
          if (!conn) {
            notify.info("No active connection");
            return;
          }
          // From a table tab, open the graph focused on that table (depth 1);
          // otherwise open the whole-schema graph.
          const active = ts().tabs.find((t) => t.id === ts().activeId);
          if (active?.kind === "table" && active.table) {
            ts().openGraph(conn, active.schema, active.table, active.schema);
          } else {
            ts().openGraph(conn);
          }
        },
      },
      {
        id: "core.close-tab",
        label: "Close Tab",
        group: "Tabs",
        icon: X,
        enabled: !!activeId,
        run: () => {
          const id = ts().activeId;
          if (id) ts().close(id);
        },
      },
      {
        id: "core.next-tab",
        label: "Next Tab",
        group: "Tabs",
        icon: ChevronRight,
        run: () => {
          const s = ts();
          const i = s.tabs.findIndex((t) => t.id === s.activeId);
          if (i < 0 || s.tabs.length < 2) return;
          s.setActive(s.tabs[(i + 1) % s.tabs.length].id);
        },
      },
      {
        id: "core.prev-tab",
        label: "Previous Tab",
        group: "Tabs",
        icon: ChevronLeft,
        run: () => {
          const s = ts();
          const i = s.tabs.findIndex((t) => t.id === s.activeId);
          if (i < 0 || s.tabs.length < 2) return;
          s.setActive(s.tabs[(i - 1 + s.tabs.length) % s.tabs.length].id);
        },
      },

      // --- View ---
      {
        id: "core.toggle-sidebar",
        label: "Toggle Sidebar",
        group: "View",
        icon: PanelLeft,
        run: () => ls().toggle("sidebar"),
      },
      {
        id: "core.toggle-context-sidebar",
        label: "Toggle Detail Panel",
        group: "View",
        icon: PanelRight,
        run: () => ls().toggle("detail"),
      },
      {
        id: "core.toggle-log-panel",
        label: "Toggle Activity Log",
        group: "View",
        icon: PanelBottom,
        run: () => ls().toggle("activity"),
      },
      {
        id: "core.zoom-in",
        label: "Zoom In",
        group: "View",
        icon: ZoomIn,
        run: () => zs().zoomIn(),
      },
      {
        id: "core.zoom-out",
        label: "Zoom Out",
        group: "View",
        icon: ZoomOut,
        run: () => zs().zoomOut(),
      },
      {
        id: "core.zoom-reset",
        label: "Reset Zoom",
        group: "View",
        icon: RotateCcw,
        run: () => zs().reset(),
      },

      // --- Connection ---
      {
        id: "core.reconnect",
        label: "Reconnect",
        group: "Connection",
        icon: RefreshCw,
        run: () => {
          const conn = activeConnectionId();
          if (!conn) {
            notify.info("No active connection");
            return;
          }
          void backend
            .connect(conn)
            .then(() => notify.success("Reconnected"))
            .catch(() => notify.error("Reconnect failed"));
        },
      },

      // --- Table ---
      {
        id: "table.add-filter",
        label: "Add Filter",
        group: "Table",
        icon: Filter,
        enabled: isTableTab,
        run: () => {
          if (ts().tabs.find((t) => t.id === ts().activeId)?.kind !== "table") {
            notify.info("Open a table tab to filter");
            return;
          }
          us().requestOpenFilter();
        },
      },

      // --- App ---
      {
        id: "core.open-settings",
        label: "Settings",
        group: "App",
        icon: Settings,
        run: () => us().setSettingsOpen(true),
      },
    ];

    return list.map((c) => ({ ...c, shortcut: primaryShortcut(c.id) }));
  }, [activeId, isTableTab]);

  const run = useCallback(
    (id: string) => {
      const cmd = commands.find((c) => c.id === id);
      if (!cmd) return;
      if (cmd.enabled === false) return;
      cmd.run();
    },
    [commands]
  );

  return { commands, run };
}
