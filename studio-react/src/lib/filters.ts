/**
 * Nested AND/OR filter model + read-only SQL WHERE compiler.
 *
 * The filter is a tree of {@link FilterNode}s: `group` nodes hold a combinator
 * (AND/OR), an optional `negate`, and children; `condition` nodes are leaves
 * pairing a column with a {@link FilterOp} and value(s). {@link compileWhere}
 * recurses the tree into a SQL WHERE fragment with correct nested parentheses,
 * AND/OR joins, NOT(...) wrapping, ILIKE for substring/prefix/suffix matches,
 * BETWEEN, IN (...), and IS [NOT] NULL.
 *
 * Identifier quoting and literal escaping mirror lib/relations.ts (the same
 * safe-embedding strategy the drilldown SELECTs use), so the compiled WHERE can
 * be appended to a SELECT and run through `executeQuery` read-only.
 *
 * Dialect-light: targets Postgres/MySQL/SQLite generically. ILIKE is
 * Postgres-only; for MySQL/SQLite the compiler falls back to LIKE (MySQL LIKE is
 * case-insensitive by default; SQLite LIKE is case-insensitive for ASCII).
 */

export type FilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "not_in"
  | "is_null"
  | "is_not_null";

export type Combinator = "AND" | "OR";

export interface FilterGroup {
  id: string;
  kind: "group";
  combinator: Combinator;
  negate?: boolean;
  children: FilterNode[];
}

export interface FilterCondition {
  id: string;
  kind: "condition";
  column: string;
  operator: FilterOp;
  /** Scalar value, or — for in/not_in — an array of values. Unused for null ops. */
  value?: unknown;
  /** Upper bound for `between`. */
  value2?: unknown;
}

export type FilterNode = FilterGroup | FilterCondition;

/** Operators that take no value input. */
export const NO_VALUE_OPS: ReadonlySet<FilterOp> = new Set(["is_null", "is_not_null"]);
/** Operators that take a second value input (a range). */
export const RANGE_OPS: ReadonlySet<FilterOp> = new Set(["between"]);
/** Operators whose value is a list. */
export const LIST_OPS: ReadonlySet<FilterOp> = new Set(["in", "not_in"]);

/** Human labels for operator selects. */
export const OP_LABELS: Record<FilterOp, string> = {
  equals: "=",
  not_equals: "≠",
  contains: "contains",
  not_contains: "not contains",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  in: "in",
  not_in: "not in",
  is_null: "is null",
  is_not_null: "is not null",
};

/** Ordered operator list for the operator `<select>`. */
export const OP_ORDER: FilterOp[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
];

let idCounter = 0;
/** Generate a stable-enough unique node id. */
export function newId(): string {
  idCounter += 1;
  return `f${Date.now().toString(36)}_${idCounter}`;
}

export function makeGroup(combinator: Combinator = "AND"): FilterGroup {
  return { id: newId(), kind: "group", combinator, children: [] };
}

export function makeCondition(column = ""): FilterCondition {
  return { id: newId(), kind: "condition", column, operator: "equals", value: "" };
}

/** Flatten all condition leaves in display order. */
export function listConditions(node: FilterNode | null): FilterCondition[] {
  if (!node) return [];
  if (node.kind === "condition") return [node];
  return node.children.flatMap((child) => listConditions(child));
}

/** Short human-readable value for compact filter chips. */
function formatChipValue(v: unknown): string {
  if (v === null) return "NULL";
  if (v === undefined || v === "") return "…";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "…";
  return String(v);
}

/** Label for one condition in the compact chip bar. */
export function conditionLabel(condition: FilterCondition): string {
  const column = condition.column || "column";
  const op = OP_LABELS[condition.operator];
  if (NO_VALUE_OPS.has(condition.operator)) return `${column} ${op}`;
  if (condition.operator === "between") {
    return `${column} ${op} ${formatChipValue(condition.value)} and ${formatChipValue(
      condition.value2
    )}`;
  }
  return `${column} ${op} ${formatChipValue(condition.value)}`;
}

// --- escaping (mirrors lib/relations.ts) ------------------------------------

/** Quote a SQL identifier (double-quote, doubling embedded quotes). */
export function ident(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Embed a scalar as a SQL literal. Booleans → TRUE/FALSE, finite numbers bare,
 * numeric strings bare, null → NULL, everything else single-quoted (doubling
 * embedded quotes). Mirrors `sqlLiteral` in lib/relations.ts.
 */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  const s = String(v);
  // Treat clean numeric strings as numbers so `amount > 100` stays unquoted.
  if (s.trim() !== "" && /^-?\d+(\.\d+)?$/.test(s.trim())) return s.trim();
  return `'${s.replace(/'/g, "''")}'`;
}

/** Single-quote a value as a text literal (always quoted; used for LIKE patterns). */
function textLiteral(v: unknown): string {
  if (v === null || v === undefined) return "''";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Escape LIKE metacharacters in user input so `%`/`_`/`\` are literal. */
function escapeLikePattern(v: unknown): string {
  return String(v ?? "").replace(/([\\%_])/g, "\\$1");
}

/** Split a list value (array or CSV string) into trimmed, non-empty parts. */
export function listValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v !== "");
  }
  if (value === null || value === undefined) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

export interface CompileOptions {
  /**
   * SQL dialect. Controls case-insensitive matching: `postgres` uses ILIKE,
   * others fall back to LIKE. Defaults to `postgres`.
   */
  dialect?: "postgres" | "mysql" | "sqlite";
}

/**
 * Compile one condition leaf into a SQL boolean expression, or null when the
 * condition is incomplete (no column, or a value-requiring op with no value).
 */
function compileCondition(c: FilterCondition, dialect: string): string | null {
  if (!c.column) return null;
  const col = ident(c.column);
  const like = dialect === "postgres" ? "ILIKE" : "LIKE";
  const hasValue = c.value !== undefined && c.value !== "";

  switch (c.operator) {
    case "is_null":
      return `${col} IS NULL`;
    case "is_not_null":
      return `${col} IS NOT NULL`;

    case "equals":
      if (!hasValue) return null;
      return `${col} = ${sqlLiteral(c.value)}`;
    case "not_equals":
      if (!hasValue) return null;
      return `${col} <> ${sqlLiteral(c.value)}`;

    case "gt":
      if (!hasValue) return null;
      return `${col} > ${sqlLiteral(c.value)}`;
    case "gte":
      if (!hasValue) return null;
      return `${col} >= ${sqlLiteral(c.value)}`;
    case "lt":
      if (!hasValue) return null;
      return `${col} < ${sqlLiteral(c.value)}`;
    case "lte":
      if (!hasValue) return null;
      return `${col} <= ${sqlLiteral(c.value)}`;

    case "contains":
      if (!hasValue) return null;
      return `${col} ${like} ${textLiteral(`%${escapeLikePattern(c.value)}%`)} ESCAPE '\\'`;
    case "not_contains":
      if (!hasValue) return null;
      return `${col} NOT ${like} ${textLiteral(`%${escapeLikePattern(c.value)}%`)} ESCAPE '\\'`;
    case "starts_with":
      if (!hasValue) return null;
      return `${col} ${like} ${textLiteral(`${escapeLikePattern(c.value)}%`)} ESCAPE '\\'`;
    case "ends_with":
      if (!hasValue) return null;
      return `${col} ${like} ${textLiteral(`%${escapeLikePattern(c.value)}`)} ESCAPE '\\'`;

    case "between": {
      if (
        c.value === undefined ||
        c.value === "" ||
        c.value2 === undefined ||
        c.value2 === ""
      )
        return null;
      return `${col} BETWEEN ${sqlLiteral(c.value)} AND ${sqlLiteral(c.value2)}`;
    }

    case "in":
    case "not_in": {
      const parts = listValues(c.value);
      if (parts.length === 0) return null;
      const list = parts.map((p) => sqlLiteral(p)).join(", ");
      return `${col} ${c.operator === "not_in" ? "NOT IN" : "IN"} (${list})`;
    }

    default:
      return null;
  }
}

/** Compile a node (group or condition) into a SQL fragment, or null if empty. */
function compileNode(node: FilterNode, dialect: string): string | null {
  if (node.kind === "condition") {
    return compileCondition(node, dialect);
  }
  // group
  const compiled = node.children
    .map((child) => compileNode(child, dialect))
    .filter((s): s is string => s !== null && s !== "");
  if (compiled.length === 0) return null;
  const joiner = node.combinator === "OR" ? " OR " : " AND ";
  const body = compiled.length === 1 ? compiled[0] : `(${compiled.join(joiner)})`;
  return node.negate ? `NOT (${compiled.join(joiner)})` : body;
}

/**
 * Compile a filter tree into a SQL WHERE expression (without the leading
 * `WHERE`). Returns an empty string when the tree contributes no predicate, so
 * callers can do `where ? ` WHERE ${where}` : ""`.
 */
export function compileWhere(node: FilterNode | null, options: CompileOptions = {}): string {
  if (!node) return "";
  const dialect = options.dialect ?? "postgres";
  return compileNode(node, dialect) ?? "";
}

/** Count the active (compilable) leaf conditions in a tree. */
export function countActiveConditions(node: FilterNode | null, dialect = "postgres"): number {
  if (!node) return 0;
  if (node.kind === "condition") {
    return compileCondition(node, dialect) ? 1 : 0;
  }
  return node.children.reduce((n, c) => n + countActiveConditions(c, dialect), 0);
}
