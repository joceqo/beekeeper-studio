import { create } from "zustand";
import type { CellValue } from "@/ipc";
import { ident, sqlLiteral } from "@/lib/filters";

/**
 * Optimistic staged-edit store backing the editable ROW detail panel + the
 * preview→commit write flow (SlashTable's `preview_changes_sql` /
 * `commit_changes` pattern).
 *
 * Edits are NOT written immediately. Each cell edit is staged here keyed by
 * `${tabId}::${pkValue}::${column}` so the panel can show a dirty indicator,
 * revert individual edits, and — on commit — compile a single UPDATE per row,
 * preview the SQL in a confirm dialog, then run it on a WRITE connection.
 *
 * The store holds enough context (schema/table/pk) to build a safely-quoted
 * `UPDATE "schema"."table" SET "col"=<lit> WHERE "<pk>"=<lit>` without touching
 * the grid: identifier quoting + literal escaping reuse lib/filters.ts.
 */

export interface PendingEdit {
  tabId: string;
  schema: string;
  table: string;
  /** The PK column used to target the row in the WHERE clause. */
  pkColumn: string;
  /** The PK value of the edited row. */
  pkValue: CellValue;
  /** The column being edited. */
  column: string;
  /** The original cell value, for revert + the diff display. */
  originalValue: CellValue;
  /** The staged new value. */
  newValue: CellValue;
}

/** Stable key for a single staged cell edit. */
export function editKey(tabId: string, pkValue: CellValue, column: string): string {
  return `${tabId}::${String(pkValue)}::${column}`;
}

/** A row-grouped change: one UPDATE statement targeting one row. */
export interface RowChange {
  schema: string;
  table: string;
  pkColumn: string;
  pkValue: CellValue;
  /** column -> staged new value */
  set: Record<string, CellValue>;
  /** The contributing staged edits (for keying / revert). */
  edits: PendingEdit[];
}

interface PendingEditsState {
  /** All staged edits keyed by {@link editKey}. */
  byKey: Record<string, PendingEdit>;
  /** Stage (or update) a single cell edit. A no-op edit (new === original) is dropped. */
  stage: (edit: PendingEdit) => void;
  /** Drop a single staged edit (revert). */
  revert: (tabId: string, pkValue: CellValue, column: string) => void;
  /** Drop every staged edit for a tab. */
  revertTab: (tabId: string) => void;
  /** Drop a specific set of staged edits (used after a successful commit). */
  clearKeys: (keys: string[]) => void;
  /** Look up a single staged edit, if any. */
  get: (tabId: string, pkValue: CellValue, column: string) => PendingEdit | undefined;
  /** Count of staged edits for a tab. */
  countForTab: (tabId: string) => number;
  /** All staged edits for a tab. */
  editsForTab: (tabId: string) => PendingEdit[];
}

export const usePendingEditsStore = create<PendingEditsState>((set, get) => ({
  byKey: {},

  stage: (edit) =>
    set((s) => {
      const k = editKey(edit.tabId, edit.pkValue, edit.column);
      // Reverting to the original value cancels the edit entirely.
      if (sameValue(edit.newValue, edit.originalValue)) {
        if (!s.byKey[k]) return s;
        const next = { ...s.byKey };
        delete next[k];
        return { byKey: next };
      }
      return { byKey: { ...s.byKey, [k]: edit } };
    }),

  revert: (tabId, pkValue, column) =>
    set((s) => {
      const k = editKey(tabId, pkValue, column);
      if (!s.byKey[k]) return s;
      const next = { ...s.byKey };
      delete next[k];
      return { byKey: next };
    }),

  revertTab: (tabId) =>
    set((s) => {
      const next: Record<string, PendingEdit> = {};
      for (const [k, e] of Object.entries(s.byKey)) {
        if (e.tabId !== tabId) next[k] = e;
      }
      return { byKey: next };
    }),

  clearKeys: (keys) =>
    set((s) => {
      if (keys.length === 0) return s;
      const drop = new Set(keys);
      const next: Record<string, PendingEdit> = {};
      for (const [k, e] of Object.entries(s.byKey)) {
        if (!drop.has(k)) next[k] = e;
      }
      return { byKey: next };
    }),

  get: (tabId, pkValue, column) => get().byKey[editKey(tabId, pkValue, column)],

  countForTab: (tabId) =>
    Object.values(get().byKey).filter((e) => e.tabId === tabId).length,

  editsForTab: (tabId) =>
    Object.values(get().byKey).filter((e) => e.tabId === tabId),
}));

/** Strict-ish equality for CellValues (treats undefined as null). */
function sameValue(a: CellValue, b: CellValue): boolean {
  const an = a === undefined ? null : a;
  const bn = b === undefined ? null : b;
  return an === bn;
}

/** Group a tab's staged edits into one {@link RowChange} per edited row. */
export function groupRowChanges(edits: PendingEdit[]): RowChange[] {
  const byRow = new Map<string, RowChange>();
  for (const e of edits) {
    const rowKey = `${e.schema}.${e.table}#${String(e.pkValue)}`;
    let rc = byRow.get(rowKey);
    if (!rc) {
      rc = {
        schema: e.schema,
        table: e.table,
        pkColumn: e.pkColumn,
        pkValue: e.pkValue,
        set: {},
        edits: [],
      };
      byRow.set(rowKey, rc);
    }
    rc.set[e.column] = e.newValue;
    rc.edits.push(e);
  }
  return [...byRow.values()];
}

/**
 * Compile one row change to a single, safely-quoted UPDATE statement:
 * `UPDATE "schema"."table" SET "col"=<lit>, ... WHERE "pk"=<lit>`.
 * Identifier quoting + literal escaping reuse lib/filters.ts.
 */
export function rowChangeSql(rc: RowChange): string {
  const qualified = rc.schema
    ? `${ident(rc.schema)}.${ident(rc.table)}`
    : ident(rc.table);
  const assignments = Object.entries(rc.set)
    .map(([col, val]) => `${ident(col)} = ${sqlLiteral(val)}`)
    .join(", ");
  return `UPDATE ${qualified} SET ${assignments} WHERE ${ident(rc.pkColumn)} = ${sqlLiteral(rc.pkValue)};`;
}

/** Compile a set of staged edits to the full preview SQL (one UPDATE per row). */
export function compilePreviewSql(edits: PendingEdit[]): string {
  return groupRowChanges(edits).map(rowChangeSql).join("\n");
}
