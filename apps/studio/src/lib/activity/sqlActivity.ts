/**
 * Helpers for turning a raw query + its result into an activity entry.
 *
 * Best-effort and dependency-free: the operation and target tables are derived
 * from a light scan of the SQL text, and the row count is read from whatever
 * result shape the backend returned (NgQueryResult[] or TableResult).
 */

import { ActivityCategory, activityLog } from "./ActivityLog";

/** First SQL keyword, uppercased (SELECT, INSERT, CREATE, ...). */
export function summarizeOp(sql?: string): string | undefined {
  if (!sql) return undefined;
  const match = sql.trim().match(/^[a-zA-Z]+/);
  return match ? match[0].toUpperCase() : undefined;
}

/**
 * Best-effort extraction of referenced tables from a SQL string. Grabs the
 * identifier following FROM / JOIN / INTO / UPDATE and dedupes. Returns up to
 * three names, with an ellipsis when there are more.
 */
export function extractTables(sql?: string): string | undefined {
  if (!sql) return undefined;
  const tables: string[] = [];
  const re = /\b(?:from|join|into|update)\s+([`"[]?[\w.$]+[`"\]]?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const name = match[1].replace(/[`"[\]]/g, "");
    if (name && !tables.includes(name)) {
      tables.push(name);
    }
  }
  if (tables.length === 0) return undefined;
  const shown = tables.slice(0, 3).join(", ");
  return tables.length > 3 ? `${shown}…` : shown;
}

/** Read a row count out of the various result shapes the backend returns. */
export function rowCountOf(result: unknown): number | undefined {
  if (result == null) return undefined;

  // NgQueryResult[] - use the last statement's result.
  if (Array.isArray(result)) {
    const last = result[result.length - 1];
    if (last && typeof last === "object") {
      return rowCountOfNg(last);
    }
    return result.length;
  }

  // TableResult { result: any[], fields: [] }
  const asTable = result as { result?: unknown };
  if (Array.isArray(asTable.result)) {
    return asTable.result.length;
  }

  return rowCountOfNg(result);
}

function rowCountOfNg(r: unknown): number | undefined {
  if (!r || typeof r !== "object") return undefined;
  const ng = r as { rowCount?: number; rows?: unknown[]; affectedRows?: number };
  if (typeof ng.rowCount === "number") return ng.rowCount;
  if (Array.isArray(ng.rows)) return ng.rows.length;
  if (typeof ng.affectedRows === "number") return ng.affectedRows;
  return undefined;
}

/**
 * Record an executed SQL statement. `connection` is resolved later (in the
 * Vuex subscriber) so producers don't need store access.
 */
export function recordSqlActivity(opts: {
  category: ActivityCategory;
  sql?: string;
  op?: string;
  tables?: string;
  result?: unknown;
  durationMs?: number;
}): void {
  try {
    activityLog.emit({
      category: opts.category,
      sql: opts.sql,
      op: opts.op ?? summarizeOp(opts.sql),
      tables: opts.tables ?? extractTables(opts.sql),
      rows: rowCountOf(opts.result),
      durationMs: opts.durationMs,
    });
  } catch (_e) {
    // Logging activity must never affect query execution.
  }
}
