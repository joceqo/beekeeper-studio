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
import type { CellValue, ColumnDef, TableDescription } from "@/ipc";
import {
  parseRef,
  semanticType,
  type RelationColumn,
  type SemanticType,
} from "@/lib/relations";
import { useThemeStore } from "@/store/theme";
import { useColumnConfigStore, formatCellValue } from "@/store/columnConfig";
import { HEADER_ICONS, headerIconKey } from "./headerIcons";

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
    bgIconHeader: token("--color-bg-secondary"),
    fgIconHeader: token("--color-text-muted"),
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
    linkColor: token("--color-accent"),
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
  /** Fired when a relation cell is clicked, to drill into related rows. */
  onRelationClick?: (rowIndex: number, relation: RelationColumn) => void;
  /** describeTable result, for FK detection + semantic-type header icons (§4). */
  description?: TableDescription | null;
  /** Fired when an FK cell's value is clicked (§2), to drill into the parent row. */
  onFkClick?: (rowIndex: number, column: ColumnDef, value: CellValue) => void;
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
  description,
  onFkClick,
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

  // FK map: column name -> parsed reference. Drives FK links (§2) + the FK
  // semantic type for header icons (§4).
  const fkByColumn = useMemo(() => {
    const m = new Map<string, { schema?: string; table: string; column: string }>();
    for (const fk of description?.foreignKeys ?? []) {
      const ref = parseRef(fk.references);
      if (ref) m.set(fk.column, ref);
    }
    return m;
  }, [description]);

  // Visible columns map to original indices, so cell lookups stay correct.
  const visible = useMemo(
    () =>
      columns
        .map((c, originalIndex) => ({ c, originalIndex }))
        .filter(({ c }) => !columnConfig(c.name).hidden),
    [columns, columnConfig]
  );

  const semanticOf = useCallback(
    (c: ColumnDef): SemanticType => semanticType(c, fkByColumn.has(c.name)),
    [fkByColumn]
  );

  const gridColumns = useMemo<GridColumn[]>(() => {
    const dataCols: GridColumn[] = visible.map(({ c }) => {
      const arrow = sort?.column === c.name ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
      const sem = semanticOf(c);
      return {
        title: c.name + arrow,
        id: c.name,
        width: colWidth(c),
        // Custom header icon by semantic type (§4); FK uses the accent color.
        icon: headerIconKey(sem),
        themeOverride: sem === "fk" ? { fgIconHeader: token("--color-accent") } : undefined,
      };
    });
    // Relation columns are appended after the real data columns with a ↗ header
    // icon, so they read as navigation affordances rather than data.
    const relCols: GridColumn[] = relations.map((r) => ({
      title: r.targetTable,
      id: REL_COL_PREFIX + r.id,
      width: 170,
      icon: headerIconKey("relation"),
      themeOverride: {
        textHeader: token("--color-text-muted"),
        bgHeader: token("--color-bg-surface"),
        fgIconHeader: token("--color-accent"),
      },
    }));
    return [...dataCols, ...relCols];
  }, [visible, sort, relations, semanticOf]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      // Relation columns live after the real data columns. Each cell shows the
      // count for THAT row, e.g. `order_items (3)`; zero counts are dimmed (§1).
      if (col >= visible.length) {
        const rel = relations[col - visible.length];
        if (rel) {
          const count = relationCounts?.get(row)?.get(rel.id);
          const isZero = count === 0;
          const label = count != null ? `${rel.targetTable} (${count})` : rel.targetTable;
          return {
            kind: GridCellKind.Text,
            data: label,
            displayData: label,
            allowOverlay: false,
            cursor: isZero ? "default" : "pointer",
            themeOverride: {
              textDark: isZero ? token("--color-text-muted") : token("--color-accent"),
              baseFontStyle: "12px",
            },
          };
        }
      }

      const mapped = visible[col];
      const def = mapped?.c;
      const raw = mapped ? rows[row]?.[mapped.originalIndex] : undefined;
      const format = def ? columnConfig(def.name).format : "text";
      const isFk = def ? fkByColumn.has(def.name) : false;

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
      // FK value rendered as an accent-colored link with a trailing → (§2).
      if (isFk) {
        const text = String(raw);
        return {
          kind: GridCellKind.Text,
          data: text,
          displayData: `${text} →`,
          allowOverlay: false,
          cursor: "pointer",
          themeOverride: { textDark: token("--color-accent") },
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
    [visible, rows, columnConfig, relations, relationCounts, fkByColumn]
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
      // Relation cell → drill into related rows.
      if (col >= visible.length) {
        const rel = relations[col - visible.length];
        if (rel) onRelationClick?.(row, rel);
        return;
      }
      // FK cell → drill into the parent row (N:1).
      const mapped = visible[col];
      const def = mapped?.c;
      if (def && fkByColumn.has(def.name)) {
        const value = rows[row]?.[mapped.originalIndex];
        if (value !== null && value !== undefined) onFkClick?.(row, def, value);
      }
    },
    [visible, relations, onRelationClick, fkByColumn, rows, onFkClick]
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
        headerIcons={HEADER_ICONS}
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
