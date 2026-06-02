import { create } from "zustand";
import type { ImperativePanelHandle } from "react-resizable-panels";

/**
 * App-shell layout state for the react-resizable-panels layout (App.tsx).
 *
 * Panel *sizes* are persisted by react-resizable-panels itself via the
 * PanelGroup `autoSaveId` ("studio-react.layout.*"); this store only tracks
 * collapse state + the imperative panel handles so the existing toggle buttons
 * (sidebar toggle, detail dock toggle, activity collapse) can drive a Panel
 * collapse/expand through the imperative API. Collapse intent is also persisted
 * so it survives reloads (sizes alone don't capture "user collapsed this").
 */

type PanelKey = "sidebar" | "detail" | "activity";

const COLLAPSED_KEY = (k: PanelKey) => `studio-react.layout.${k}.collapsed`;

function readCollapsed(k: PanelKey, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY(k));
    return raw == null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function writeCollapsed(k: PanelKey, v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY(k), String(v));
  } catch {
    /* ignore */
  }
}

interface LayoutState {
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  activityCollapsed: boolean;

  sidebarRef: ImperativePanelHandle | null;
  detailRef: ImperativePanelHandle | null;
  activityRef: ImperativePanelHandle | null;

  registerPanel: (key: PanelKey, ref: ImperativePanelHandle | null) => void;
  /** Synced from the Panel's onCollapse/onExpand callbacks. */
  setCollapsed: (key: PanelKey, collapsed: boolean) => void;
  /** Imperatively collapse/expand a panel (wired to the toolbar toggles). */
  toggle: (key: PanelKey) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: readCollapsed("sidebar", false),
  detailCollapsed: readCollapsed("detail", false),
  activityCollapsed: readCollapsed("activity", true),

  sidebarRef: null,
  detailRef: null,
  activityRef: null,

  registerPanel: (key, ref) => set({ [`${key}Ref`]: ref } as Partial<LayoutState>),

  setCollapsed: (key, collapsed) => {
    writeCollapsed(key, collapsed);
    set({ [`${key}Collapsed`]: collapsed } as Partial<LayoutState>);
  },

  toggle: (key) => {
    const ref = get()[`${key}Ref`];
    const collapsed = get()[`${key}Collapsed`];
    if (!ref) {
      // No panel mounted yet (e.g. detail dock before a grid view exists): just
      // flip + persist intent so the panel honors it once it mounts.
      get().setCollapsed(key, !collapsed);
      return;
    }
    if (collapsed) ref.expand();
    else ref.collapse();
  },
}));
