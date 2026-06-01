import { useCallback, useMemo } from "react";
import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  Theme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import type { CellValue, ColumnDef } from "@/ipc";
import { useThemeStore } from "@/store/theme";

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
  columns: ColumnDef[];
  rows: CellValue[][];
  sort?: SortState | null;
  /** Cycles asc -> desc -> none for the clicked column. */
  onSort?: (column: string) => void;
}

export function DataGrid({ columns, rows, sort, onSort }: DataGridProps) {
  // re-derive theme when app theme flips
  const theme = useThemeStore((s) => s.theme);
  const glide = useMemo(() => glideTheme(), [theme]);

  const gridColumns = useMemo<GridColumn[]>(
    () =>
      columns.map((c) => {
        const arrow = sort?.column === c.name ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
        return {
          title: c.name + arrow,
          id: c.name,
          width: colWidth(c),
          icon: c.primaryKey ? "headerRowID" : undefined,
        };
      }),
    [columns, sort]
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const def = columns[col];
      const raw = rows[row]?.[col];

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
        return {
          kind: GridCellKind.Number,
          data: Number.isFinite(num) ? num : undefined,
          displayData: String(raw),
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
    [columns, rows]
  );

  const onHeaderClicked = useCallback(
    (colIndex: number) => {
      const def = columns[colIndex];
      if (def && onSort) onSort(def.name);
    },
    [columns, onSort]
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
        keybindings={{ search: true }}
      />
    </div>
  );
}
