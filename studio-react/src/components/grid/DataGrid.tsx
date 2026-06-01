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
    fontFamily:
      '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    editorFontSize: "12px",
  };
}

function colWidth(c: ColumnDef): number {
  if (c.primaryKey || c.dataType.startsWith("int")) return 80;
  if (c.name.includes("email")) return 230;
  if (c.dataType.includes("timestamp")) return 180;
  if (c.dataType === "bool") return 90;
  return 160;
}

export interface DataGridProps {
  columns: ColumnDef[];
  rows: CellValue[][];
}

export function DataGrid({ columns, rows }: DataGridProps) {
  // re-derive theme when app theme flips
  const theme = useThemeStore((s) => s.theme);
  const glide = useMemo(() => glideTheme(), [theme]);

  const gridColumns = useMemo<GridColumn[]>(
    () =>
      columns.map((c) => ({
        title: c.name,
        id: c.name,
        width: colWidth(c),
        icon: c.primaryKey ? "headerRowID" : undefined,
      })),
    [columns]
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
          themeOverride: { textDark: token("--color-text-muted") },
        };
      }
      if (typeof raw === "boolean") {
        return {
          kind: GridCellKind.Boolean,
          data: raw,
          allowOverlay: false,
        };
      }
      if (typeof raw === "number" || def?.dataType.startsWith("int") || def?.dataType.startsWith("numeric")) {
        return {
          kind: GridCellKind.Number,
          data: typeof raw === "number" ? raw : Number(raw),
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
        keybindings={{ search: true }}
      />
    </div>
  );
}
