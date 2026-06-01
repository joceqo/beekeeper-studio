import { useEffect, useMemo, useRef, useState } from "react";
import { backend, type CellValue, type ColumnDef } from "@/ipc";
import { relationCountKey, type RelationColumn } from "@/lib/relations";

/**
 * Lazily fetch related-row counts for relation chips. Counts are best-effort
 * (the backend tool may be unavailable, in which case `getRelationCounts`
 * resolves to `[]` and chips simply render without a number).
 *
 * To stay cheap, counts are fetched per *row key* on demand — currently for the
 * selected row — and cached by `${table}::${pkValue}`. The returned map is the
 * `rowIndex -> (relationId -> count)` shape the grid consumes.
 */
export function useRelationCounts(args: {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnDef[];
  rows: CellValue[][];
  relations: RelationColumn[];
  /** Page-relative row indices to fetch counts for (e.g. the selected row). */
  rowIndices: number[];
}): Map<number, Map<string, number>> {
  const { connectionId, schema, table, columns, rows, relations, rowIndices } = args;

  // cacheKey -> (relationId -> count)
  const [cache, setCache] = useState<Map<string, Map<string, number>>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());

  const pkIndex = useMemo(() => {
    const i = columns.findIndex((c) => c.primaryKey);
    return i >= 0 ? i : 0;
  }, [columns]);

  const hasIncoming = relations.some((r) => r.direction === "incoming");

  // Reset cache when the underlying table/connection changes.
  useEffect(() => {
    setCache(new Map());
    inFlight.current = new Set();
  }, [connectionId, schema, table]);

  const wantedKeys = rowIndices
    .map((i) => rows[i]?.[pkIndex])
    .filter((v): v is CellValue => v !== undefined && v !== null)
    .map((v) => String(v));

  useEffect(() => {
    if (!hasIncoming) return;
    for (const idx of rowIndices) {
      const pk = rows[idx]?.[pkIndex];
      if (pk === undefined || pk === null) continue;
      const cacheKey = `${schema}.${table}::${String(pk)}`;
      if (cache.has(cacheKey) || inFlight.current.has(cacheKey)) continue;
      inFlight.current.add(cacheKey);
      backend
        .getRelationCounts({ connectionId, table, schema, rowKey: pk })
        .then((counts) => {
          const byRel = new Map<string, number>();
          for (const c of counts) byRel.set(relationCountKey(c), c.count);
          setCache((prev) => {
            const next = new Map(prev);
            next.set(cacheKey, byRel);
            return next;
          });
        })
        .catch(() => {
          setCache((prev) => {
            const next = new Map(prev);
            next.set(cacheKey, new Map());
            return next;
          });
        })
        .finally(() => inFlight.current.delete(cacheKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema, table, hasIncoming, pkIndex, wantedKeys.join(",")]);

  // Project the cache onto page-relative row indices for the grid.
  return useMemo(() => {
    const out = new Map<number, Map<string, number>>();
    for (const idx of rowIndices) {
      const pk = rows[idx]?.[pkIndex];
      if (pk === undefined || pk === null) continue;
      const byRel = cache.get(`${schema}.${table}::${String(pk)}`);
      if (byRel) out.set(idx, byRel);
    }
    return out;
  }, [cache, rowIndices, rows, pkIndex, schema, table]);
}
