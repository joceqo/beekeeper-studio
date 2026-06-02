import { useEffect, useMemo, useRef, useState } from "react";
import { backend, type CellValue, type ColumnDef } from "@/ipc";
import type { RelationColumn } from "@/lib/relations";

/**
 * Fetch incoming-relation child counts for the WHOLE visible page (§1), not just
 * the selected row. To stay cheap, counts are computed with a single grouped
 * query per relation (`SELECT fk, count(*) ... WHERE fk IN (<page pks>) GROUP BY
 * fk`) via {@link backend.getPageRelationCounts}, then projected onto each row by
 * its primary-key value. Results are cached per (table, page-signature).
 *
 * Best-effort: on backend error the map is empty and chips render without a
 * number. The returned shape is `rowIndex -> (relationId -> count)`, which the
 * grid consumes directly.
 */
export function useRelationCounts(args: {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnDef[];
  rows: CellValue[][];
  relations: RelationColumn[];
  /**
   * A signature that changes when the page changes (offset/filter/sort), so the
   * cache key is stable within a page but refetches across pages.
   */
  pageKey: string;
}): Map<number, Map<string, number>> {
  const { connectionId, schema, table, columns, rows, relations, pageKey } = args;

  // cacheKey -> (relationId -> (pkValue -> count))
  const [cache, setCache] = useState<
    Map<string, Record<string, Record<string, number>>>
  >(new Map());
  const inFlight = useRef<Set<string>>(new Set());

  const pkIndex = useMemo(() => {
    const i = columns.findIndex((c) => c.primaryKey);
    return i >= 0 ? i : 0;
  }, [columns]);

  // Only incoming (1:N) relations carry per-row counts.
  const incoming = useMemo(
    () => relations.filter((r) => r.direction === "incoming"),
    [relations]
  );

  // The page's PK values (deduped, non-null), used for the IN (...) list.
  const rowKeys = useMemo(() => {
    const set = new Set<string>();
    const out: CellValue[] = [];
    for (const row of rows) {
      const v = row[pkIndex];
      if (v === null || v === undefined) continue;
      const s = String(v);
      if (set.has(s)) continue;
      set.add(s);
      out.push(v);
    }
    return out;
  }, [rows, pkIndex]);

  const cacheKey = `${schema}.${table}::${pageKey}`;

  // Reset cache when the underlying table/connection changes.
  useEffect(() => {
    setCache(new Map());
    inFlight.current = new Set();
  }, [connectionId, schema, table]);

  useEffect(() => {
    if (incoming.length === 0 || rowKeys.length === 0) return;
    if (cache.has(cacheKey) || inFlight.current.has(cacheKey)) return;
    inFlight.current.add(cacheKey);
    backend
      .getPageRelationCounts({
        connectionId,
        schema,
        toColumn: columns[pkIndex]?.name ?? "id",
        rowKeys,
        relations: incoming.map((r) => ({
          id: r.id,
          schema: r.targetSchema,
          table: r.targetTable,
          fromColumn: r.targetColumn,
        })),
      })
      .then((result) => {
        setCache((prev) => {
          const next = new Map(prev);
          next.set(cacheKey, result);
          return next;
        });
      })
      .catch(() => {
        setCache((prev) => {
          const next = new Map(prev);
          next.set(cacheKey, {});
          return next;
        });
      })
      .finally(() => inFlight.current.delete(cacheKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema, table, cacheKey, incoming, rowKeys.length, pkIndex]);

  // Project page counts onto each row index by its PK value.
  return useMemo(() => {
    const out = new Map<number, Map<string, number>>();
    const byRel = cache.get(cacheKey);
    if (!byRel) return out;
    rows.forEach((row, idx) => {
      const pk = row[pkIndex];
      if (pk === null || pk === undefined) return;
      const key = String(pk);
      const m = new Map<string, number>();
      for (const r of incoming) {
        m.set(r.id, byRel[r.id]?.[key] ?? 0);
      }
      out.set(idx, m);
    });
    return out;
  }, [cache, cacheKey, rows, pkIndex, incoming]);
}
