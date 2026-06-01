import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import {
  backend,
  type CellValue,
  type ColumnDef,
  type TableDescription,
} from "@/ipc";
import { DataGrid } from "./DataGrid";
import { DetailPanel } from "@/components/detail/DetailPanel";
import { useActivityStore } from "@/store/activity";
import { useStatusStore } from "@/store/status";
import { useSelectionStore } from "@/store/selection";
import { useDetailDockStore } from "@/store/detailDock";
import { useTabsStore, type DrilldownCrumb } from "@/store/tabs";
import {
  relationColumns,
  localValue,
  buildCrumb,
  drilldownSql,
  type RelationColumn,
} from "@/lib/relations";
import { useRelationCounts } from "./useRelationCounts";

interface Props {
  tabId: string;
  connectionId: string;
  /** The breadcrumb path; the last crumb is what we render. */
  path: DrilldownCrumb[];
}

/**
 * A relationship drilldown tab: shows the related rows for the last crumb in the
 * path (filtered via a read-only SELECT), with a clickable breadcrumb to walk
 * back up, and its own relation columns so drilldown can continue arbitrarily
 * deep (OneToMany child traversal end-to-end; further hops reuse the same path).
 */
export function RelationView({ tabId, connectionId, path }: Props) {
  const crumb = path[path.length - 1];
  const schema = crumb.schema;
  const table = crumb.table;

  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<CellValue[][]>([]);
  const [description, setDescription] = useState<TableDescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pushActivity = useActivityStore((s) => s.push);
  const setStatus = useStatusStore((s) => s.set);
  const openRelation = useTabsStore((s) => s.openRelation);
  const navigateCrumb = useTabsStore((s) => s.navigateCrumb);

  const selection = useSelectionStore((s) => s.byTab[tabId]) ?? {
    rowIndex: null,
    columnName: null,
    mode: null,
  };
  const selectRow = useSelectionStore((s) => s.selectRow);
  const selectColumn = useSelectionStore((s) => s.selectColumn);
  const clearSelection = useSelectionStore((s) => s.clear);
  const dockOpen = useDetailDockStore((s) => s.open);
  const toggleDock = useDetailDockStore((s) => s.toggle);
  const dockWidth = useDetailDockStore((s) => s.width);
  const setDockWidth = useDetailDockStore((s) => s.setWidth);

  const sql = useMemo(() => drilldownSql(crumb), [crumb]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backend
      .connect(connectionId)
      .then(async (liveId) => {
        const descPromise = backend
          .describeTable(liveId, table, schema)
          .then(setDescription)
          .catch(() => setDescription(null));
        const res = await backend.executeQuery(liveId, sql);
        await descPromise;
        // Prefer typed columns from describe when the shapes line up.
        setColumns(res.columns);
        setRows(res.rows);
        setStatus({ elapsedMs: res.elapsedMs, loaded: res.rows.length, total: res.rowCount });
        pushActivity({
          category: "User",
          op: "SELECT",
          connection: connectionId.replace(/[-:]/g, " "),
          tables: `${schema}.${table}`,
          sql,
          durationMs: res.elapsedMs,
          rows: res.rows.length,
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [connectionId, schema, table, sql, pushActivity, setStatus]);

  useEffect(load, [load]);

  const relations = useMemo<RelationColumn[]>(
    () => relationColumns(description),
    [description]
  );

  const countRowIndices = useMemo(
    () => (selection.rowIndex != null ? [selection.rowIndex] : []),
    [selection.rowIndex]
  );
  const relationCounts = useRelationCounts({
    connectionId,
    schema,
    table,
    columns,
    rows,
    relations,
    rowIndices: countRowIndices,
  });

  // Continue drilling: append a new crumb to this tab's path.
  const onRelationClick = useCallback(
    (rowIndex: number, rel: RelationColumn) => {
      const row = rows[rowIndex];
      if (!row) return;
      const sourceKey = localValue(rel, columns, row);
      const next = buildCrumb(rel, table, sourceKey);
      if (!next) return;
      openRelation(connectionId, path, next);
    },
    [rows, columns, table, connectionId, path, openRelation]
  );

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const move = (ev: MouseEvent) => setDockWidth(startW - (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const selectedRow =
    selection.rowIndex != null ? rows[selection.rowIndex] ?? null : null;

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb of the drilldown path. */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg-secondary px-2">
        {path.map((c, i) => {
          const isLast = i === path.length - 1;
          const label =
            i === 0
              ? c.sourceKey != null
                ? `${c.table}[${c.sourceKey}]`
                : c.table
              : `${c.table}${c.filterColumn ? `(${c.filterColumn})` : ""}`;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-text-muted" />}
              <button
                className={
                  "rounded-sm px-1.5 py-0.5 font-mono text-xs " +
                  (isLast
                    ? "text-text-primary"
                    : "text-info hover:bg-bg-hover hover:underline")
                }
                disabled={isLast}
                onClick={() => navigateCrumb(tabId, i)}
                title={isLast ? "Current" : "Back to this step"}
              >
                {label}
              </button>
            </span>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <button className="grid-toolbar-btn" onClick={load} title="Refresh">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <span className="text-xs text-text-muted">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            className="grid-toolbar-btn"
            title={dockOpen ? "Hide detail panel" : "Show detail panel"}
            onClick={toggleDock}
          >
            {dockOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle size={22} className="text-danger" />
              <div className="text-md text-text-primary">Could not load related rows</div>
              <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
              <button
                className="mt-2 rounded-sm border border-border px-3 py-1 text-sm text-text-secondary hover:bg-bg-hover"
                onClick={load}
              >
                Retry
              </button>
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-md text-text-muted">
              <RefreshCw size={14} className="animate-spin" /> Loading {schema}.{table}…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-md text-text-muted">
              No related rows.
            </div>
          ) : (
            <DataGrid
              tabId={tabId}
              columns={columns}
              rows={rows}
              onRowSelect={(i) => selectRow(tabId, i)}
              onColumnSelect={(name) => selectColumn(tabId, name)}
              relations={relations}
              relationCounts={relationCounts}
              onRelationClick={onRelationClick}
            />
          )}
        </div>

        {dockOpen && (
          <>
            <div
              className="w-px shrink-0 cursor-col-resize bg-border hover:bg-accent"
              onMouseDown={startResize}
            />
            <div className="shrink-0" style={{ width: dockWidth }}>
              <DetailPanel
                tabId={tabId}
                connectionId={connectionId}
                schema={schema}
                table={table}
                columns={columns}
                row={selectedRow}
                rowIndex={selection.rowIndex}
                columnName={selection.columnName}
                mode={selection.mode}
                description={description}
                onClose={() => {
                  clearSelection(tabId);
                  toggleDock();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
