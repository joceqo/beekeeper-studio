import { useMemo } from "react";
import { KeyRound, Link2, Eye, EyeOff, X } from "lucide-react";
import type { CellValue, ColumnDef, TableDescription } from "@/ipc";
import { useTabsStore, type DrilldownCrumb } from "@/store/tabs";
import {
  useColumnConfigStore,
  FORMAT_LABELS,
  type ColumnFormat,
} from "@/store/columnConfig";
import { cn } from "@/lib/cn";

interface Props {
  tabId: string;
  connectionId: string;
  /** Source schema/table this panel describes, for accurate drilldown crumbs. */
  schema?: string;
  table?: string;
  columns: ColumnDef[];
  row: CellValue[] | null;
  /** index of the selected row in the page (for the header label) */
  rowIndex: number | null;
  /** name of the focused column, when in column mode */
  columnName: string | null;
  mode: "row" | "column" | null;
  /** describeTable result, for FK / nullable metadata */
  description: TableDescription | null;
  onClose: () => void;
}

/** Parse a Beekeeper FK reference string like `public.users(id)`. */
function parseRef(ref: string): { schema?: string; table: string; column: string } | null {
  const m = /^(?:([^.]+)\.)?([^(]+)\(([^)]+)\)$/.exec(ref.trim());
  if (!m) return null;
  return { schema: m[1], table: m[2], column: m[3] };
}

/** Build a column-name -> FK reference map from the table description. */
function fkMap(description: TableDescription | null): Map<string, string> {
  const map = new Map<string, string>();
  description?.foreignKeys.forEach((k) => map.set(k.column, k.references));
  return map;
}

function NullValue() {
  return <span className="italic text-text-muted">NULL</span>;
}

export function DetailPanel({
  tabId,
  connectionId,
  schema,
  table,
  columns,
  row,
  rowIndex,
  columnName,
  mode,
  description,
  onClose,
}: Props) {
  const openTable = useTabsStore((s) => s.openTable);
  const openRelation = useTabsStore((s) => s.openRelation);
  const fks = useMemo(() => fkMap(description), [description]);

  // Find this row's PK value, to anchor the breadcrumb origin crumb.
  const pkIndex = columns.findIndex((c) => c.primaryKey);
  const originKey = row && pkIndex >= 0 ? row[pkIndex] : null;

  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {mode === "column" ? "Column" : mode === "row" ? "Row" : "Details"}
      </span>
      <button
        className="grid-toolbar-btn ml-auto"
        title="Close detail panel"
        onClick={onClose}
      >
        <X size={13} />
      </button>
    </div>
  );

  let body: React.ReactNode;

  if (mode === "column" && columnName) {
    body = (
      <ColumnDetail
        tabId={tabId}
        column={columns.find((c) => c.name === columnName) ?? null}
        columnName={columnName}
        fkRef={fks.get(columnName) ?? null}
      />
    );
  } else if (mode === "row" && row) {
    body = (
      <RowDetail
        columns={columns}
        row={row}
        rowIndex={rowIndex}
        fks={fks}
        onFollowFk={(parsed, value) => {
          // Parent (N:1) drilldown: filter the referenced table to PK = value,
          // with a breadcrumb anchored at this source row.
          const origin: DrilldownCrumb = {
            schema: schema ?? "public",
            table: table ?? "",
            sourceKey: originKey as string | number | undefined,
            sourceTable: table,
          };
          const crumb: DrilldownCrumb = {
            schema: parsed.schema ?? schema ?? "public",
            table: parsed.table,
            filterColumn: parsed.column,
            filterValue: value as string | number,
            relation: "outgoing",
            sourceKey: value as string | number,
            sourceTable: table,
          };
          if (table) openRelation(connectionId, [origin], crumb);
          else openTable(connectionId, parsed.schema ?? "public", parsed.table);
        }}
      />
    );
  } else {
    body = (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
        Select a row or click a column header to see details.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {header}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}

// --- Row detail (key -> value form) ----------------------------------------

function RowDetail({
  columns,
  row,
  rowIndex,
  fks,
  onFollowFk,
}: {
  columns: ColumnDef[];
  row: CellValue[];
  rowIndex: number | null;
  fks: Map<string, string>;
  onFollowFk: (
    parsed: { schema?: string; table: string; column: string },
    value: CellValue
  ) => void;
}) {
  return (
    <div className="flex flex-col">
      {rowIndex != null && (
        <div className="px-3 py-2 font-mono text-xs text-text-muted">row #{rowIndex + 1}</div>
      )}
      <dl className="flex flex-col">
        {columns.map((c, i) => {
          const value = row[i];
          const ref = fks.get(c.name);
          return (
            <div
              key={c.name}
              className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-2"
            >
              <dt className="flex items-center gap-1.5">
                {c.primaryKey && <KeyRound size={11} className="text-warning" />}
                {ref && <Link2 size={11} className="text-info" />}
                <span className="font-mono text-xs text-text-secondary">{c.name}</span>
                <span className="ml-auto font-mono text-[10px] text-text-muted">{c.dataType}</span>
              </dt>
              <dd className="font-mono text-md break-words text-text-primary">
                {value === null || value === undefined ? (
                  <NullValue />
                ) : ref ? (
                  <FkLink value={value} reference={ref} onFollowFk={onFollowFk} />
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function FkLink({
  value,
  reference,
  onFollowFk,
}: {
  value: CellValue;
  reference: string;
  onFollowFk: (
    parsed: { schema?: string; table: string; column: string },
    value: CellValue
  ) => void;
}) {
  const parsed = parseRef(reference);
  return (
    <button
      className="inline-flex items-center gap-1 text-left text-info underline decoration-dotted underline-offset-2 hover:text-accent"
      title={`Follow ${reference}`}
      onClick={() => {
        // Breadcrumb relationship drilldown: filter the referenced (parent)
        // table to `column = value` in a new relation tab.
        if (parsed) onFollowFk(parsed, value);
      }}
    >
      {String(value)}
      <Link2 size={11} />
    </button>
  );
}

// --- Column detail ----------------------------------------------------------

const FORMATS: ColumnFormat[] = ["text", "number", "currency", "percentage", "thousands"];

function ColumnDetail({
  tabId,
  column,
  columnName,
  fkRef,
}: {
  tabId: string;
  column: ColumnDef | null;
  columnName: string;
  fkRef: string | null;
}) {
  const config = useColumnConfigStore((s) => s.byKey[`${tabId}::${columnName}`]) ?? {
    format: "text" as ColumnFormat,
    hidden: false,
  };
  const setFormat = useColumnConfigStore((s) => s.setFormat);
  const setHidden = useColumnConfigStore((s) => s.setHidden);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="flex items-center gap-1.5">
          {column?.primaryKey && <KeyRound size={12} className="text-warning" />}
          {fkRef && <Link2 size={12} className="text-info" />}
          <span className="font-mono text-md text-text-primary">{columnName}</span>
        </div>
        <div className="mt-0.5 font-mono text-xs text-text-muted">
          {column?.dataType ?? "unknown type"}
        </div>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <Flag label="Nullable" on={!!column?.nullable} />
        <Flag label="Primary key" on={!!column?.primaryKey} />
        <Flag label="Foreign key" on={!!fkRef} detail={fkRef ?? undefined} />
        {column?.default != null && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-text-muted">Default</dt>
            <dd className="font-mono text-text-secondary">{column.default}</dd>
          </div>
        )}
      </dl>

      {/* Format options — stored per column, applied by the grid. */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Format
        </div>
        <div className="flex flex-wrap gap-1">
          {FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(tabId, columnName, f)}
              className={cn(
                "rounded-sm border px-2 py-1 text-xs",
                config.format === f
                  ? "border-accent bg-accent-subtle text-accent"
                  : "border-border text-text-secondary hover:bg-bg-hover"
              )}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Visibility toggle. */}
      <button
        onClick={() => setHidden(tabId, columnName, !config.hidden)}
        className="flex items-center gap-2 rounded-sm border border-border px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover"
      >
        {config.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        {config.hidden ? "Hidden in grid — show column" : "Visible — hide column"}
      </button>
    </div>
  );
}

function Flag({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className={cn("font-mono", on ? "text-success" : "text-text-muted")}>
        {detail ?? (on ? "yes" : "no")}
      </dd>
    </div>
  );
}
