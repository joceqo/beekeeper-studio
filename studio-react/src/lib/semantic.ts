import type { ColumnStats, TopValue } from "@/ipc";
import { semanticType, type SemanticType } from "@/lib/relations";

/**
 * Semantic-type detection (reverse-engineered from SlashTable's
 * `inferSemanticType`, exact). The order of checks is load-bearing:
 *
 *   1. DB type short-circuit  — timestamp → date_relative; inet → ip; cidr →
 *      cidr; json → json.
 *   2. Value sampling         — first 10 of `stats.top_values`, ≥50% match
 *      thresholds (email/url/image_url/color/cidr/ip/phone).
 *   3. Column-name fallback   — `\bemail\b` → email; image-ish name → image_url.
 *
 * Returns the inferred {@link SemanticType}, or `null` when nothing matched (the
 * caller then falls back to the dataType-based {@link semanticType}). PK / FK /
 * relation precedence is handled by {@link resolveSemanticType}, not here, so
 * this stays a pure type sniffer.
 *
 * NOTE: the shared {@link SemanticType} folds `ip_address` into `cidr` (both use
 * the Network icon + octet/group highlighting), matching the icon map.
 */

// Value-sampling regexes (case-insensitive where the doc allows it).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)(\?|$)/i;
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Exclusions applied before the phone test.
const DATE_LIKE_RE = /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/;
const DECIMAL_RE = /\d+\.\d+/;
const PHONE_SHAPE_RE = /^[+\d][\d\s().+-]{6,}$/;

/** Take the first 10 sample strings (non-null) from a column's top values. */
function sampleStrings(topValues: TopValue[]): string[] {
  return topValues
    .slice(0, 10)
    .map((t) => t.value)
    .filter((v): v is string | number => v !== null && v !== undefined)
    .map((v) => String(v));
}

/** Fraction of `samples` that satisfy `pred`. */
function fractionMatching(samples: string[], pred: (s: string) => boolean): number {
  if (samples.length === 0) return 0;
  let n = 0;
  for (const s of samples) if (pred(s)) n++;
  return n / samples.length;
}

/** True when `s` is a dotted IPv4 address (four 0..255 octets). */
function isIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/** True when `s` is IPv4 CIDR notation (`a.b.c.d/n`, n in 0..32). */
function isCidr(s: string): boolean {
  const [addr, mask, ...rest] = s.split("/");
  if (rest.length || mask === undefined) return false;
  const m = Number(mask);
  return isIpv4(addr) && /^\d{1,2}$/.test(mask) && m >= 0 && m <= 32;
}

/** Count digits in a string (for the phone ≥7-digit threshold). */
function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

/**
 * Classify a column by its DB type and a sample of its values, following the
 * exact SlashTable check order. Returns `null` when no rule matched.
 */
export function inferSemanticType(
  columnName: string,
  stats: ColumnStats | undefined,
  dbType: string | undefined
): SemanticType | null {
  // 1. DB-type short-circuit.
  const t = (dbType ?? "").toLowerCase();
  if (/timestamp/.test(t) || /^time(stamp)?tz?$/.test(t)) return "date_relative";
  if (t === "inet") return "cidr"; // ip_address → Network icon
  if (t === "cidr") return "cidr";
  if (t.includes("json")) return "json";

  // 2. Value sampling (≥50% unless noted).
  const samples = sampleStrings(stats?.top_values ?? []);
  if (samples.length > 0) {
    // email
    if (fractionMatching(samples, (s) => EMAIL_RE.test(s)) >= 0.5) return "email";

    // url → image_url when ≥40% also look like image links.
    if (fractionMatching(samples, (s) => URL_RE.test(s)) >= 0.5) {
      if (fractionMatching(samples, (s) => IMAGE_URL_RE.test(s)) >= 0.4) return "image_url";
      return "url";
    }

    // color
    if (fractionMatching(samples, (s) => COLOR_RE.test(s)) >= 0.5) return "color";

    // cidr / ip_address (both → cidr in the shared type)
    if (fractionMatching(samples, isCidr) >= 0.5) return "cidr";
    if (fractionMatching(samples, isIpv4) >= 0.5) return "cidr";

    // phone — exclude date-like and decimal values first.
    if (
      fractionMatching(
        samples,
        (s) =>
          !DATE_LIKE_RE.test(s) &&
          !DECIMAL_RE.test(s) &&
          PHONE_SHAPE_RE.test(s) &&
          digitCount(s) >= 7
      ) >= 0.5
    ) {
      return "phone";
    }
  }

  // 3. Column-name fallback.
  const name = columnName.toLowerCase();
  if (/\bemail\b/.test(name)) return "email";
  if (/\b(image|img|avatar|photo|thumbnail|picture)(_url)?\b/.test(name)) return "image_url";

  return null;
}

/**
 * Resolve the effective semantic type of a column, combining (in priority):
 *   1. an explicit user override (TypePicker) — `"none"` disables formatting
 *      and resolves to plain `text`;
 *   2. PK / FK / relation structural roles (via {@link semanticType});
 *   3. value/name-based {@link inferSemanticType};
 *   4. the dataType fallback (via {@link semanticType}).
 */
export function resolveSemanticType(
  column: { name: string; dataType: string; primaryKey?: boolean; semanticType?: string },
  opts: {
    isFk?: boolean;
    isRelation?: boolean;
    stats?: ColumnStats;
    /** User override from the TypePicker: a SemanticType, or "none" to disable. */
    override?: SemanticType | "none";
  } = {}
): SemanticType {
  const { isFk = false, isRelation = false, stats, override } = opts;

  // Explicit override wins (except it can't fabricate a structural role).
  if (override === "none") return "text";
  if (override) return override;

  // Structural roles take precedence over value/dataType inference.
  if (column.primaryKey) return "pk";
  if (isFk) return "fk";
  if (isRelation) return "relation";

  // Value/name sniffing, then dataType fallback.
  const inferred = inferSemanticType(column.name, stats, column.dataType);
  if (inferred) return inferred;
  return semanticType(column, isFk, isRelation);
}
