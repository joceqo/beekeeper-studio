import type { TableSummary } from "@/ipc";

/**
 * Explorer tree building, ported from SlashTable's "smart explorer"
 * (publicFirst + joinTablesLast + groupByPrefix + prefixTokenizer). Tables are
 * rendered under a schema folder; within a schema, tables that share a
 * snake_case prefix are folded into a prefix sub-folder (e.g. `achievements` +
 * `achievement_categories` -> an `achievements` group). Join tables sort last,
 * and the `public` schema sorts first.
 */

export interface ExplorerLeaf {
  kind: "table";
  table: TableSummary;
}

export interface ExplorerGroup {
  kind: "group";
  /** Stable id for persisting collapse state (schema or schema/prefix). */
  id: string;
  /** Display label (the shared prefix). */
  label: string;
  children: ExplorerLeaf[];
}

export type ExplorerNode = ExplorerLeaf | ExplorerGroup;

export interface ExplorerSchema {
  /** Stable id for collapse persistence. */
  id: string;
  schema: string;
  tableCount: number;
  nodes: ExplorerNode[];
}

/** snake_case / camelCase tokenizer: `achievement_categories` -> ["achievement","categories"]. */
export function prefixTokenizer(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean);
}

/**
 * Heuristic join-table detection (client-side mirror of the backend SQL
 * `is_join_table` heuristic): a name that reads as `a_b` / `a_b_c` where the
 * tokens look like two entity names joined (plural+plural or contains `_users`/
 * `_roles`-style pivots). Best-effort — used only for ordering, never to hide.
 */
export function looksLikeJoinTable(name: string): boolean {
  const t = prefixTokenizer(name);
  if (t.length < 2) return false;
  // Common pivots: <entity>_<entity>s, e.g. achievement_users, role_permissions.
  const last = t[t.length - 1];
  const pivots = new Set(["users", "roles", "permissions", "tags", "groups", "members"]);
  return pivots.has(last) && t.length >= 2;
}

/** Compare two table names with public-first already applied at the schema level. */
function byName(a: TableSummary, b: TableSummary): number {
  // Join tables last within their bucket.
  const ja = looksLikeJoinTable(a.name);
  const jb = looksLikeJoinTable(b.name);
  if (ja !== jb) return ja ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/**
 * Group a schema's tables by their first snake_case token, folding tokens that
 * are shared by ≥2 tables into a sub-folder. Singletons stay as top-level
 * leaves. The result preserves join-tables-last ordering.
 */
function groupByPrefix(schema: string, tables: TableSummary[]): ExplorerNode[] {
  const sorted = [...tables].sort(byName);
  const byPrefix = new Map<string, TableSummary[]>();
  for (const t of sorted) {
    const prefix = prefixTokenizer(t.name)[0] ?? t.name;
    const arr = byPrefix.get(prefix) ?? [];
    arr.push(t);
    byPrefix.set(prefix, arr);
  }

  const nodes: ExplorerNode[] = [];
  for (const [prefix, group] of byPrefix) {
    if (group.length >= 2) {
      nodes.push({
        kind: "group",
        id: `${schema}/${prefix}`,
        label: prefix,
        children: group.map((table) => ({ kind: "table" as const, table })),
      });
    } else {
      nodes.push({ kind: "table", table: group[0] });
    }
  }
  // Keep groups/leaves in the sorted order of their first table.
  return nodes;
}

/**
 * Build the full explorer tree: a list of schema folders (public first), each
 * with prefix-grouped nodes. `search` filters leaves by qualified name.
 */
export function buildExplorerTree(
  tables: TableSummary[],
  schemaCounts: Record<string, number>,
  search = ""
): ExplorerSchema[] {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q))
    : tables;

  const bySchema = new Map<string, TableSummary[]>();
  for (const t of filtered) {
    const arr = bySchema.get(t.schema) ?? [];
    arr.push(t);
    bySchema.set(t.schema, arr);
  }

  const schemas = [...bySchema.keys()].sort((a, b) => {
    if (a === "public") return -1;
    if (b === "public") return 1;
    return a.localeCompare(b);
  });

  return schemas.map((schema) => ({
    id: `schema:${schema}`,
    schema,
    // Prefer the backend's reported count; fall back to the visible table count
    // (0 from the backend means "unknown" — e.g. the MCP list_schemas tool).
    tableCount: schemaCounts[schema] || bySchema.get(schema)!.length,
    nodes: groupByPrefix(schema, bySchema.get(schema)!),
  }));
}

/** Format a row estimate like SlashTable: 57700 -> "57.7K", 882104 -> "882K". */
export function formatRowEstimate(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n === 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
}
