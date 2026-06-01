import { create } from "zustand";

/**
 * Tracks the active grid selection so the right-hand DetailPanel can render
 * either a row detail (a row is selected) or a column detail (a header is
 * focused). Updated from the Glide grid's onSelectionChange / header click.
 *
 * Keyed by tab id so switching tabs doesn't bleed one table's selection into
 * another. The DetailPanel reads the entry for the active tab.
 */

export type DetailMode = "row" | "column" | null;

export interface TabSelection {
  /** index into the current page's `rows`, or null */
  rowIndex: number | null;
  /** selected column name (header focus), or null */
  columnName: string | null;
  /** which view the panel should show; "row" wins when both are set */
  mode: DetailMode;
}

const EMPTY: TabSelection = { rowIndex: null, columnName: null, mode: null };

interface SelectionState {
  byTab: Record<string, TabSelection>;
  get: (tabId: string) => TabSelection;
  selectRow: (tabId: string, rowIndex: number | null) => void;
  selectColumn: (tabId: string, columnName: string | null) => void;
  clear: (tabId: string) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  byTab: {},
  get: (tabId) => get().byTab[tabId] ?? EMPTY,
  selectRow: (tabId, rowIndex) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: {
          rowIndex,
          columnName: s.byTab[tabId]?.columnName ?? null,
          mode: rowIndex == null ? (s.byTab[tabId]?.columnName != null ? "column" : null) : "row",
        },
      },
    })),
  selectColumn: (tabId, columnName) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: {
          rowIndex: s.byTab[tabId]?.rowIndex ?? null,
          columnName,
          // A header click focuses the column; show column detail.
          mode: columnName == null ? null : "column",
        },
      },
    })),
  clear: (tabId) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: EMPTY } })),
}));
