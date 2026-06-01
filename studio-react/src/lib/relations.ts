import type {
  ColumnDef,
  RelationCount,
  TableDescription,
} from "@/ipc";
import type { DrilldownCrumb } from "@/store/tabs";

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
 * The read-only SELECT that fetches the related rows for a drilldown crumb.
 * For an incoming relation (children): `SELECT * FROM child WHERE fk = <pk>`.
 * For an outgoing relation (parent):   `SELECT * FROM parent WHERE pk = <fk>`.
 */
export function drilldownSql(crumb: DrilldownCrumb): string {
  const qualified = `${ident(crumb.schema)}.${ident(crumb.table)}`;
  if (!crumb.filterColumn || crumb.filterValue === undefined) {
    return `SELECT * FROM ${qualified} LIMIT 200`;
  }
  return `SELECT * FROM ${qualified} WHERE ${ident(crumb.filterColumn)} = ${sqlLiteral(
    crumb.filterValue
  )} LIMIT 200`;
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
