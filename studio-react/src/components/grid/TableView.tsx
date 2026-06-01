import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Filter,
  ArrowDownUp,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { backend, type RecordPage } from "@/ipc";
import { DataGrid, type SortState } from "./DataGrid";
import { useActivityStore } from "@/store/activity";
import { useStatusStore } from "@/store/status";

interface Props {
  connectionId: string;
  schema: string;
  table: string;
}

const PAGE_SIZE = 100;

export function TableView({ connectionId, schema, table }: Props) {
  const [page, setPage] = useState<RecordPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const pushActivity = useActivityStore((s) => s.push);
  const setStatus = useStatusStore((s) => s.set);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backend
      .getRecords({
        connectionId,
        schema,
        table,
        limit: PAGE_SIZE,
        offset,
        orderBy: sort ? [{ column: sort.column, direction: sort.direction }] : undefined,
      })
      .then((p) => {
        setPage(p);
        setStatus({ elapsedMs: p.elapsedMs, loaded: p.loaded, total: p.totalRows });
        const orderClause = sort ? ` ORDER BY "${sort.column}" ${sort.direction.toUpperCase()}` : "";
        pushActivity({
          category: "User",
          op: "SELECT",
          connection: connectionId.replace(/[-:]/g, " "),
          tables: `${schema}.${table}`,
          sql: `SELECT * FROM "${schema}"."${table}"${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          durationMs: p.elapsedMs,
          rows: p.loaded,
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPage(null);
      })
      .finally(() => setLoading(false));
  }, [connectionId, schema, table, offset, sort, pushActivity, setStatus]);

  useEffect(load, [load]);

  // Cycle asc -> desc -> none, resetting to the first page on sort change.
  const onSort = useCallback((column: string) => {
    setOffset(0);
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }, []);

  const onPrev = () => setOffset((o) => Math.max(0, o - PAGE_SIZE));
  const onNext = () => setOffset((o) => o + PAGE_SIZE);
  const hasNext = page ? page.loaded === PAGE_SIZE : false;
  const pageNum = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <button className="grid-toolbar-btn" onClick={load} title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <button className="grid-toolbar-btn" title="Filter">
          <Filter size={13} />
        </button>
        <button
          className="grid-toolbar-btn"
          title={sort ? `Sorted by ${sort.column} (${sort.direction})` : "Click a column header to sort"}
        >
          <ArrowDownUp size={13} className={sort ? "text-accent" : ""} />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button className="grid-toolbar-btn" title="Insert row">
          <Plus size={13} />
        </button>
        <span className="ml-2 font-mono text-xs text-text-muted">
          {schema}.{table}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="grid-toolbar-btn"
            title="Previous page"
            onClick={onPrev}
            disabled={offset === 0}
          >
            <ChevronLeft size={13} className={offset === 0 ? "opacity-30" : ""} />
          </button>
          <span className="font-mono text-xs text-text-muted">page {pageNum}</span>
          <button
            className="grid-toolbar-btn"
            title="Next page"
            onClick={onNext}
            disabled={!hasNext}
          >
            <ChevronRight size={13} className={!hasNext ? "opacity-30" : ""} />
          </button>
          <span className="text-xs text-text-muted">
            {page ? `${page.loaded} loaded · rows ${offset + 1}–${offset + page.loaded}` : "—"}
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertTriangle size={22} className="text-danger" />
            <div className="text-md text-text-primary">Could not load records</div>
            <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
            <button
              className="mt-2 rounded-sm border border-border px-3 py-1 text-sm text-text-secondary hover:bg-bg-hover"
              onClick={load}
            >
              Retry
            </button>
          </div>
        ) : loading && !page ? (
          <div className="flex h-full items-center justify-center gap-2 text-md text-text-muted">
            <RefreshCw size={14} className="animate-spin" /> Loading {schema}.{table}…
          </div>
        ) : page && page.columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-md text-text-muted">
            No columns to display.
          </div>
        ) : page && page.rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-md text-text-muted">
            No rows{offset > 0 ? " on this page" : ""}.
          </div>
        ) : page ? (
          <DataGrid columns={page.columns} rows={page.rows} sort={sort} onSort={onSort} />
        ) : null}
      </div>
    </div>
  );
}
