import { create } from "zustand";
import type { SemanticType } from "@/lib/relations";

/** A TypePicker override: an explicit semantic type, or "none" to disable formatting. */
export type SemanticOverride = SemanticType | "none";

/**
 * Per-column display config: a cell-format mode and a visibility flag.
 * Consumed by the Glide grid (cell rendering + the column list) and edited from
 * the DetailPanel's column view. Keyed by `${tabId}::${columnName}` so config is
 * scoped to a single open table tab.
 *
 * Persisted to localStorage so the choices survive reloads.
 */

export type ColumnFormat =
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "thousands";

export const FORMAT_LABELS: Record<ColumnFormat, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  percentage: "Percentage",
  thousands: "Thousands",
};

export interface ColumnConfig {
  format: ColumnFormat;
  hidden: boolean;
  /**
   * User override for the column's semantic type (TypePicker). When absent the
   * grid uses the inferred type; `"none"` disables semantic rendering entirely.
   */
  semanticType?: SemanticOverride;
}

const DEFAULT: ColumnConfig = { format: "text", hidden: false };
const STORAGE_KEY = "studio-react.columnConfig";

const key = (tabId: string, column: string) => `${tabId}::${column}`;

function load(): Record<string, ColumnConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ColumnConfig>) : {};
  } catch {
    return {};
  }
}

function persist(byKey: Record<string, ColumnConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
  } catch {
    /* ignore */
  }
}

interface ColumnConfigState {
  byKey: Record<string, ColumnConfig>;
  get: (tabId: string, column: string) => ColumnConfig;
  setFormat: (tabId: string, column: string, format: ColumnFormat) => void;
  setHidden: (tabId: string, column: string, hidden: boolean) => void;
  /** Set/clear the semantic-type override. Pass `undefined` to clear (use inferred). */
  setSemanticType: (
    tabId: string,
    column: string,
    semanticType: SemanticOverride | undefined
  ) => void;
}

export const useColumnConfigStore = create<ColumnConfigState>((set, get) => ({
  byKey: load(),
  get: (tabId, column) => get().byKey[key(tabId, column)] ?? DEFAULT,
  setFormat: (tabId, column, format) =>
    set((s) => {
      const k = key(tabId, column);
      const byKey = { ...s.byKey, [k]: { ...(s.byKey[k] ?? DEFAULT), format } };
      persist(byKey);
      return { byKey };
    }),
  setHidden: (tabId, column, hidden) =>
    set((s) => {
      const k = key(tabId, column);
      const byKey = { ...s.byKey, [k]: { ...(s.byKey[k] ?? DEFAULT), hidden } };
      persist(byKey);
      return { byKey };
    }),
  setSemanticType: (tabId, column, semanticType) =>
    set((s) => {
      const k = key(tabId, column);
      const next = { ...(s.byKey[k] ?? DEFAULT) };
      if (semanticType === undefined) delete next.semanticType;
      else next.semanticType = semanticType;
      const byKey = { ...s.byKey, [k]: next };
      persist(byKey);
      return { byKey };
    }),
}));

/** Format a numeric-ish cell value for display, given the chosen format. */
export function formatCellValue(value: number, format: ColumnFormat): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(value);
    case "percentage":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(value);
    case "thousands":
      return new Intl.NumberFormat(undefined, { useGrouping: true }).format(value);
    case "number":
      return new Intl.NumberFormat(undefined, { useGrouping: false }).format(value);
    case "text":
    default:
      return String(value);
  }
}
