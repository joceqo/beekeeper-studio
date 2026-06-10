import { create } from "zustand";
import type { CellValue, ColumnDef } from "@/ipc";

/**
 * Per-column "fill rate" (data completeness) used to draw the 3-bar signal glyph
 * in the grid header. Two ranked sources feed it (see useColumnFill):
 *
 *  1. `sample`  — a one-shot TABLESAMPLE aggregate over the whole table (Postgres),
 *                 counting non-null & non-empty values. Whole-table estimate.
 *  2. progressive — counts accumulated from the rows already loaded by the page
 *                 SELECT *, growing as the user pages/scrolls. Universal fallback
 *                 (MySQL/SQLite/views), DB-agnostic, costs no extra query.
 *
 * A "filled" cell is non-null AND not the empty string '' (consistent with the
 * NULL vs '' distinction in the row detail). `sample` overrides progressive when
 * present, since it reflects the whole table rather than just loaded rows.
 */

/** A cell counts as filled when it is neither NULL/undefined nor an empty string. */
export function isFilled(v: CellValue): boolean {
  return v !== null && v !== undefined && v !== "";
}

export interface ColCount {
  filled: number;
  seen: number;
}

/** Resolved per-column completeness, ready for the header glyph / detail panel. */
export interface FillInfo {
  /** Filled fraction, 0..1. */
  ratio: number;
  filled: number;
  /** Rows observed (progressive) or sampled (sample). */
  seen: number;
  /** Whole-table row estimate, when known. */
  total: number | null;
  basis: "sample" | "progressive";
}

interface TableEntry {
  /** Progressive counts per column name. */
  cols: Record<string, ColCount>;
  /** Page signatures already counted, so revisiting a page never double-counts. */
  pages: Set<string>;
  /** PK values already counted, deduping the same row seen across pages. */
  pks: Set<string>;
  /** Whole-table row estimate (from the page's totalRows). */
  total: number | null;
  /** Whole-table sample result (overrides progressive when set). */
  sample?: { cols: Record<string, number>; n: number };
  /** True once a sample has been attempted (success or not), so it runs once. */
  sampleTried: boolean;
}

function freshEntry(): TableEntry {
  return { cols: {}, pages: new Set(), pks: new Set(), total: null, sampleTried: false };
}

interface FillState {
  byTable: Record<string, TableEntry>;
  /** Fold a freshly-loaded page into the progressive counts (dedup-safe). */
  accumulate: (
    key: string,
    columns: ColumnDef[],
    rows: CellValue[][],
    pageSig: string,
    pkIndex: number,
    total: number | null
  ) => void;
  /** Record a whole-table sample result. */
  setSample: (key: string, cols: Record<string, number>, n: number, total: number | null) => void;
  /** Mark that a sample has been attempted (so it isn't retried every render). */
  markSampleTried: (key: string) => void;
}

export const useFillStatsStore = create<FillState>((set) => ({
  byTable: {},

  accumulate: (key, columns, rows, pageSig, pkIndex, total) =>
    set((s) => {
      const prev = s.byTable[key] ?? freshEntry();
      // This exact page was already counted — nothing to do (no re-render).
      if (prev.pages.has(pageSig)) return {};
      const pages = new Set(prev.pages).add(pageSig);
      const pks = new Set(prev.pks);
      const cols: Record<string, ColCount> = { ...prev.cols };
      for (const row of rows) {
        // Dedupe individual rows by PK when one exists (same row can reappear on
        // a re-sorted page); without a PK the page-signature guard suffices.
        if (pkIndex >= 0) {
          const pk = row[pkIndex];
          if (pk !== null && pk !== undefined) {
            const id = String(pk);
            if (pks.has(id)) continue;
            pks.add(id);
          }
        }
        columns.forEach((c, i) => {
          const cur = cols[c.name] ?? { filled: 0, seen: 0 };
          cols[c.name] = {
            filled: cur.filled + (isFilled(row[i]) ? 1 : 0),
            seen: cur.seen + 1,
          };
        });
      }
      return {
        byTable: {
          ...s.byTable,
          [key]: { ...prev, cols, pages, pks, total: total ?? prev.total },
        },
      };
    }),

  setSample: (key, cols, n, total) =>
    set((s) => {
      const prev = s.byTable[key] ?? freshEntry();
      return {
        byTable: {
          ...s.byTable,
          [key]: { ...prev, sample: { cols, n }, sampleTried: true, total: total ?? prev.total },
        },
      };
    }),

  markSampleTried: (key) =>
    set((s) => {
      const prev = s.byTable[key] ?? freshEntry();
      if (prev.sampleTried) return {};
      return { byTable: { ...s.byTable, [key]: { ...prev, sampleTried: true } } };
    }),
}));

/** Resolve the best available completeness for one column (sample > progressive). */
export function fillInfoFor(entry: TableEntry | undefined, column: string): FillInfo | null {
  if (!entry) return null;
  if (entry.sample && entry.sample.n > 0) {
    const filled = entry.sample.cols[column] ?? 0;
    return {
      ratio: filled / entry.sample.n,
      filled,
      seen: entry.sample.n,
      total: entry.total,
      basis: "sample",
    };
  }
  const c = entry.cols[column];
  if (c && c.seen > 0) {
    return { ratio: c.filled / c.seen, filled: c.filled, seen: c.seen, total: entry.total, basis: "progressive" };
  }
  return null;
}

/** Bucket a 0..1 ratio into lit-bar count: 0 → 0, (0,⅓] → 1, (⅓,⅔] → 2, (⅔,1] → 3. */
export function fillBars(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio <= 0) return 0;
  if (ratio <= 1 / 3) return 1;
  if (ratio <= 2 / 3) return 2;
  return 3;
}
