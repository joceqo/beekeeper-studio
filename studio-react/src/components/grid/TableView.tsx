import { useEffect, useState } from "react";
import { RefreshCw, Filter, ArrowDownUp, Plus } from "lucide-react";
import { backend, type RecordPage } from "@/ipc";
import { DataGrid } from "./DataGrid";
import { useActivityStore } from "@/store/activity";
import { useStatusStore } from "@/store/status";

interface Props {
  connectionId: string;
  schema: string;
  table: string;
}

export function TableView({ connectionId, schema, table }: Props) {
  const [page, setPage] = useState<RecordPage | null>(null);
  const [loading, setLoading] = useState(true);
  const pushActivity = useActivityStore((s) => s.push);
  const setStatus = useStatusStore((s) => s.set);

  const load = () => {
    setLoading(true);
    backend
      .getRecords({ connectionId, schema, table, limit: 100, offset: 0 })
      .then((p) => {
        setPage(p);
        setStatus({
          elapsedMs: p.elapsedMs,
          loaded: p.loaded,
          total: p.totalRows,
        });
        pushActivity({
          category: "User",
          op: "SELECT",
          connection: connectionId.replace(/-/g, " "),
          tables: `${schema}.${table}`,
          sql: `SELECT * FROM "${schema}"."${table}" LIMIT 100`,
          durationMs: p.elapsedMs,
          rows: p.loaded,
        });
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [connectionId, schema, table]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <button className="grid-toolbar-btn" onClick={load} title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <button className="grid-toolbar-btn" title="Filter">
          <Filter size={13} />
        </button>
        <button className="grid-toolbar-btn" title="Sort">
          <ArrowDownUp size={13} />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button className="grid-toolbar-btn" title="Insert row">
          <Plus size={13} />
        </button>
        <span className="ml-2 font-mono text-xs text-text-muted">
          {schema}.{table}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {page ? `${page.loaded} loaded · ~${page.totalRows} total` : "loading…"}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {page && <DataGrid columns={page.columns} rows={page.rows} />}
      </div>
    </div>
  );
}
