import type {
  ColumnDef,
  RelationCount,
  TableDescription,
} from "@/ipc";
import type { DrilldownCrumb, M2MCrumb } from "@/store/tabs";

/**
 * Structural metadata for a many-to-many relation: the junction (join) table a
 * relation collapses, and the far table it actually lands on. Attached to a
 * {@link RelationColumn} so the column is labeled with the far table while page
 * counts still count the junction (its `target*` fields are unchanged).
 */
export interface M2MInfo {
  junctionSchema: string;
  junctionTable: string;
  /** Junction column referencing the source row (the "near" FK). */
  nearColumn: string;
  /** Junction column referencing the far table (the "far" FK). */
  farColumn: string;
  farSchema: string;
  farTable: string;
  /** The far table's referenced column (what `farColumn` points at). */
  farRefColumn: string;
}

/**
 * A virtual "relation" column rendered in the data grid alongside real columns.
 * SlashTable's headline feature: related tables appear as expandable columns and
 * clicking a cell drills into the related rows.
 */
export interface RelationColumn {
  /** Stable id used as the Glide column id (prefixed to avoid clashing real columns). */
  id: string;
  /** Direction: parent (N:1, outgoing FK) or children (1:N, incoming FK). */
  direction: "outgoing" | "incoming";
  /** The related table to drill into. */
  targetSchema: string;
  targetTable: string;
  /**
   * For outgoing: the column on *this* row whose value identifies the parent,
   * and the parent column it matches (`parent.targetColumn = thisRow[localColumn]`).
   * For incoming: `localColumn` is this table's referenced column (the PK), and
   * `targetColumn` is the child FK column (`child.targetColumn = thisRow[localColumn]`).
   */
  localColumn: string;
  targetColumn: string;
  /** Cardinality label for the header / chip. */
  cardinality: "N:1" | "1:N";
  /**
   * Set when this relation collapses a many-to-many junction: the column is
   * labeled with `m2m.farTable` and drilling joins through the junction, while
   * `target*`/`id` keep pointing at the junction so page counts stay correct.
   */
  m2m?: M2MInfo;
}

/**
 * Semantic type of a column, used to pick a header/detail icon (§4). Mirrors
 * SlashTable's `pickSpriteName` exactly: a priority order of
 * PK → FK → relation → semanticType switch → dataType fallback → text default.
 */
export type SemanticType =
  | "pk"
  | "fk"
  | "relation"
  | "bool"
  | "cidr"
  | "code"
  | "color"
  | "currency"
  | "date_relative"
  | "email"
  | "image_url"
  | "json"
  | "number"
  | "percentage"
  | "phone"
  | "rating"
  | "url"
  | "text";

/**
 * Classify a column into a {@link SemanticType}, following SlashTable's exact
 * priority order. `isFk`/`isRelation` are supplied by the caller (the bare
 * ColumnDef doesn't carry FK/relation membership). `hint` is an optional
 * pre-derived semantic-type string (SlashTable's `column.semanticType`); when
 * absent we fall back to a dataType-based classification.
 */
export function semanticType(
  column: { name: string; dataType: string; primaryKey?: boolean; semanticType?: string },
  isFk = false,
  isRelation = false
): SemanticType {
  // 1. PK → FK → relation take precedence over everything else.
  if (column.primaryKey) return "pk";
  if (isFk) return "fk";
  if (isRelation) return "relation";

  // 2. Explicit semanticType switch (matches SlashTable's known set).
  switch (column.semanticType) {
    case "bool":
      return "bool";
    case "cidr":
    case "ip_address":
      return "cidr";
    case "code":
      return "code";
    case "color":
      return "color";
    case "currency":
      return "currency";
    case "date_relative":
      return "date_relative";
    case "email":
      return "email";
    case "image_url":
      return "image_url";
    case "json":
      return "json";
    case "number":
      return "number";
    case "percentage":
      return "percentage";
    case "phone":
      return "phone";
    case "rating":
      return "rating";
    case "url":
      return "url";
  }

  // 3. dataType fallback (lowercased).
  const t = column.dataType.toLowerCase();
  if (/(int|serial|numeric|decimal|float|double|real|money)/.test(t)) return "number";
  if (t.includes("bool")) return "bool";
  if (t.includes("json")) return "json";
  if (/(date|time|timestamp)/.test(t)) return "date_relative";

  // 4. text/unknown default.
  return "text";
}

/** Parse a Beekeeper FK reference string like `public.users(id)`. */
export function parseRef(
  ref: string
): { schema?: string; table: string; column: string } | null {
  const m = /^(?:([^.]+)\.)?([^(]+)\(([^)]+)\)$/.exec(ref.trim());
  if (!m) return null;
  return { schema: m[1], table: m[2].trim(), column: m[3].trim() };
}

/**
 * Derive the ordered list of relation columns for a table description.
 * Outgoing (parent) relations come first, then incoming (child) relations.
 */
export function relationColumns(
  description: TableDescription | null
): RelationColumn[] {
  if (!description) return [];
  const out: RelationColumn[] = [];

  for (const fk of description.foreignKeys) {
    const ref = parseRef(fk.references);
    if (!ref) continue;
    out.push({
      id: `__rel_out__:${fk.column}:${ref.table}`,
      direction: "outgoing",
      targetSchema: ref.schema ?? description.schema,
      targetTable: ref.table,
      localColumn: fk.column,
      targetColumn: ref.column,
      cardinality: "N:1",
    });
  }

  for (const inc of description.incomingForeignKeys ?? []) {
    out.push({
      id: `__rel_in__:${inc.fromTable}:${inc.fromColumn}`,
      direction: "incoming",
      targetSchema: inc.fromSchema,
      targetTable: inc.fromTable,
      localColumn: inc.toColumn,
      targetColumn: inc.fromColumn,
      cardinality: "1:N",
    });
  }

  return out;
}

/**
 * Many-to-many junction heuristic, mirroring the schema-graph detector and
 * SlashTable's SQL detection: a composite primary key of 2+ foreign-key columns
 * and no other non-keyed columns (every column is a PK or an FK).
 */
export function isJoinTable(description: TableDescription): boolean {
  const fkColumns = new Set(description.foreignKeys.map((fk) => fk.column));
  if (fkColumns.size < 2) return false;
  if (description.columns.length === 0) return false;
  return description.columns.every((c) => c.primaryKey || fkColumns.has(c.name));
}

/**
 * Given an incoming relation to a detected junction table and that junction's
 * description, derive one collapsed M2M relation per far-side FK (every FK other
 * than the one pointing back to the source). Each result keeps the junction's
 * id/target columns (so page counts still count junction rows) and carries the
 * far-side join info in {@link RelationColumn.m2m}.
 */
export function m2mRelationsFor(
  incoming: RelationColumn,
  junction: TableDescription
): RelationColumn[] {
  const nearColumn = incoming.targetColumn; // junction FK -> source row
  const out: RelationColumn[] = [];
  for (const fk of junction.foreignKeys) {
    if (fk.column === nearColumn) continue; // skip the FK back to the source
    const ref = parseRef(fk.references);
    if (!ref) continue;
    out.push({
      ...incoming,
      // Unique id per far table so multi-edge junctions don't collide, while
      // page counts (keyed by id, querying target*) still count the junction.
      id: `${incoming.id}=>${ref.table}`,
      m2m: {
        junctionSchema: incoming.targetSchema,
        junctionTable: incoming.targetTable,
        nearColumn,
        farColumn: fk.column,
        farSchema: ref.schema ?? incoming.targetSchema,
        farTable: ref.table,
        farRefColumn: ref.column,
      },
    });
  }
  return out;
}

/** Map a RelationCount back to the matching incoming RelationColumn id. */
export function relationCountKey(c: RelationCount): string {
  return `__rel_in__:${c.fromTable}:${c.fromColumn}`;
}

/** Look up the local-column value for a row (returns null if absent). */
export function localValue(
  rel: RelationColumn,
  columns: ColumnDef[],
  row: (string | number | boolean | null)[]
): string | number | boolean | null {
  const idx = columns.findIndex((c) => c.name === rel.localColumn);
  if (idx < 0) return null;
  return row[idx] ?? null;
}

/** Quote a SQL identifier. */
function ident(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Embed a CellValue as a SQL literal (numbers bare, everything else quoted). */
export function sqlLiteral(v: string | number | boolean | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * The base WHERE expression (without `WHERE`) pinning a drilldown crumb to its
 * related rows: `fk = <value>`. Returns "" when the crumb has no filter (the
 * root/origin crumb). Composable with the FilterBar's compiled WHERE.
 */
export function crumbWhere(crumb: DrilldownCrumb): string {
  if (!crumb.filterColumn || crumb.filterValue === undefined) return "";
  return `${ident(crumb.filterColumn)} = ${sqlLiteral(crumb.filterValue)}`;
}

/**
 * The read-only SELECT that fetches the related rows for a drilldown crumb,
 * optionally composing an extra WHERE expression (the FilterBar's compiled
 * filter) with the crumb's own `fk = <pk>` condition (joined by AND).
 * For an incoming relation (children): `SELECT * FROM child WHERE fk = <pk>`.
 * For an outgoing relation (parent):   `SELECT * FROM parent WHERE pk = <fk>`.
 */
export function drilldownSql(crumb: DrilldownCrumb, extraWhere = ""): string {
  if (crumb.m2m) return m2mDrilldownSql(crumb, crumb.m2m, extraWhere);
  const qualified = `${ident(crumb.schema)}.${ident(crumb.table)}`;
  const parts = [crumbWhere(crumb), extraWhere.trim()].filter((p) => p !== "");
  const whereClause = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  return `SELECT * FROM ${qualified}${whereClause} LIMIT 200`;
}

/**
 * The read-only SELECT for a many-to-many hop: the far table joined through the
 * junction, scoped to the source row via the junction's near FK. The far table
 * and junction are referenced by full name (not aliased) so the FilterBar's
 * bare far-column filters in `extraWhere` compose unambiguously in the common
 * case (junction columns are FK ids, far filters are on far columns).
 */
function m2mDrilldownSql(crumb: DrilldownCrumb, m2m: M2MCrumb, extraWhere = ""): string {
  const far = `${ident(crumb.schema)}.${ident(crumb.table)}`;
  const junction = `${ident(m2m.junctionSchema)}.${ident(m2m.junctionTable)}`;
  const joinCond = `${far}.${ident(m2m.farRefColumn)} = ${junction}.${ident(m2m.farColumn)}`;
  const nearCond = `${junction}.${ident(m2m.nearColumn)} = ${sqlLiteral(m2m.nearValue)}`;
  const parts = [nearCond, extraWhere.trim()].filter((p) => p !== "");
  return (
    `SELECT ${far}.* FROM ${far} ` +
    `JOIN ${junction} ON ${joinCond} ` +
    `WHERE ${parts.join(" AND ")} LIMIT 200`
  );
}

/**
 * Build the breadcrumb crumb for following a relation from a source row.
 * Returns null when the source row lacks the required local value.
 */
export function buildCrumb(
  rel: RelationColumn,
  sourceTable: string,
  sourceKey: string | number | boolean | null
): DrilldownCrumb | null {
  if (sourceKey === null) return null;
  if (rel.m2m) {
    // Many-to-many: land on the far table, joining through the junction. No
    // far-table filterColumn — the scope is the junction's near-FK condition.
    return {
      schema: rel.m2m.farSchema,
      table: rel.m2m.farTable,
      relation: "incoming",
      sourceKey: sourceKey as string | number,
      sourceTable,
      m2m: {
        junctionSchema: rel.m2m.junctionSchema,
        junctionTable: rel.m2m.junctionTable,
        nearColumn: rel.m2m.nearColumn,
        nearValue: sourceKey as string | number,
        farColumn: rel.m2m.farColumn,
        farRefColumn: rel.m2m.farRefColumn,
      },
    };
  }
  if (rel.direction === "incoming") {
    // children: child.targetColumn = thisRow[localColumn(=PK)]
    return {
      schema: rel.targetSchema,
      table: rel.targetTable,
      filterColumn: rel.targetColumn,
      filterValue: sourceKey as string | number,
      relation: "incoming",
      sourceKey: sourceKey as string | number,
      sourceTable,
    };
  }
  // parent: parent.targetColumn(=PK) = thisRow[localColumn(=FK)]
  return {
    schema: rel.targetSchema,
    table: rel.targetTable,
    filterColumn: rel.targetColumn,
    filterValue: sourceKey as string | number,
    relation: "outgoing",
    sourceKey: sourceKey as string | number,
    sourceTable,
  };
}
