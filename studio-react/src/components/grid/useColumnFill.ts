import { useEffect, useMemo } from "react";
import { backend, type CellValue, type ColumnDef } from "@/ipc";
import { useFillStatsStore, fillInfoFor, type FillInfo } from "@/store/fillStats";

/** Quote a SQL identifier for the Postgres sample query. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Whole-table completeness via one TABLESAMPLE aggregate (Postgres / standard
 * SQL). Counts non-null & non-empty values over a ~5% page sample, so it's far
 * cheaper than a full scan while still describing the whole table. Other engines
 * (MySQL/SQLite) and non-table relations (views) error here and fall back to the
 * progressive counts.
 */
function buildSampleSql(schema: string, table: string, columns: ColumnDef[]): string {
  const counts = columns.map(
    (c, i) => `count(nullif((${quoteIdent(c.name)})::text, '')) AS f${i}`
  );
  return (
    `SELECT count(*) AS n, ${counts.join(", ")} ` +
    `FROM ${quoteIdent(schema)}.${quoteIdent(table)} TABLESAMPLE SYSTEM (5)`
  );
}

interface Params {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnDef[];
  rows: CellValue[][];
  totalRows: number | null;
  /** Index of the PK column in `columns`, or -1. Dedupes rows across pages. */
  pkIndex: number;
  /** Stable signature of the current page (offset/sort), so each page counts once. */
  pageSig: string;
  /** Only accumulate when no filter is active, so the sample stays unbiased. */
  active: boolean;
}

/**
 * Returns per-column completeness keyed by column name. The result reacts to the
 * progressive accumulation (grows as pages load) and to the one-shot whole-table
 * sample (which, when it succeeds, overrides the progressive estimate).
 */
export function useColumnFill({
  connectionId,
  schema,
  table,
  columns,
  rows,
  totalRows,
  pkIndex,
  pageSig,
  active,
}: Params): Map<string, FillInfo> {
  const key = `${connectionId}::${schema}.${table}`;
  const entry = useFillStatsStore((s) => s.byTable[key]);
  const accumulate = useFillStatsStore((s) => s.accumulate);
  const setSample = useFillStatsStore((s) => s.setSample);
  const markSampleTried = useFillStatsStore((s) => s.markSampleTried);

  // Progressive: fold each freshly-loaded, unfiltered page into the counts.
  useEffect(() => {
    if (!active || columns.length === 0 || rows.length === 0) return;
    accumulate(key, columns, rows, pageSig, pkIndex, totalRows);
  }, [key, pageSig, active, columns, rows, pkIndex, totalRows, accumulate]);

  // Sample: attempt one whole-table TABLESAMPLE aggregate per table (Postgres
  // only; degrades to progressive on any error — wrong engine, a view, perms).
  useEffect(() => {
    if (columns.length === 0) return;
    if (useFillStatsStore.getState().byTable[key]?.sampleTried) return;
    markSampleTried(key);
    let cancelled = false;
    (async () => {
      try {
        const cfg = await backend.getConnectionConfig(connectionId);
        if ((cfg?.connectionType ?? "").toLowerCase() !== "postgres") return;
        const liveId = await backend.connect(connectionId);
        const res = await backend.executeQuery(liveId, buildSampleSql(schema, table, columns));
        const row = res.rows[0];
        if (!row) return;
        const idx = new Map(res.columns.map((c, i) => [c.name.toLowerCase(), i]));
        const n = Number(row[idx.get("n") ?? -1] ?? 0);
        if (!Number.isFinite(n) || n <= 0) return; // empty sample → keep progressive
        const cols: Record<string, number> = {};
        columns.forEach((c, i) => {
          const v = Number(row[idx.get(`f${i}`) ?? -1] ?? 0);
          cols[c.name] = Number.isFinite(v) ? v : 0;
        });
        if (!cancelled) setSample(key, cols, n, totalRows);
      } catch {
        /* keep the progressive estimate */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed only on the table identity: the sample is a one-shot
    // per table, guarded by sampleTried.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const map = new Map<string, FillInfo>();
    for (const c of columns) {
      const info = fillInfoFor(entry, c.name);
      if (info) map.set(c.name, info);
    }
    return map;
  }, [entry, columns]);
}
