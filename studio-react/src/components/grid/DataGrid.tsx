import { useCallback, useMemo, useState } from "react";
import DataEditor, {
  CompactSelection,
  GridCell,
  GridCellKind,
  GridColumn,
  GridSelection,
  GridMouseEventArgs,
  Item,
  Rectangle,
  Theme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  ArrowUpAZ,
  ArrowDownAZ,
  Filter,
  Copy,
  Type as TypeIcon,
  EyeOff,
  SlidersHorizontal,
} from "lucide-react";
import type { CellValue, ColumnDef, ColumnStats, TableDescription } from "@/ipc";
import {
  parseRef,
  type RelationColumn,
  type SemanticType,
} from "@/lib/relations";
import { resolveSemanticType } from "@/lib/semantic";
import { fillBars, type FillInfo } from "@/store/fillStats";
import { useThemeStore } from "@/store/theme";
import { useColumnConfigStore, formatCellValue } from "@/store/columnConfig";
import { HEADER_ICONS, headerIconKey } from "./headerIcons";
import { AnchoredMenu, type MenuEntry } from "@/ui";
import {
  SEMANTIC_RENDERERS,
  formatSemanticValue,
  linkHrefFor,
  type ColorCell,
  type RatingCell,
  type JsonCell,
} from "./semanticCells";
import { ImagePreviewCard } from "./ImagePreviewCard";

/** Read a CSS custom property off the document root. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function glideTheme(): Partial<Theme> {
  return {
    // Active-cell border: a bright, full-opacity accent so the clicked cell has
    // a clearly colored outline (Glide draws the active-cell ring with this).
    accentColor: token("--color-accent-hover"),
    // Selection fill kept light (~15% alpha) so the bright border reads as a
    // distinct outline rather than blending into a solid block.
    accentLight: token("--color-accent") + "26",
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

// --- Header fill-bar glyph geometry (shared by width calc + drawHeader) ------
// One source of truth so the column width reserves exactly the space drawHeader
// uses, and the title never collides with the glyph or the hover menu chevron.
const BAR_W = 3;
const BAR_GAP = 2;
const BAR_COUNT = 3;
const BAR_GLYPH_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP; // 13px
const HEAD_PAD_LEFT = 34; // left pad + semantic icon + gap before the title
const HEAD_GAP = 10; // gap between the title and the glyph
const HEAD_MENU_RESERVE = 24; // room at the right for the hover menu chevron

/** Left x of the glyph for a header rect (right-anchored, clear of the menu). */
function glyphX0(rectX: number, width: number): number {
  return rectX + width - HEAD_MENU_RESERVE - BAR_GLYPH_W;
}

/** Measure header title width (cached 2D context), to size columns for the glyph. */
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureTitle(title: string): number {
  if (_measureCtx === null) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = '600 12px "Inter Variable", ui-sans-serif, system-ui, sans-serif';
    _measureCtx = ctx;
  }
  return _measureCtx ? _measureCtx.measureText(title).width : title.length * 7;
}

/** Column width wide enough for the title AND the fill-bar glyph + menu chevron. */
function colWidthWithGlyph(c: ColumnDef, title: string): number {
  const needed =
    HEAD_PAD_LEFT + measureTitle(title) + HEAD_GAP + BAR_GLYPH_W + HEAD_MENU_RESERVE + 4;
  return Math.max(colWidth(c), Math.ceil(needed));
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
  /**
   * Column-header context-menu actions (Agent C). When supplied, data-column
   * headers gain a menu indicator (right-click / the header ⋮ open the menu).
   * Each handler receives the column it was invoked on.
   */
  onSortColumn?: (column: ColumnDef, direction: SortDirection) => void;
  onFilterColumn?: (column: ColumnDef) => void;
  onHideColumn?: (column: ColumnDef) => void;
  onConfigureColumn?: (column: ColumnDef) => void;
  /** Per-column value stats (top_values + nullFraction) for semantic inference. */
  stats?: Map<string, ColumnStats>;
  /** Per-column completeness (fill rate), drawn as a 3-bar glyph in the header. */
  fill?: Map<string, FillInfo>;
}

/** Write text to the clipboard, with a synchronous fallback. */
function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
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
  onSortColumn,
  onFilterColumn,
  onHideColumn,
  onConfigureColumn,
  stats,
  fill,
}: DataGridProps) {
  // re-derive theme when app theme flips
  const theme = useThemeStore((s) => s.theme);
  const glide = useMemo(() => glideTheme(), [theme]);

  // Controlled selection so Glide natively draws the active-cell accent ring and
  // tints a selected column's header (the mechanism SlashTable uses). A header
  // click selects the whole column; a cell click focuses that cell.
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    current: undefined,
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  });

  // Column-header context menu (Agent C): a controlled, point-anchored menu.
  const [headerMenu, setHeaderMenu] = useState<{
    column: ColumnDef;
    rect: { x: number; y: number; width?: number; height?: number };
  } | null>(null);
  const hasHeaderMenu =
    !!onSortColumn || !!onFilterColumn || !!onHideColumn || !!onConfigureColumn;

  // Hovered image cell, driving the full-size preview card (image_url).
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    x: number;
    y: number;
  } | null>(null);

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

  // Resolve a column's effective semantic type: explicit TypePicker override,
  // else PK/FK/relation role, else value/name inference (from stats), else the
  // dataType fallback. Shared by the header icon and the cell renderer.
  const semanticOf = useCallback(
    (c: ColumnDef): SemanticType =>
      resolveSemanticType(c, {
        isFk: fkByColumn.has(c.name),
        stats: stats?.get(c.name),
        override: columnConfig(c.name).semanticType,
      }),
    [fkByColumn, stats, columnConfig]
  );

  const gridColumns = useMemo<GridColumn[]>(() => {
    const dataCols: GridColumn[] = visible.map(({ c }) => {
      const arrow = sort?.column === c.name ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
      const sem = semanticOf(c);
      const title = c.name + arrow;
      // Only incomplete columns draw the glyph, so only they reserve room for it.
      const info = fill?.get(c.name);
      const showsGlyph = info != null && fillBars(info.ratio) < BAR_COUNT;
      return {
        title,
        id: c.name,
        width: showsGlyph ? colWidthWithGlyph(c, title) : colWidth(c),
        // Custom header icon by semantic type (§4); FK uses the accent color.
        icon: headerIconKey(sem),
        // A menu indicator (the ⋮) opens the column-header context menu (Agent C).
        hasMenu: hasHeaderMenu,
        // A selected column's header is tinted by Glide natively (gridSelection).
        themeOverride: sem === "fk" ? { fgIconHeader: token("--color-accent") } : undefined,
      };
    });
    // Relation columns are appended after the real data columns with a ↗ header
    // icon, so they read as navigation affordances rather than data.
    const relCols: GridColumn[] = relations.map((r) => ({
      // Collapsed M2M relations are labeled with the far table, not the junction.
      title: r.m2m ? r.m2m.farTable : r.targetTable,
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
  }, [visible, sort, relations, semanticOf, hasHeaderMenu, fill]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      // Relation columns live after the real data columns. Each cell shows the
      // count for THAT row, e.g. `order_items (3)`; zero counts are dimmed (§1).
      if (col >= visible.length) {
        const rel = relations[col - visible.length];
        if (rel) {
          const count = relationCounts?.get(row)?.get(rel.id);
          const isZero = count === 0;
          const target = rel.m2m ? rel.m2m.farTable : rel.targetTable;
          const label = count != null ? `${target} (${count})` : target;
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

      // Semantic-type rendering (color swatch, stars, links, image thumb, json
      // mono, Intl number/currency/%/relative-time). Falls through to the
      // dataType-based defaults below when the type has no special renderer.
      const sem: SemanticType | null = def ? semanticOf(def) : null;
      const text = String(raw);

      switch (sem) {
        case "color":
          return {
            kind: GridCellKind.Custom,
            allowOverlay: true,
            copyData: text,
            data: { kind: "semantic-color", color: text } as ColorCell["data"],
          } as ColorCell;
        case "rating": {
          const n = Number(raw);
          return {
            kind: GridCellKind.Custom,
            allowOverlay: true,
            copyData: text,
            data: {
              kind: "semantic-rating",
              rating: Number.isFinite(n) ? n : 0,
              max: 5,
            } as RatingCell["data"],
          } as RatingCell;
        }
        case "image_url":
          // Glide's built-in image cell renders a thumbnail; the hover preview
          // card is driven by onItemHovered.
          return {
            kind: GridCellKind.Image,
            data: [text],
            displayData: [text],
            allowOverlay: true,
            readonly: true,
          };
        case "email":
        case "phone":
        case "url":
          // Clickable link (mailto/tel/href); navigation in onCellClicked.
          return {
            kind: GridCellKind.Text,
            data: text,
            displayData: text,
            allowOverlay: true,
            cursor: "pointer",
            themeOverride: { textDark: token("--color-accent") },
          };
        case "json": {
          // Syntax-highlighted JSON drawn on the canvas (jsonRenderer). The full
          // value is editable in the ROW dock, which opens on cell click.
          return {
            kind: GridCellKind.Custom,
            allowOverlay: false,
            copyData: formatSemanticValue("json", text) ?? text,
            data: { kind: "semantic-json", value: text } as JsonCell["data"],
          } as JsonCell;
        }
        case "code": {
          return {
            kind: GridCellKind.Text,
            data: text,
            displayData: text,
            allowOverlay: true,
            themeOverride: {
              baseFontStyle: "12px",
              fontFamily:
                '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace',
            },
          };
        }
        case "cidr":
          return {
            kind: GridCellKind.Text,
            data: text,
            displayData: text,
            allowOverlay: true,
            themeOverride: {
              fontFamily:
                '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace',
            },
          };
        case "number":
        case "currency":
        case "percentage":
        case "date_relative": {
          const display = formatSemanticValue(sem, raw as string | number);
          if (display != null) {
            return {
              kind: GridCellKind.Text,
              data: text,
              displayData: display,
              allowOverlay: true,
              contentAlign: sem === "date_relative" ? "left" : "right",
            };
          }
          break;
        }
        default:
          break;
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
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: true,
      };
    },
    [visible, rows, columnConfig, relations, relationCounts, fkByColumn, semanticOf]
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

  // Open the column-header context menu, anchored to the header cell's bounds
  // (Glide gives screen-space `bounds` for the clicked header). Relation columns
  // have no menu.
  const onHeaderMenuClick = useCallback(
    (colIndex: number, bounds: Rectangle) => {
      if (!hasHeaderMenu) return;
      if (colIndex >= visible.length) return;
      const def = visible[colIndex]?.c;
      if (!def) return;
      onColumnSelect?.(def.name);
      setHeaderMenu({
        column: def,
        rect: { x: bounds.x, y: bounds.y + bounds.height, width: bounds.width },
      });
    },
    [hasHeaderMenu, visible, onColumnSelect]
  );

  // Build the menu entries for the focused header column.
  const headerMenuItems = useMemo<MenuEntry[]>(() => {
    const col = headerMenu?.column;
    if (!col) return [];
    const items: MenuEntry[] = [];
    if (onSortColumn) {
      items.push({
        label: "Sort ASC",
        icon: <ArrowUpAZ size={14} />,
        onSelect: () => onSortColumn(col, "asc"),
      });
      items.push({
        label: "Sort DESC",
        icon: <ArrowDownAZ size={14} />,
        onSelect: () => onSortColumn(col, "desc"),
      });
    }
    if (onFilterColumn) {
      items.push({
        label: "Filter…",
        icon: <Filter size={14} />,
        onSelect: () => onFilterColumn(col),
      });
    }
    if (items.length) items.push({ type: "separator" });
    items.push({
      label: "Copy Column Name",
      icon: <Copy size={14} />,
      onSelect: () => copyText(col.name),
    });
    items.push({
      label: "Copy Data Type",
      icon: <TypeIcon size={14} />,
      onSelect: () => copyText(col.dataType),
    });
    if (onHideColumn || onConfigureColumn) items.push({ type: "separator" });
    if (onHideColumn) {
      items.push({
        label: "Hide Column",
        icon: <EyeOff size={14} />,
        onSelect: () => onHideColumn(col),
      });
    }
    if (onConfigureColumn) {
      items.push({
        label: "Configure…",
        icon: <SlidersHorizontal size={14} />,
        onSelect: () => onConfigureColumn(col),
      });
    }
    return items;
  }, [headerMenu, onSortColumn, onFilterColumn, onHideColumn, onConfigureColumn]);

  // Draw the default header, then overlay a 3-bar "fill rate" signal glyph on the
  // right (how complete this column is — non-null & non-empty). Lit bars scale
  // with the filled fraction; skipped for relation columns and when no data yet.
  const drawHeader = useCallback(
    (
      args: {
        ctx: CanvasRenderingContext2D;
        column: GridColumn;
        rect: Rectangle;
        menuBounds: Rectangle;
        theme: Theme;
      },
      drawContent: () => void
    ) => {
      drawContent();
      if (!fill) return;
      const id = args.column.id;
      if (!id || id.startsWith(REL_COL_PREFIX)) return;
      const info = fill.get(id);
      if (!info) return;
      const lit = fillBars(info.ratio);
      // Only flag incomplete columns — a fully-filled column draws no glyph, so
      // the partial/empty ones stand out at a glance.
      if (lit === BAR_COUNT) return;
      const { ctx, rect } = args;
      const x0 = glyphX0(rect.x, rect.width);
      // Safety: if the column was resized so narrow the title would run under the
      // glyph, skip it (the column detail still shows completeness).
      const titleW = measureTitle(args.column.title ?? "");
      if (rect.x + HEAD_PAD_LEFT + titleW + HEAD_GAP > x0) return;
      const barH = 11;
      const top = rect.y + (rect.height - barH) / 2;
      const litColor = args.theme.accentColor ?? "#d95200";
      const dimColor = args.theme.textLight ?? "#9aa0a6";
      ctx.save();
      for (let i = 0; i < BAR_COUNT; i++) {
        if (i < lit) {
          ctx.fillStyle = litColor;
          ctx.globalAlpha = 0.95;
        } else {
          ctx.fillStyle = dimColor;
          ctx.globalAlpha = 0.3;
        }
        ctx.fillRect(x0 + i * (BAR_W + BAR_GAP), top, BAR_W, barH);
      }
      ctx.restore();
    },
    [fill]
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
        return;
      }
      // Link cells (email/phone/url) → open the corresponding URI.
      if (def) {
        const value = rows[row]?.[mapped.originalIndex];
        if (value !== null && value !== undefined) {
          const href = linkHrefFor(semanticOf(def), String(value));
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        }
      }
    },
    [visible, relations, onRelationClick, fkByColumn, rows, onFkClick, semanticOf]
  );

  // Hover preview for image_url cells: show a full-size card near the pointer.
  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind !== "cell") {
        setImagePreview(null);
        return;
      }
      const [col, row] = args.location;
      const mapped = col < visible.length ? visible[col] : undefined;
      const def = mapped?.c;
      const raw = mapped ? rows[row]?.[mapped.originalIndex] : undefined;
      if (def && raw != null && semanticOf(def) === "image_url") {
        const [px, py] = args.bounds ? [args.bounds.x, args.bounds.y] : [0, 0];
        setImagePreview({ url: String(raw), x: px, y: py });
      } else {
        setImagePreview(null);
      }
    },
    [visible, rows, semanticOf]
  );

  const onGridSelectionChange = useCallback(
    (sel: GridSelection) => {
      setGridSelection(sel);
      // A column selection (header click) focuses that column for the detail
      // panel; otherwise a cell/row selection focuses a row.
      if (sel.columns.length > 0) {
        const colIdx = sel.columns.first();
        const def = colIdx != null && colIdx < visible.length ? visible[colIdx]?.c : undefined;
        if (def) onColumnSelect?.(def.name);
      }
      if (sel.current) {
        onRowSelect?.(sel.current.cell[1]);
      } else if (sel.rows.length > 0) {
        onRowSelect?.(sel.rows.first() ?? null);
      } else if (sel.columns.length === 0) {
        onRowSelect?.(null);
      }
    },
    [onRowSelect, onColumnSelect, visible]
  );

  return (
    <div className="gdg-wrapper">
      <DataEditor
        theme={glide}
        headerIcons={HEADER_ICONS}
        customRenderers={SEMANTIC_RENDERERS}
        drawHeader={drawHeader}
        getCellContent={getCellContent}
        columns={gridColumns}
        rows={rows.length}
        rowMarkers="none"
        rowHeight={30}
        headerHeight={32}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        getCellsForSelection
        gridSelection={gridSelection}
        onHeaderClicked={onHeaderClicked}
        onHeaderMenuClick={hasHeaderMenu ? onHeaderMenuClick : undefined}
        onCellClicked={onCellClicked}
        onItemHovered={onItemHovered}
        onGridSelectionChange={onGridSelectionChange}
        keybindings={{ search: true }}
      />
      {hasHeaderMenu && (
        <AnchoredMenu
          open={headerMenu != null}
          onOpenChange={(o) => {
            if (!o) setHeaderMenu(null);
          }}
          anchorRect={headerMenu?.rect ?? null}
          items={headerMenuItems}
        />
      )}
      {imagePreview && (
        <ImagePreviewCard url={imagePreview.url} x={imagePreview.x} y={imagePreview.y} />
      )}
    </div>
  );
}
