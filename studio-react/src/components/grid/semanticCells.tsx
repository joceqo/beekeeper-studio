import {
  type CustomCell,
  type CustomRenderer,
  type DrawArgs,
  GridCellKind,
  getMiddleCenterBias,
} from "@glideapps/glide-data-grid";
import type { SemanticType } from "@/lib/relations";

/**
 * Glide custom-cell renderers for the semantic types that need canvas drawing
 * (a color swatch + hex, and a star rating). Everything else is rendered with
 * standard Glide cells (Text / Number / Image / Boolean) plus display
 * formatting from {@link formatSemanticValue} — keeping NULL styling, sort,
 * paging, and the FK/relation columns intact.
 */

// --- color swatch cell ------------------------------------------------------

interface ColorCellProps {
  readonly kind: "semantic-color";
  /** The raw hex string, e.g. "#ff5722". */
  readonly color: string;
}
export type ColorCell = CustomCell<ColorCellProps>;

export const colorRenderer: CustomRenderer<ColorCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is ColorCell =>
    (c.data as Partial<ColorCellProps>).kind === "semantic-color",
  draw: (args: DrawArgs<ColorCell>) => {
    const { ctx, theme, rect } = args;
    const { color } = args.cell.data;
    const pad = theme.cellHorizontalPadding;
    const size = 12;
    const x = rect.x + pad;
    const y = rect.y + rect.height / 2 - size / 2;
    // Swatch with a subtle border so light colors stay visible.
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 3);
    ctx.fill();
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Hex value to the right of the swatch.
    ctx.fillStyle = theme.textDark;
    ctx.font = theme.baseFontFull;
    ctx.textBaseline = "alphabetic";
    const ty = rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme);
    ctx.fillText(color, x + size + 6, ty);
    ctx.restore();
    return true;
  },
  provideEditor: undefined,
};

// --- rating (stars) cell ----------------------------------------------------

interface RatingCellProps {
  readonly kind: "semantic-rating";
  readonly rating: number;
  /** Max stars (default 5). */
  readonly max: number;
}
export type RatingCell = CustomCell<RatingCellProps>;

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  filled: boolean,
  fill: string,
  muted: string
) {
  const inner = outer * 0.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export const ratingRenderer: CustomRenderer<RatingCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is RatingCell =>
    (c.data as Partial<RatingCellProps>).kind === "semantic-rating",
  draw: (args: DrawArgs<RatingCell>) => {
    const { ctx, theme, rect } = args;
    const { rating, max } = args.cell.data;
    const pad = theme.cellHorizontalPadding;
    const outer = 6;
    const gap = 16;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    for (let i = 0; i < max; i++) {
      const cx = rect.x + pad + outer + i * gap;
      drawStar(ctx, cx, cy, outer, i < Math.round(rating), theme.accentColor, theme.textLight);
    }
    ctx.restore();
    return true;
  },
  provideEditor: undefined,
};

/** Custom renderers to register on the Glide DataEditor. */
export const SEMANTIC_RENDERERS = [colorRenderer, ratingRenderer];

// --- value formatting (for standard Text/Number cells) ----------------------

/** Locale number formatters, reused across cells. */
const NUM = new Intl.NumberFormat(undefined, { useGrouping: true });
const CURRENCY = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const PERCENT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });

const RELATIVE = (() => {
  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  } catch {
    return null;
  }
})();

/** Format an absolute date string/number as relative time (e.g. "3 days ago"). */
export function formatRelativeTime(value: string | number): string {
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return String(value);
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  if (!RELATIVE) return d.toISOString().slice(0, 19).replace("T", " ");
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === "second") {
      return RELATIVE.format(Math.round(diffSec / secs), unit);
    }
  }
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * The display string for a value under a given semantic type, for types
 * rendered with a standard Glide Text/Number cell. Returns `null` when the
 * type has no text formatting (handled by a custom cell or the default path).
 */
export function formatSemanticValue(type: SemanticType, raw: string | number): string | null {
  switch (type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? NUM.format(n) : String(raw);
    }
    case "currency": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? CURRENCY.format(n) : String(raw);
    }
    case "percentage": {
      const n = typeof raw === "number" ? raw : Number(raw);
      // Values are treated as fractions (0.42 -> 42%); whole numbers > 1 are
      // assumed already-percent and divided by 100.
      if (!Number.isFinite(n)) return String(raw);
      return PERCENT.format(Math.abs(n) > 1 ? n / 100 : n);
    }
    case "date_relative":
      return formatRelativeTime(raw);
    case "json": {
      // Compact, single-line preview for the cell (full value in the popout).
      try {
        return JSON.stringify(JSON.parse(String(raw)));
      } catch {
        return String(raw);
      }
    }
    default:
      return null;
  }
}

/** Whether a semantic type renders a clickable link (mailto/tel/url). */
export function linkHrefFor(type: SemanticType, raw: string): string | null {
  switch (type) {
    case "email":
      return `mailto:${raw}`;
    case "phone":
      return `tel:${raw.replace(/[^\d+]/g, "")}`;
    case "url":
      return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    default:
      return null;
  }
}
