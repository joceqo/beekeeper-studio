import { useCallback, useMemo, useState } from "react";
import {
  Link2,
  Eye,
  EyeOff,
  X,
  Maximize2,
  RotateCcw,
  Plus,
  Trash2,
  AlertTriangle,
  Check,
} from "lucide-react";
import type { CellValue, ColumnDef, ColumnStats, TableDescription } from "@/ipc";
import { backend } from "@/ipc";
import { semanticType, type SemanticType } from "@/lib/relations";
import { inferSemanticType, resolveSemanticType } from "@/lib/semantic";
import { SemanticIcon, SEMANTIC_LUCIDE } from "@/components/grid/SemanticIcon";
import { jsonTokens } from "@/components/grid/semanticCells";
import { useTabsStore, type DrilldownCrumb } from "@/store/tabs";
import {
  useColumnConfigStore,
  FORMAT_LABELS,
  type ColumnFormat,
  type SemanticOverride,
} from "@/store/columnConfig";
import {
  usePendingEditsStore,
  compilePreviewSql,
  editKey,
  type PendingEdit,
} from "@/store/pendingEdits";
import { fillBars, type FillInfo } from "@/store/fillStats";
import {
  cn,
  IconButton,
  Button,
  Input,
  SegmentedControl,
  Dialog,
  Select,
  type SelectOption,
} from "@/ui";

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
  /** Per-column value stats, for inferred semantic type shown in the TypePicker. */
  stats?: Map<string, ColumnStats>;
  /** Per-column completeness (fill rate), shown in the column detail. */
  fill?: Map<string, FillInfo>;
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

/** Is this column an array type (`text[]`, `int[]`, `_uuid`, `ARRAY`)? */
function isArrayType(c: ColumnDef): boolean {
  const t = c.dataType.toLowerCase();
  return t.endsWith("[]") || t.startsWith("_") || t.includes("array");
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
  stats,
  fill,
  onClose,
}: Props) {
  const openTable = useTabsStore((s) => s.openTable);
  const openRelation = useTabsStore((s) => s.openRelation);
  const fks = useMemo(() => fkMap(description), [description]);

  // Find this row's PK value, to anchor the breadcrumb origin crumb + target
  // staged edits to a row (the UPDATE's WHERE).
  const pkIndex = columns.findIndex((c) => c.primaryKey);
  const pkColumn = pkIndex >= 0 ? columns[pkIndex]?.name ?? null : null;
  const originKey = row && pkIndex >= 0 ? row[pkIndex] : null;

  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {mode === "column" ? "Column" : mode === "row" ? "Row" : "Details"}
      </span>
      <IconButton className="ml-auto" aria-label="Close detail panel" onClick={onClose}>
        <X size={13} />
      </IconButton>
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
        stats={stats?.get(columnName)}
        fill={fill?.get(columnName)}
      />
    );
  } else if (mode === "row" && row) {
    body = (
      <RowDetail
        tabId={tabId}
        connectionId={connectionId}
        schema={schema ?? "public"}
        table={table ?? ""}
        columns={columns}
        row={row}
        rowIndex={rowIndex}
        fks={fks}
        pkColumn={pkColumn}
        pkValue={originKey}
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

// --- Row detail (editable key -> value form) --------------------------------

function RowDetail({
  tabId,
  connectionId,
  schema,
  table,
  columns,
  row,
  rowIndex,
  fks,
  pkColumn,
  pkValue,
  onFollowFk,
}: {
  tabId: string;
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnDef[];
  row: CellValue[];
  rowIndex: number | null;
  fks: Map<string, string>;
  pkColumn: string | null;
  pkValue: CellValue;
  onFollowFk: (
    parsed: { schema?: string; table: string; column: string },
    value: CellValue
  ) => void;
}) {
  const byKey = usePendingEditsStore((s) => s.byKey);
  const stage = usePendingEditsStore((s) => s.stage);
  const revert = usePendingEditsStore((s) => s.revert);

  // Staged edits for THIS row (matched on tab + pk value).
  const rowEdits = useMemo(
    () =>
      Object.values(byKey).filter(
        (e) => e.tabId === tabId && String(e.pkValue) === String(pkValue)
      ),
    [byKey, tabId, pkValue]
  );
  const stagedByColumn = useMemo(() => {
    const m = new Map<string, PendingEdit>();
    for (const e of rowEdits) m.set(e.column, e);
    return m;
  }, [rowEdits]);

  // Writes need a PK to build a safe WHERE; without one, fields are read-only.
  const editable = pkColumn != null && pkValue !== null && pkValue !== undefined;

  const onChange = useCallback(
    (column: ColumnDef, newValue: CellValue, originalValue: CellValue) => {
      if (!editable || pkColumn == null) return;
      stage({
        tabId,
        schema,
        table,
        pkColumn,
        pkValue,
        column: column.name,
        originalValue,
        newValue,
      });
    },
    [editable, pkColumn, pkValue, schema, table, tabId, stage]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {rowIndex != null && (
          <div className="px-3 py-2 font-mono text-xs text-text-muted">
            row #{rowIndex + 1}
            {!editable && (
              <span className="ml-2 text-text-muted">
                · no primary key — read-only
              </span>
            )}
          </div>
        )}
        <dl className="flex flex-col">
          {columns.map((c, i) => {
            const original = row[i];
            const ref = fks.get(c.name);
            const staged = stagedByColumn.get(c.name);
            const dirty = staged != null;
            const value = dirty ? staged.newValue : original;
            const sem = semanticType(c, !!ref);
            return (
              <div
                key={c.name}
                className={cn(
                  "flex flex-col gap-1 border-b border-border/60 px-3 py-1.5 transition-colors duration-100 ease-out",
                  dirty && "bg-accent-subtle/40"
                )}
              >
                <dt className="flex items-center gap-1.5">
                  <SemanticIcon type={sem} />
                  <span className="font-mono text-xs text-text-secondary">{c.name}</span>
                  {dirty && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-accent"
                      title="Unsaved change"
                    />
                  )}
                  <span className="ml-auto font-mono text-[10px] text-text-muted">
                    {c.dataType}
                  </span>
                  {dirty && (
                    <IconButton
                      aria-label={`Revert ${c.name}`}
                      title="Revert this change"
                      onClick={() => revert(tabId, pkValue, c.name)}
                    >
                      <RotateCcw size={12} />
                    </IconButton>
                  )}
                </dt>
                <dd className="font-mono text-md break-words text-text-primary">
                  <FieldEditor
                    column={c}
                    sem={sem}
                    value={value}
                    fkRef={ref ?? null}
                    editable={editable}
                    onChange={(v) => onChange(c, v, original)}
                    onFollowFk={onFollowFk}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <CommitBar tabId={tabId} connectionId={connectionId} />
    </div>
  );
}

// --- Per-type field editors -------------------------------------------------

function FieldEditor({
  column,
  sem,
  value,
  fkRef,
  editable,
  onChange,
  onFollowFk,
}: {
  column: ColumnDef;
  sem: SemanticType;
  value: CellValue;
  fkRef: string | null;
  editable: boolean;
  onChange: (value: CellValue) => void;
  onFollowFk: (
    parsed: { schema?: string; table: string; column: string },
    value: CellValue
  ) => void;
}) {
  // FK values stay clickable links (drilldown), not editable here.
  if (fkRef) {
    return <FkLink value={value} reference={fkRef} onFollowFk={onFollowFk} />;
  }

  // Read-only (e.g. a table with no primary key): still render an input per
  // field so empty/NULL values show as an (empty) box instead of a blank gap —
  // it just can't be typed into. The "read-only" notice lives in the header.
  if (!editable) {
    const isNull = value === null || value === undefined;
    const display = isNull ? "" : String(value);
    // Distinguish NULL from an empty string '' — both render as an empty box,
    // so the placeholder carries the distinction.
    const placeholder = isNull ? "NULL" : display === "" ? "'' (empty)" : undefined;
    return (
      <Input
        size="sm"
        readOnly
        tabIndex={-1}
        title={isNull ? "NULL" : display === "" ? "empty string ''" : display}
        value={display}
        placeholder={placeholder}
        className="cursor-default bg-bg-secondary text-text-secondary focus:border-border focus:ring-0"
      />
    );
  }

  // bool → true / false / null segmented control.
  if (sem === "bool") {
    const current =
      value === null || value === undefined
        ? "null"
        : value === true || value === "true" || value === 1
          ? "true"
          : "false";
    return (
      <SegmentedControl<"true" | "false" | "null">
        aria-label={`${column.name} value`}
        value={current}
        onValueChange={(v) => onChange(v === "null" ? null : v === "true")}
        items={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
          { value: "null", label: "null" },
        ]}
      />
    );
  }

  // array → multi-value editor.
  if (isArrayType(column)) {
    return <ArrayEditor value={value} onChange={onChange} />;
  }

  // json / code → mono inline + popout dialog editor.
  if (sem === "json" || sem === "code") {
    return <ValueEditor column={column} value={value} onChange={onChange} mono />;
  }

  // color → swatch + hex input.
  if (sem === "color") {
    return <ColorEditor value={value} onChange={onChange} />;
  }

  // number → numeric Input.
  if (sem === "number" || sem === "currency" || sem === "percentage") {
    return (
      <Input
        size="sm"
        type="number"
        value={value === null || value === undefined ? "" : String(value)}
        placeholder="NULL"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    );
  }

  // text default → inline input + popout editor (matches SlashTable).
  return <ValueEditor column={column} value={value} onChange={onChange} />;
}

/** Simple multi-value array editor: one Input per element + add/remove. */
function ArrayEditor({
  value,
  onChange,
}: {
  value: CellValue;
  onChange: (value: CellValue) => void;
}) {
  const items = useMemo(() => parseArray(value), [value]);
  const setItems = (next: string[]) => onChange(formatArray(next));
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 && (
        <span className="italic text-text-muted">empty array</span>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            size="sm"
            value={item}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              setItems(next);
            }}
          />
          <IconButton
            aria-label="Remove item"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
          >
            <Trash2 size={12} />
          </IconButton>
        </div>
      ))}
      <Button
        variant="subtle"
        size="sm"
        className="justify-start"
        onClick={() => setItems([...items, ""])}
      >
        <Plus size={12} /> Add item
      </Button>
    </div>
  );
}

/** Parse an array literal/string into a string[]. Best-effort. */
function parseArray(value: CellValue): string[] {
  if (value === null || value === undefined || value === "") return [];
  const s = String(value).trim();
  // JSON array form.
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s) as unknown[];
      if (Array.isArray(arr)) return arr.map((v) => String(v));
    } catch {
      /* fall through */
    }
  }
  // Postgres `{a,b,c}` form.
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
  }
  return s.split(",").map((p) => p.trim());
}

/** Render a string[] back as a Postgres array literal `{a,b,c}`. */
function formatArray(items: string[]): string {
  const escaped = items.map((i) => {
    if (/[,{}"\s]/.test(i)) return `"${i.replace(/"/g, '\\"')}"`;
    return i;
  });
  return `{${escaped.join(",")}}`;
}

/** json/code editor: a pencil opens a Dialog with a textarea + validation. */
/** Tailwind text color per JSON token class, matching the grid's jsonRenderer. */
const JSON_TOKEN_CLASS: Record<string, string> = {
  key: "text-accent",
  string: "text-success",
  num: "text-warning",
  bool: "text-danger",
  punct: "text-text-muted",
  text: "text-text-secondary",
};

/** Syntax-highlighted, truncated JSON preview (same tokens as the grid cell). */
function HighlightedJson({ value, limit = 120 }: { value: string; limit?: number }) {
  const tokens = jsonTokens(value);
  const out: React.ReactNode[] = [];
  let used = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (used >= limit) {
      out.push(<span key="more" className="text-text-muted">…</span>);
      break;
    }
    const t = tokens[i];
    const text = used + t.text.length > limit ? t.text.slice(0, limit - used) : t.text;
    used += t.text.length;
    out.push(
      <span key={i} className={JSON_TOKEN_CLASS[t.cls] ?? "text-text-secondary"}>
        {text}
      </span>
    );
  }
  return <>{out}</>;
}

/**
 * Inline value editor with a popout modal — mirrors SlashTable's EditorBody
 * (inline edit, Maximize-to-modal, Set NULL). `mono` renders a syntax-highlighted
 * preview inline for json/code; plain text edits directly in the inline input.
 */
function ValueEditor({
  column,
  value,
  onChange,
  mono = false,
}: {
  column: ColumnDef;
  value: CellValue;
  onChange: (value: CellValue) => void;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isNull = value === null || value === undefined;
  const text = isNull ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Show the highlighted preview only for non-empty json/code; otherwise edit
  // directly in the inline input.
  const showPreview = mono && text !== "";

  return (
    <div className="flex items-start gap-1">
      {showPreview ? (
        <code className="min-w-0 flex-1 break-words rounded-sm bg-bg-secondary px-1.5 py-1 font-mono text-xs text-text-secondary">
          <HighlightedJson value={text} limit={120} />
        </code>
      ) : (
        <Input
          size="sm"
          className={cn("min-w-0 flex-1", mono && "font-mono")}
          placeholder="NULL"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <IconButton
        aria-label={`Edit ${column.name}`}
        title="Edit in a larger editor"
        onClick={() => {
          setDraft(text);
          setJsonError(null);
          setOpen(true);
        }}
      >
        <Maximize2 size={12} />
      </IconButton>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Edit ${column.name}`}
        description={column.dataType}
        footer={
          <>
            <Button
              variant="subtle"
              size="sm"
              className="mr-auto"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Set NULL
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onChange(draft === "" ? null : draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        <textarea
          className="h-64 w-full resize-none rounded-sm border border-border bg-bg-primary px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            // Validate JSON shape for json columns (advisory only).
            if (column.dataType.toLowerCase().includes("json") && e.target.value.trim()) {
              try {
                JSON.parse(e.target.value);
                setJsonError(null);
              } catch (err) {
                setJsonError(err instanceof Error ? err.message : "Invalid JSON");
              }
            } else {
              setJsonError(null);
            }
          }}
        />
        {jsonError && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle size={12} /> {jsonError}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** color editor: a swatch + a hex Input. */
function ColorEditor({
  value,
  onChange,
}: {
  value: CellValue;
  onChange: (value: CellValue) => void;
}) {
  const hex = value === null || value === undefined ? "" : String(value);
  const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-5 w-5 shrink-0 rounded-sm border border-border"
        style={{ background: valid ? hex : "transparent" }}
        title={valid ? hex : "no color"}
      />
      <Input
        size="sm"
        value={hex}
        placeholder="#rrggbb"
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
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
  if (value === null || value === undefined) return <NullValue />;
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

// --- Commit bar + preview dialog (preview → confirm → commit) ---------------

function CommitBar({ tabId, connectionId }: { tabId: string; connectionId: string }) {
  const byKey = usePendingEditsStore((s) => s.byKey);
  const revertTab = usePendingEditsStore((s) => s.revertTab);
  const clearKeys = usePendingEditsStore((s) => s.clearKeys);

  // Recompute from byKey so the bar reacts to staging/revert.
  const edits = useMemo(
    () => Object.values(byKey).filter((e) => e.tabId === tabId),
    [byKey, tabId]
  );

  const [open, setOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const previewSql = useMemo(() => compilePreviewSql(edits), [edits]);
  const count = edits.length;

  const onCommit = useCallback(async () => {
    setCommitting(true);
    setError(null);
    try {
      // Run each statement; surface the first failure inline.
      const statements = previewSql.split("\n").filter((s) => s.trim() !== "");
      for (const sql of statements) {
        await backend.executeWrite(connectionId, sql);
      }
      // Drop the committed edits.
      clearKeys(edits.map((e) => editKey(e.tabId, e.pkValue, e.column)));
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setOpen(false);
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }, [previewSql, connectionId, clearKeys, edits]);

  if (count === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-secondary px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        {count} unsaved {count === 1 ? "change" : "changes"}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="subtle"
          size="sm"
          onClick={() => revertTab(tabId)}
          title="Discard all staged changes"
        >
          <RotateCcw size={12} /> Revert all
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            setDone(false);
            setOpen(true);
          }}
        >
          Review changes
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!committing) setOpen(o);
        }}
        title="Review changes"
        description={`${count} ${count === 1 ? "row" : "rows"} will be updated`}
        className="max-w-2xl"
        footer={
          <>
            <Button
              variant="subtle"
              size="sm"
              disabled={committing}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={committing || done} onClick={onCommit}>
              {done ? (
                <>
                  <Check size={13} /> Committed
                </>
              ) : committing ? (
                "Committing…"
              ) : (
                "Commit"
              )}
            </Button>
          </>
        }
      >
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Generated SQL
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-bg-primary p-3 font-mono text-xs text-text-primary">
          {previewSql}
        </pre>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Commit failed</div>
              <div className="mt-0.5 break-words font-mono">{error}</div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// --- Column detail ----------------------------------------------------------

const FORMATS: ColumnFormat[] = ["text", "number", "currency", "percentage", "thousands"];

/** TypePicker options: "auto" (use inferred), "none" (disable), then each type. */
const SEMANTIC_TYPES: SemanticType[] = [
  "text",
  "number",
  "currency",
  "percentage",
  "date_relative",
  "bool",
  "email",
  "phone",
  "url",
  "image_url",
  "json",
  "code",
  "color",
  "rating",
  "cidr",
];

const TYPE_LABELS: Record<SemanticType, string> = {
  pk: "Primary key",
  fk: "Foreign key",
  relation: "Relation",
  bool: "Boolean",
  cidr: "IP / CIDR",
  code: "Code",
  color: "Color",
  currency: "Currency",
  date_relative: "Relative date",
  email: "Email",
  image_url: "Image",
  json: "JSON",
  number: "Number",
  percentage: "Percentage",
  phone: "Phone",
  rating: "Rating",
  url: "URL",
  text: "Text",
};

/** A small leading icon + label for a TypePicker option. */
function typeOptionLabel(type: SemanticType): React.ReactNode {
  const Icon = SEMANTIC_LUCIDE[type];
  return (
    <span className="flex items-center gap-1.5">
      <Icon size={12} className="text-text-muted" />
      {TYPE_LABELS[type]}
    </span>
  );
}

/** Inline 3-bar fill glyph + label for the column detail (mirrors the header). */
function CompletenessBars({ fill }: { fill: FillInfo }) {
  const lit = fillBars(fill.ratio);
  const pct = Math.round(fill.ratio * 100);
  const basis =
    fill.basis === "sample"
      ? `~${pct}% filled · ${fill.seen}-row sample`
      : `${pct}% filled · ${fill.filled}/${fill.seen} loaded`;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5" title={basis}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-3 w-1", i < lit ? "bg-accent" : "bg-text-muted/30")}
          />
        ))}
      </div>
      <span className="font-mono text-text-secondary">{pct}%</span>
      <span className="text-xs text-text-muted">
        {fill.basis === "sample" ? "sampled" : `${fill.filled}/${fill.seen} loaded`}
      </span>
    </div>
  );
}

function ColumnDetail({
  tabId,
  column,
  columnName,
  fkRef,
  stats,
  fill,
}: {
  tabId: string;
  column: ColumnDef | null;
  columnName: string;
  fkRef: string | null;
  stats?: ColumnStats;
  fill?: FillInfo;
}) {
  const config = useColumnConfigStore((s) => s.byKey[`${tabId}::${columnName}`]) ?? {
    format: "text" as ColumnFormat,
    hidden: false,
  };
  const setFormat = useColumnConfigStore((s) => s.setFormat);
  const setHidden = useColumnConfigStore((s) => s.setHidden);
  const setSemanticType = useColumnConfigStore((s) => s.setSemanticType);

  const isFk = !!fkRef;
  // The type the grid would use absent an override (PK/FK/relation, then value
  // inference, then dataType fallback) — shown as the "auto" default.
  const inferred: SemanticType = column
    ? resolveSemanticType(column, { isFk, stats })
    : "text";
  // The value/name-only inference (ignores structural roles), for the hint.
  const valueInferred = column
    ? inferSemanticType(column.name, stats, column.dataType)
    : null;
  const override = config.semanticType;
  const resolved: SemanticType = column
    ? resolveSemanticType(column, { isFk, stats, override })
    : "text";

  // Picker value: "auto" when no override, else the override ("none" or a type).
  const pickerValue: "auto" | SemanticOverride = override ?? "auto";
  const pickerItems: SelectOption<"auto" | SemanticOverride>[] = [
    { value: "auto", label: <span>Auto ({TYPE_LABELS[inferred]})</span> },
    { value: "none", label: <span className="text-text-muted">None (disable)</span> },
    ...SEMANTIC_TYPES.map((t) => ({ value: t, label: typeOptionLabel(t) })),
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="flex items-center gap-1.5">
          {column && <SemanticIcon type={resolved} size={12} />}
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

      {/* Completeness (fill rate) — how many rows have a non-null, non-empty
          value. From a whole-table sample (Postgres) or the loaded rows. */}
      {fill && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Completeness
          </div>
          <CompletenessBars fill={fill} />
        </div>
      )}

      {/* Semantic-type override (TypePicker). "Auto" uses the inferred type;
          "None" disables semantic rendering for this column. Persisted per
          column in the columnConfig store. */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Semantic type
        </div>
        <Select<"auto" | SemanticOverride>
          aria-label="Semantic type"
          value={pickerValue}
          items={pickerItems}
          triggerClassName="w-full"
          onValueChange={(v) =>
            setSemanticType(tabId, columnName, v === "auto" ? undefined : v)
          }
        />
        {valueInferred && override === undefined && (
          <div className="mt-1 text-xs text-text-muted">
            Detected from values: {TYPE_LABELS[valueInferred]}
          </div>
        )}
      </div>

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
      <Button
        variant="subtle"
        size="sm"
        className="justify-start"
        onClick={() => setHidden(tabId, columnName, !config.hidden)}
      >
        {config.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        {config.hidden ? "Hidden in grid — show column" : "Visible — hide column"}
      </Button>
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
