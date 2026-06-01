import { useCallback, useMemo } from "react";
import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  GridSelection,
  Item,
  Theme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import type { CellValue, ColumnDef } from "@/ipc";
import type { RelationColumn } from "@/lib/relations";
import { useThemeStore } from "@/store/theme";
import { useColumnConfigStore, formatCellValue } from "@/store/columnConfig";

/** Read a CSS custom property off the document root. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function glideTheme(): Partial<Theme> {
  return {
    accentColor: token("--color-accent"),
    accentLight: token("--color-accent-subtle"),
    textDark: token("--color-text-primary"),
    textMedium: token("--color-text-secondary"),
    textLight: token("--color-text-muted"),
    textBubble: token("--color-text-primary"),
    bgIconHeader: token("--color-text-muted"),
    fgIconHeader: token("--color-bg-primary"),
    textHeader: token("--color-text-secondary"),
    textHeaderSelected: token("--color-text-on-accent"),
    bgCell: token("--color-bg-primary"),
    bgCellMedium: token("--color-bg-secondary"),
    bgHeader: token("--color-bg-secondary"),
    bgHeaderHasFocus: token("--color-bg-surface"),
    bgHeaderHovered: token("--color-bg-hover"),
    bgBubble: token("--color-bg-surface"),
    bgBubbleSelected: token("--color-bg-surface"),
    bgSearchResult: token("--color-accent-subtle"),
    borderColor: token("--color-border"),
    horizontalBorderColor: token("--color-border"),
    drilldownBorder: token("--color-border"),
    linkColor: token("--color-info"),
    cellHorizontalPadding: 10,
    cellVerticalPadding: 5,
    headerFontStyle: "600 12px",
    baseFontStyle: "12px",
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    editorFontSize: "12px",
  };
}

function isNumeric(c: ColumnDef): boolean {
  const t = c.dataType.toLowerCase();
  return (
    t.startsWith("int") ||
    t.startsWith("numeric") ||
    t.startsWith("decimal") ||
    t.startsWith("float") ||
    t.startsWith("double") ||
    t.startsWith("real") ||
    t === "int2" ||
    t === "int4" ||
    t === "int8" ||
    t === "bigint" ||
    t === "smallint" ||
    t === "money"
  );
}

function isBool(c: ColumnDef): boolean {
  const t = c.dataType.toLowerCase();
  return t === "bool" || t === "boolean" || t === "bit" || t === "tinyint(1)";
}

function colWidth(c: ColumnDef): number {
  if (c.primaryKey || isNumeric(c)) return 90;
  if (c.name.includes("email")) return 230;
  const t = c.dataType.toLowerCase();
  if (t.includes("timestamp") || t.includes("datetime")) return 180;
  if (isBool(c)) return 90;
  if (t.includes("uuid")) return 290;
  if (t.includes("json") || t === "text") return 240;
  return 160;
}

export type SortDirection = "asc" | "desc";
export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface DataGridProps {
  /** Owning tab id; scopes per-column config + selection. */
  tabId: string;
  columns: ColumnDef[];
  rows: CellValue[][];
  sort?: SortState | null;
  /** Cycles asc -> desc -> none for the clicked column. */
  onSort?: (column: string) => void;
  /** Fired with the selected row index (page-relative), or null when cleared. */
  onRowSelect?: (rowIndex: number | null) => void;
  /** Fired with the focused column name, or null when cleared. */
  onColumnSelect?: (columnName: string | null) => void;
  /** Virtual relation columns appended after the real data columns. */
  relations?: RelationColumn[];
  /** Per-row, per-relation child counts: rowIndex -> (relationId -> count). */
  relationCounts?: Map<number, Map<string, number>>;
  /** Fired when a relation chip is clicked, to drill into related rows. */
  onRelationClick?: (rowIndex: number, relation: RelationColumn) => void;
}

const REL_COL_PREFIX = "__rel__:";

export function DataGrid({
  tabId,
  columns,
  rows,
  sort,
  onSort,
  onRowSelect,
  onColumnSelect,
  relations = [],
  relationCounts,
  onRelationClick,
}: DataGridProps) {
  // re-derive theme when app theme flips
  const theme = useThemeStore((s) => s.theme);
  const glide = useMemo(() => glideTheme(), [theme]);

  // Per-column display config (format + visibility) for this tab.
  const configByKey = useColumnConfigStore((s) => s.byKey);
  const columnConfig = useCallback(
    (name: string) => configByKey[`${tabId}::${name}`] ?? { format: "text" as const, hidden: false },
    [configByKey, tabId]
  );

  // Visible columns map to original indices, so cell lookups stay correct.
  const visible = useMemo(
    () =>
      columns
        .map((c, originalIndex) => ({ c, originalIndex }))
        .filter(({ c }) => !columnConfig(c.name).hidden),
    [columns, columnConfig]
  );

  const gridColumns = useMemo<GridColumn[]>(() => {
    const dataCols: GridColumn[] = visible.map(({ c }) => {
      const arrow = sort?.column === c.name ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
      return {
        title: c.name + arrow,
        id: c.name,
        width: colWidth(c),
        icon: c.primaryKey ? "headerRowID" : undefined,
      };
    });
    // Relation columns are appended after the real data columns and visually
    // tagged with their cardinality (N:1 / 1:N) + a group, so they read as
    // navigation affordances rather than data.
    const relCols: GridColumn[] = relations.map((r) => ({
      title: `${r.cardinality === "1:N" ? "▸ " : "▴ "}${r.targetTable} (${r.cardinality})`,
      id: REL_COL_PREFIX + r.id,
      width: 160,
      themeOverride: {
        textHeader: token("--color-info"),
        bgHeader: token("--color-bg-surface"),
      },
    }));
    return [...dataCols, ...relCols];
  }, [visible, sort, relations]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      // Relation columns live after the real data columns.
      if (col >= visible.length) {
        const rel = relations[col - visible.length];
        if (rel) {
          const count = relationCounts?.get(row)?.get(rel.id);
          const label =
            rel.direction === "incoming"
              ? count != null
                ? `${rel.targetTable} · ${count}`
                : rel.targetTable
              : rel.targetTable;
          return {
            kind: GridCellKind.Bubble,
            data: [label],
            allowOverlay: false,
            themeOverride: {
              textBubble: token("--color-info"),
              bgBubble: token("--color-bg-surface"),
            },
          };
        }
      }

      const mapped = visible[col];
      const def = mapped?.c;
      const raw = mapped ? rows[row]?.[mapped.originalIndex] : undefined;
      const format = def ? columnConfig(def.name).format : "text";

      if (raw === null || raw === undefined) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "NULL",
          allowOverlay: false,
          themeOverride: {
            textDark: token("--color-text-muted"),
            baseFontStyle: "italic 12px",
          },
        };
      }
      if (typeof raw === "boolean" || (def && isBool(def))) {
        return {
          kind: GridCellKind.Boolean,
          data: typeof raw === "boolean" ? raw : raw === "true" || raw === 1,
          allowOverlay: false,
        };
      }
      if (typeof raw === "number" || (def && isNumeric(def))) {
        const num = typeof raw === "number" ? raw : Number(raw);
        const finite = Number.isFinite(num);
        return {
          kind: GridCellKind.Number,
          data: finite ? num : undefined,
          // Apply the per-column format (currency / percentage / thousands / …).
          displayData: finite ? formatCellValue(num, format) : String(raw),
          allowOverlay: true,
          contentAlign: "right",
        };
      }
      const text = String(raw);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: true,
      };
    },
    [visible, rows, columnConfig, relations, relationCounts]
  );

  const onHeaderClicked = useCallback(
    (colIndex: number) => {
      // Relation columns aren't sortable data columns; ignore header clicks.
      if (colIndex >= visible.length) return;
      const def = visible[colIndex]?.c;
      if (!def) return;
      onColumnSelect?.(def.name);
      if (onSort) onSort(def.name);
    },
    [visible, onSort, onColumnSelect]
  );

  const onCellClicked = useCallback(
    ([col, row]: Item) => {
      if (col < visible.length) return;
      const rel = relations[col - visible.length];
      if (rel) onRelationClick?.(row, rel);
    },
    [visible.length, relations, onRelationClick]
  );

  const onGridSelectionChange = useCallback(
    (sel: GridSelection) => {
      // A cell/row selection focuses a row for the detail panel.
      if (sel.current) {
        onRowSelect?.(sel.current.cell[1]);
      } else if (sel.rows.length > 0) {
        onRowSelect?.(sel.rows.first() ?? null);
      } else {
        onRowSelect?.(null);
      }
    },
    [onRowSelect]
  );

  return (
    <div className="gdg-wrapper">
      <DataEditor
        theme={glide}
        getCellContent={getCellContent}
        columns={gridColumns}
        rows={rows.length}
        rowMarkers="number"
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        getCellsForSelection
        onHeaderClicked={onHeaderClicked}
        onCellClicked={onCellClicked}
        onGridSelectionChange={onGridSelectionChange}
        keybindings={{ search: true }}
      />
    </div>
  );
}
