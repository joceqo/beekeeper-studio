import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { DrilldownBreadcrumb } from "./DrilldownBreadcrumb";
import {
  backend,
  type CellValue,
  type ColumnDef,
  type TableDescription,
} from "@/ipc";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
import { DetailPanel } from "@/components/detail/DetailPanel";
import { useActivityStore } from "@/store/activity";
import { useStatusStore } from "@/store/status";
import { useSelectionStore } from "@/store/selection";
import { useLayoutStore } from "@/store/layout";
import { DetailDockPortal } from "@/components/shell/DetailDock";
import { useTabsStore, type DrilldownCrumb } from "@/store/tabs";
import { useFilterStore } from "@/store/filters";
import { compileWhere } from "@/lib/filters";
import {
  relationColumns,
  localValue,
  buildCrumb,
  drilldownSql,
  parseRef,
  type RelationColumn,
} from "@/lib/relations";
import { useRelationCounts } from "./useRelationCounts";
import { IconButton, Button, Tooltip } from "@/ui";

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

  // The branching breadcrumb tree (§3) lives on the tab.
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === tabId));
  const seedEquals = useFilterStore((s) => s.seedEquals);

  const selection = useSelectionStore((s) => s.byTab[tabId]) ?? {
    rowIndex: null,
    columnName: null,
    mode: null,
  };
  const selectRow = useSelectionStore((s) => s.selectRow);
  const selectColumn = useSelectionStore((s) => s.selectColumn);
  const clearSelection = useSelectionStore((s) => s.clear);
  const dockOpen = !useLayoutStore((s) => s.detailCollapsed);
  const toggleDock = () => useLayoutStore.getState().toggle("detail");

  // Each drilldown step seeds its join condition (fk=value / pk=value) into the
  // linked FilterBar (§3), so the join filter is visible and editable. Seeded
  // once per tab (seedEquals is a no-op if a tree already exists).
  useEffect(() => {
    if (crumb.filterColumn != null && crumb.filterValue !== undefined) {
      seedEquals(tabId, crumb.filterColumn, crumb.filterValue);
    }
  }, [tabId, crumb.filterColumn, crumb.filterValue, seedEquals]);

  // The FilterBar's compiled WHERE drives the drilldown. Since the join pin is
  // seeded into the FilterBar, `where` already contains it; use `where` alone
  // when present and fall back to the crumb's own pin when the user clears the
  // filter (keeps the drilldown scoped either way, no duplicated condition).
  const filterRoot = useFilterStore((s) => s.byTab[tabId]);
  const where = useMemo(() => compileWhere(filterRoot ?? null), [filterRoot]);
  const sql = useMemo(() => {
    if (where) {
      const qualified = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      return `SELECT * FROM ${qualified} WHERE ${where} LIMIT 200`;
    }
    return drilldownSql(crumb);
  }, [crumb, where, schema, table]);

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

  // Page-level relation counts for the drilldown's rows (one grouped query per
  // relation). The page key is the drilldown SQL itself.
  const relationCounts = useRelationCounts({
    connectionId,
    schema,
    table,
    columns,
    rows,
    relations,
    pageKey: sql,
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

  // Follow an FK value as an orange link (§2) from within a drilldown: branch
  // into the parent row (N:1), extending this tab's breadcrumb tree.
  const onFkClick = useCallback(
    (_rowIndex: number, column: ColumnDef, value: CellValue) => {
      const ref = description?.foreignKeys.find((k) => k.column === column.name);
      if (!ref) return;
      const parsed = parseRef(ref.references);
      if (!parsed) return;
      const crumb: DrilldownCrumb = {
        schema: parsed.schema ?? schema,
        table: parsed.table,
        filterColumn: parsed.column,
        filterValue: value as string | number,
        relation: "outgoing",
        sourceKey: value as string | number,
        sourceTable: table,
      };
      openRelation(connectionId, path, crumb);
    },
    [description, schema, table, connectionId, path, openRelation]
  );

  const selectedRow =
    selection.rowIndex != null ? rows[selection.rowIndex] ?? null : null;

  return (
    <div className="flex h-full flex-col">
      {/* Branching breadcrumb of the drilldown tree (§3). */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg-secondary px-2">
        {tab?.tree && (
          <DrilldownBreadcrumb
            tabId={tabId}
            tree={tab.tree}
            activeNodeId={tab.activeNodeId ?? null}
            canBack={(tab.historyIndex ?? 0) > 0}
            canForward={(tab.historyIndex ?? 0) < (tab.history?.length ?? 1) - 1}
          />
        )}

        <div className="ml-auto flex items-center gap-2">
          <Tooltip content="Refresh">
            <IconButton onClick={load} aria-label="Refresh">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </IconButton>
          </Tooltip>
          <span className="text-xs text-text-muted">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
          <div className="mx-1 h-4 w-px bg-border" />
          <Tooltip content={dockOpen ? "Hide detail panel" : "Show detail panel"}>
            <IconButton onClick={toggleDock} aria-label="Toggle detail panel">
              {dockOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <FilterBar tabId={tabId} columns={description?.columns ?? columns} />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle size={22} className="text-danger" />
              <div className="text-md text-text-primary">Could not load related rows</div>
              <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
              <Button variant="subtle" size="sm" className="mt-2" onClick={load}>
                Retry
              </Button>
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
              description={description}
              onFkClick={onFkClick}
            />
          )}
        </div>

        {dockOpen && (
          <DetailDockPortal>
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
          </DetailDockPortal>
        )}
      </div>
    </div>
  );
}
