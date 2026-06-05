import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  ArrowDownUp,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { backend, type ColumnStats, type RecordPage, type TableDescription } from "@/ipc";
import { DataGrid, type SortState, type SortDirection } from "./DataGrid";
import { FilterBar } from "./FilterBar";
import { DetailPanel } from "@/components/detail/DetailPanel";
import { useActivityStore } from "@/store/activity";
import { useStatusStore } from "@/store/status";
import { useSelectionStore } from "@/store/selection";
import { useLayoutStore } from "@/store/layout";
import { DetailDockPortal } from "@/components/shell/DetailDock";
import { useTabsStore, type DrilldownCrumb } from "@/store/tabs";
import { useFilterStore } from "@/store/filters";
import { useColumnConfigStore } from "@/store/columnConfig";
import { compileWhere } from "@/lib/filters";
import {
  relationColumns,
  localValue,
  buildCrumb,
  parseRef,
  type RelationColumn,
} from "@/lib/relations";
import type { CellValue, ColumnDef } from "@/ipc";
import { useRelationCounts } from "./useRelationCounts";
import { useM2MRelations } from "./useM2MRelations";
import { useColumnFill } from "./useColumnFill";
import { IconButton, Button, Tooltip } from "@/ui";

interface Props {
  tabId: string;
  connectionId: string;
  schema: string;
  table: string;
}

const PAGE_SIZE = 100;

export function TableView({ tabId, connectionId, schema, table }: Props) {
  const [page, setPage] = useState<RecordPage | null>(null);
  const [description, setDescription] = useState<TableDescription | null>(null);
  // Per-column value stats (top_values + nullFraction), for semantic inference.
  const [stats, setStats] = useState<Map<string, ColumnStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const pushActivity = useActivityStore((s) => s.push);
  const setStatus = useStatusStore((s) => s.set);

  // Active per-tab filter tree → compiled read-only WHERE.
  const filterRoot = useFilterStore((s) => s.byTab[tabId]);
  const where = useMemo(() => compileWhere(filterRoot ?? null), [filterRoot]);

  // Selection (drives the detail panel) + dock visibility.
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
  const openDock = () => {
    const ls = useLayoutStore.getState();
    if (ls.detailCollapsed) ls.toggle("detail");
  };
  const openRelation = useTabsStore((s) => s.openRelation);

  // Column-header context-menu actions (Agent C).
  const addCondition = useFilterStore((s) => s.addCondition);
  const updateNode = useFilterStore((s) => s.updateNode);
  const getRoot = useFilterStore((s) => s.getRoot);
  const setColumnHidden = useColumnConfigStore((s) => s.setHidden);

  // Virtual relation columns (outgoing parents + incoming children).
  const baseRelations = useMemo<RelationColumn[]>(
    () => relationColumns(description),
    [description]
  );
  // Collapse many-to-many junctions into far-table relations.
  const relations = useM2MRelations(connectionId, baseRelations);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // BUG FIX: await connect first so the saved/unresolved connection id is
    // mapped to the live connectionId before any schema/data call fires. The
    // resolved id is then used for every subsequent request.
    backend
      .connect(connectionId)
      .then(async (liveId) => {
        // Describe in parallel for FK / nullable metadata used by the panel.
        const descPromise = backend
          .describeTable(liveId, table, schema)
          .then(setDescription)
          .catch(() => setDescription(null));
        const p = await backend.getRecords({
          connectionId: liveId,
          schema,
          table,
          limit: PAGE_SIZE,
          offset,
          orderBy: sort ? [{ column: sort.column, direction: sort.direction }] : undefined,
          where: where || undefined,
        });
        await descPromise;
        setPage(p);
        setStatus({ elapsedMs: p.elapsedMs, loaded: p.loaded, total: p.totalRows });
        const whereClause = where ? ` WHERE ${where}` : "";
        const orderClause = sort
          ? ` ORDER BY "${sort.column}" ${sort.direction.toUpperCase()}`
          : "";
        pushActivity({
          category: "User",
          op: "SELECT",
          connection: connectionId.replace(/[-:]/g, " "),
          tables: `${schema}.${table}`,
          sql: `SELECT * FROM "${schema}"."${table}"${whereClause}${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          durationMs: p.elapsedMs,
          rows: p.loaded,
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPage(null);
      })
      .finally(() => setLoading(false));
  }, [connectionId, schema, table, offset, sort, where, pushActivity, setStatus]);

  useEffect(load, [load]);

  // Fetch per-column value stats once per (connection, schema, table). These
  // drive semantic-type inference and don't depend on paging/sort/filter, so
  // they live in their own effect. Best-effort: stays empty on failure.
  useEffect(() => {
    let cancelled = false;
    setStats(new Map());
    backend
      .connect(connectionId)
      .then((liveId) => backend.getTableStats({ connectionId: liveId, table, schema }))
      .then((s) => {
        if (cancelled) return;
        setStats(new Map(s.columns.map((c) => [c.name, c])));
      })
      .catch(() => {
        if (!cancelled) setStats(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table]);

  // Reset to the first page whenever the filter changes so paging stays valid.
  useEffect(() => {
    setOffset(0);
  }, [where]);

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

  // --- Column-header context-menu handlers (Agent C) ----------------------

  const onSortColumn = useCallback((column: ColumnDef, direction: SortDirection) => {
    setOffset(0);
    setSort({ column: column.name, direction });
  }, []);

  // Seed a FilterBar condition on the column (an empty `equals` leaf the user
  // fills in), reusing the filters store. Append rather than seedEquals so an
  // existing filter tree is preserved.
  const onFilterColumn = useCallback(
    (column: ColumnDef) => {
      const before = new Set(getRoot(tabId).children.map((c) => c.id));
      addCondition(tabId, undefined, column.name);
      // Default the new leaf to `is not null` so it contributes immediately and
      // reads as an active filter the user can refine.
      const after = getRoot(tabId).children.find((c) => !before.has(c.id));
      if (after) updateNode(tabId, after.id, { operator: "is_not_null" });
    },
    [tabId, addCondition, updateNode, getRoot]
  );

  const onHideColumn = useCallback(
    (column: ColumnDef) => {
      setColumnHidden(tabId, column.name, true);
    },
    [tabId, setColumnHidden]
  );

  // Open the detail dock focused on the column (column-detail view).
  const onConfigureColumn = useCallback(
    (column: ColumnDef) => {
      selectColumn(tabId, column.name);
      openDock();
    },
    [tabId, selectColumn]
  );

  const selectedRow =
    page && selection.rowIndex != null ? page.rows[selection.rowIndex] ?? null : null;

  // Fetch relation chip counts for the WHOLE visible page (best-effort, cached
  // per page via a single grouped query per relation).
  const pageKey = useMemo(
    () => `o${offset}|w${where}|s${sort ? `${sort.column}:${sort.direction}` : ""}`,
    [offset, where, sort]
  );
  const relationCounts = useRelationCounts({
    connectionId,
    schema,
    table,
    columns: page?.columns ?? [],
    rows: page?.rows ?? [],
    relations,
    pageKey,
  });

  // Per-column completeness (fill rate) → 3-bar header glyph. Accumulates from
  // loaded pages (only when unfiltered, so the estimate stays unbiased) and is
  // upgraded by a whole-table TABLESAMPLE on Postgres. See useColumnFill.
  const fill = useColumnFill({
    connectionId,
    schema,
    table,
    columns: page?.columns ?? [],
    rows: page?.rows ?? [],
    totalRows: page?.totalRows ?? null,
    pkIndex: page?.columns.findIndex((c) => c.primaryKey) ?? -1,
    pageSig: pageKey,
    active: !where,
  });

  // Drill into related rows: open a new relation tab with a breadcrumb path.
  const onRelationClick = useCallback(
    (rowIndex: number, rel: RelationColumn) => {
      if (!page) return;
      const row = page.rows[rowIndex];
      if (!row) return;
      const sourceKey = localValue(rel, page.columns, row);
      const crumb = buildCrumb(rel, table, sourceKey);
      if (!crumb) return;
      // Origin crumb (this row) + the followed hop.
      const pkIdx = page.columns.findIndex((c) => c.primaryKey);
      const originKey = pkIdx >= 0 ? row[pkIdx] : sourceKey;
      const origin: DrilldownCrumb = {
        schema,
        table,
        sourceKey: originKey as string | number,
        sourceTable: table,
      };
      openRelation(connectionId, [origin], crumb);
    },
    [page, table, schema, connectionId, openRelation]
  );

  // Follow an FK value as an orange link (§2): drill into the parent row (N:1),
  // referenced table filtered to PK = value.
  const onFkClick = useCallback(
    (rowIndex: number, column: ColumnDef, value: CellValue) => {
      if (!page) return;
      const ref = description?.foreignKeys.find((k) => k.column === column.name);
      if (!ref) return;
      const parsed = parseRef(ref.references);
      if (!parsed) return;
      const row = page.rows[rowIndex];
      const pkIdx = page.columns.findIndex((c) => c.primaryKey);
      const originKey = row && pkIdx >= 0 ? row[pkIdx] : value;
      const origin: DrilldownCrumb = {
        schema,
        table,
        sourceKey: originKey as string | number,
        sourceTable: table,
      };
      const crumb: DrilldownCrumb = {
        schema: parsed.schema ?? schema,
        table: parsed.table,
        filterColumn: parsed.column,
        filterValue: value as string | number,
        relation: "outgoing",
        sourceKey: value as string | number,
        sourceTable: table,
      };
      openRelation(connectionId, [origin], crumb);
    },
    [page, description, schema, table, connectionId, openRelation]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <Tooltip content="Refresh">
          <IconButton onClick={load} aria-label="Refresh">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </IconButton>
        </Tooltip>
        <Tooltip content={sort ? `Sorted by ${sort.column} (${sort.direction})` : "Click a column header to sort"}>
          <IconButton aria-label="Sort">
            <ArrowDownUp size={13} className={sort ? "text-accent" : ""} />
          </IconButton>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-border" />
        <Tooltip content="Insert row">
          <IconButton aria-label="Insert row">
            <Plus size={13} />
          </IconButton>
        </Tooltip>
        <span className="ml-2 font-mono text-xs text-text-muted">
          {schema}.{table}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Tooltip content="Previous page">
            <IconButton onClick={onPrev} disabled={offset === 0} aria-label="Previous page">
              <ChevronLeft size={13} className={offset === 0 ? "opacity-30" : ""} />
            </IconButton>
          </Tooltip>
          <span className="font-mono text-xs tabular-nums text-text-muted">page {pageNum}</span>
          <Tooltip content="Next page">
            <IconButton onClick={onNext} disabled={!hasNext} aria-label="Next page">
              <ChevronRight size={13} className={!hasNext ? "opacity-30" : ""} />
            </IconButton>
          </Tooltip>
          <span className="font-mono text-xs tabular-nums text-text-muted">
            {page ? `${page.loaded} loaded · rows ${offset + 1}–${offset + page.loaded}` : "—"}
          </span>
          <div className="mx-1 h-4 w-px bg-border" />
          <Tooltip content={dockOpen ? "Hide detail panel" : "Show detail panel"}>
            <IconButton onClick={toggleDock} aria-label="Toggle detail panel">
              {dockOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <FilterBar tabId={tabId} columns={description?.columns ?? page?.columns ?? []} />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle size={22} className="text-danger" />
              <div className="text-md text-text-primary">Could not load records</div>
              <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
              <Button variant="subtle" size="sm" className="mt-2" onClick={load}>
                Retry
              </Button>
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
            <DataGrid
              tabId={tabId}
              columns={page.columns}
              rows={page.rows}
              sort={sort}
              onSort={onSort}
              onRowSelect={(i) => {
                selectRow(tabId, i);
                // Selecting a row reveals it in the ROW detail dock (auto-expand
                // if collapsed), mirroring SlashTable's publishRowDetail().
                if (i != null) openDock();
              }}
              onColumnSelect={(name) => selectColumn(tabId, name)}
              relations={relations}
              relationCounts={relationCounts}
              onRelationClick={onRelationClick}
              description={description}
              onFkClick={onFkClick}
              onSortColumn={onSortColumn}
              onFilterColumn={onFilterColumn}
              onHideColumn={onHideColumn}
              onConfigureColumn={onConfigureColumn}
              stats={stats}
              fill={fill}
            />
          ) : null}
        </div>

        {dockOpen && (
          <DetailDockPortal>
            <DetailPanel
              tabId={tabId}
              connectionId={connectionId}
              schema={schema}
              table={table}
              columns={page?.columns ?? []}
              row={selectedRow}
              rowIndex={selection.rowIndex}
              columnName={selection.columnName}
              mode={selection.mode}
              description={description}
              stats={stats}
              fill={fill}
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
