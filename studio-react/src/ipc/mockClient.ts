import type {
  BackendClient,
  CellValue,
  ColumnDef,
  ColumnStats,
  Connection,
  ConnectionConfig,
  DockerContainer,
  GetRecordsParams,
  GetRelationCountsParams,
  GetSchemaGraphOptions,
  GetTableStatsParams,
  IncomingForeignKey,
  McpStatus,
  PageRelationCounts,
  PageRelationCountsParams,
  QueryResult,
  RecordPage,
  RelationCount,
  SchemaGraph,
  TableDescription,
  TableStats,
  TopValue,
} from "./types";
import {
  MOCK_CONNECTIONS,
  MOCK_SCHEMAS,
  MOCK_TABLES,
  USERS_COLUMNS,
  buildUsersRows,
} from "./mockData";
import { focusGraph } from "@/lib/graph";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * FK columns each generic (non-`users`) table carries, so child drilldown has a
 * real column + value to filter on. The value is computed deterministically in
 * {@link genericRows} so `child.fk = parentPk` actually matches rows.
 */
const GENERIC_FK_COLUMNS: Record<string, { column: string; parentRows: number }> = {
  // campaigns.owner_id -> users.id (users has 299 rows)
  campaigns: { column: "owner_id", parentRows: 299 },
  // reports.campaign_id -> campaigns.id (campaigns has 1820 rows)
  reports: { column: "campaign_id", parentRows: 1820 },
  // events.user_id -> users.id
  events: { column: "user_id", parentRows: 299 },
};

/** Generic columns used for tables other than `users`. */
function genericColumns(table: string): ColumnDef[] {
  const fk = GENERIC_FK_COLUMNS[table];
  const cols: ColumnDef[] = [
    { name: "id", dataType: "int4", nullable: false, primaryKey: true },
    { name: `${table}_name`, dataType: "varchar(120)", nullable: false, primaryKey: false },
    { name: "status", dataType: "varchar(24)", nullable: false, primaryKey: false, default: "'pending'" },
    { name: "amount", dataType: "numeric(12,2)", nullable: true, primaryKey: false },
    { name: "updated_at", dataType: "timestamptz", nullable: false, primaryKey: false, default: "now()" },
  ];
  if (fk) {
    cols.splice(1, 0, {
      name: fk.column,
      dataType: "int4",
      nullable: false,
      primaryKey: false,
    });
  }
  return cols;
}

/** Deterministic FK value for row `i` of `table`, in [1, parentRows]. */
function fkValueFor(table: string, i: number): number {
  const fk = GENERIC_FK_COLUMNS[table];
  if (!fk) return 0;
  return ((i * 7 + 3) % fk.parentRows) + 1;
}

function genericRows(table: string, count: number) {
  const statuses = ["pending", "active", "archived", "failed"];
  const fk = GENERIC_FK_COLUMNS[table];
  return Array.from({ length: count }, (_, i) => {
    const row: (string | number)[] = [
      i + 1,
      `${table}-${(i + 1).toString().padStart(4, "0")}`,
      statuses[i % statuses.length],
      Number((Math.sin(i) * 5000 + 5000).toFixed(2)),
      new Date(Date.UTC(2025, 0, 1) + i * 3600_000).toISOString().slice(0, 19).replace("T", " "),
    ];
    if (fk) row.splice(1, 0, fkValueFor(table, i));
    return row;
  });
}

/**
 * Best-effort, in-memory evaluator for a subset of a compiled SQL WHERE string
 * (the output of lib/filters.ts {@link compileWhere}). Supports a flat
 * AND/OR-joined list of simple predicates so the FilterBar filters visibly
 * offline. Nested parens and BETWEEN/IN are tolerated but treated leniently:
 * unrecognised predicates evaluate to `true` (never hide rows the mock can't
 * understand). The real backend (MCP) runs the full SQL.
 *
 * Recognised predicates (col is `"name"`):
 *   "col" = 'v' | <n>            equals
 *   "col" <> 'v'                 not equals
 *   "col" > / >= / < / <= <n>    comparisons
 *   "col" ILIKE '%v%' ...        contains/starts/ends (case-insensitive)
 *   "col" NOT ILIKE '%v%' ...    not contains
 *   "col" IS NULL / IS NOT NULL
 *   "col" IN (a, b)              membership
 */
function evalSimpleWhere(where: string, columns: ColumnDef[], row: CellValue[]): boolean {
  const colIndex = (name: string) => columns.findIndex((c) => c.name === name);
  const cellOf = (name: string): CellValue => {
    const i = colIndex(name);
    return i >= 0 ? row[i] : null;
  };
  const unquote = (lit: string): string => {
    const t = lit.trim();
    if (t.startsWith("'") && t.endsWith("'")) {
      return t.slice(1, -1).replace(/''/g, "'");
    }
    return t;
  };

  // Split into clauses on top-level AND/OR (ignore nesting; good enough for mock).
  // We evaluate OR with lower precedence than AND across the flat list.
  const orParts = where.split(/\s+OR\s+/i);
  return orParts.some((orPart) => {
    const andParts = orPart.split(/\s+AND\s+/i);
    return andParts.every((clause) => evalClause(clause, cellOf, unquote));
  });
}

function evalClause(
  raw: string,
  cellOf: (name: string) => CellValue,
  unquote: (lit: string) => string
): boolean {
  const clause = raw.replace(/^[\s(]+|[\s)]+$/g, "");
  const colRe = /^"((?:[^"]|"")*)"\s*/;
  const m = colRe.exec(clause);
  if (!m) return true; // unrecognised → don't hide
  const col = m[1].replace(/""/g, '"');
  const rest = clause.slice(m[0].length).trim();
  const cell = cellOf(col);

  // IS [NOT] NULL
  if (/^IS\s+NOT\s+NULL/i.test(rest)) return cell !== null && cell !== undefined;
  if (/^IS\s+NULL/i.test(rest)) return cell === null || cell === undefined;

  // [NOT] ILIKE/LIKE 'pattern'
  const likeM = /^(NOT\s+)?I?LIKE\s+'((?:[^']|'')*)'/i.exec(rest);
  if (likeM) {
    const negate = !!likeM[1];
    const pattern = likeM[2].replace(/''/g, "'");
    const hit = likeMatch(String(cell ?? ""), pattern);
    return negate ? !hit : hit;
  }

  // IN (a, b, ...)
  const inM = /^(NOT\s+)?IN\s*\(([^)]*)\)/i.exec(rest);
  if (inM) {
    const negate = !!inM[1];
    const items = inM[2].split(",").map((s) => unquote(s));
    const hit = items.some((it) => String(cell ?? "") === it);
    return negate ? !hit : hit;
  }

  // Comparison / equality operators.
  const opM = /^(<>|!=|>=|<=|=|>|<)\s*(.+)$/.exec(rest);
  if (opM) {
    const op = opM[1];
    const rhsLit = opM[2].trim();
    const rhs = unquote(rhsLit);
    const numL = Number(cell);
    const numR = Number(rhs);
    const bothNum = Number.isFinite(numL) && Number.isFinite(numR) && rhs.trim() !== "";
    switch (op) {
      case "=":
        return bothNum ? numL === numR : String(cell ?? "") === rhs;
      case "<>":
      case "!=":
        return bothNum ? numL !== numR : String(cell ?? "") !== rhs;
      case ">":
        return bothNum ? numL > numR : String(cell ?? "") > rhs;
      case ">=":
        return bothNum ? numL >= numR : String(cell ?? "") >= rhs;
      case "<":
        return bothNum ? numL < numR : String(cell ?? "") < rhs;
      case "<=":
        return bothNum ? numL <= numR : String(cell ?? "") <= rhs;
    }
  }

  return true; // unrecognised tail → don't hide
}

/** Case-insensitive SQL LIKE/ILIKE match supporting `%` and `_` wildcards. */
function likeMatch(value: string, pattern: string): boolean {
  // Unescape the `\` escapes the compiler emits, tracking which chars are literal.
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      regex += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (ch === "%") {
      regex += ".*";
    } else if (ch === "_") {
      regex += ".";
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`, "i").test(value);
}

/** Build a descending (value, count) list from a set of sample values. */
function topValues(values: CellValue[]): TopValue[] {
  return values.map((value, i) => ({ value, count: 200 - i * 17 }));
}

/**
 * Fake but type-appropriate `top_values` per column, so {@link inferSemanticType}
 * has realistic samples to classify offline. Names mirror the mock columns
 * (`email`, `*_url`, color/phone/etc. demonstrated on generic columns).
 */
function mockColumnStats(table: string, c: ColumnDef): ColumnStats {
  const n = c.name.toLowerCase();
  if (n === "email") {
    return {
      name: c.name,
      top_values: topValues([
        "alex.lee1@example.com",
        "jordan.kim2@example.com",
        "sam.patel3@example.com",
      ]),
      nullFraction: 0,
    };
  }
  if (n.endsWith("_url") || n === "avatar" || n === "image") {
    return {
      name: c.name,
      top_values: topValues([
        "https://cdn.example.com/a.png",
        "https://cdn.example.com/b.jpg",
        "https://cdn.example.com/c.webp",
      ]),
      nullFraction: 0.1,
    };
  }
  if (n === "color" || n.endsWith("_color")) {
    return {
      name: c.name,
      top_values: topValues(["#ff5722", "#2196f3", "#4caf50", "#9c27b0"]),
    };
  }
  if (n === "status") {
    return { name: c.name, top_values: topValues(["pending", "active", "archived", "failed"]) };
  }
  if (n === "rating" || n === "stars") {
    return { name: c.name, top_values: topValues([5, 4, 3, 2, 1]) };
  }
  // Generic: a couple of representative values for the column.
  return {
    name: c.name,
    top_values: topValues([`${table}-0001`, `${table}-0002`, `${table}-0003`]),
  };
}

/**
 * Mock relationship topology (mirrors the schema-graph edges below):
 *   campaigns.owner_id   -> users.id
 *   reports.campaign_id  -> campaigns.id
 *   events.user_id       -> users.id
 * Keyed by the *referenced* (parent) table, listing child tables that point at
 * it — i.e. the incoming FKs used for OneToMany ("1:N") relation columns.
 */
const MOCK_INCOMING_FKS: Record<string, IncomingForeignKey[]> = {
  users: [
    { fromSchema: "public", fromTable: "campaigns", fromColumn: "owner_id", toColumn: "id" },
    { fromSchema: "public", fromTable: "events", fromColumn: "user_id", toColumn: "id" },
  ],
  campaigns: [
    { fromSchema: "public", fromTable: "reports", fromColumn: "campaign_id", toColumn: "id" },
  ],
};

/** Outgoing FKs per table, in the existing `{ column, references }` shape. */
const MOCK_OUTGOING_FKS: Record<string, { column: string; references: string }[]> = {
  campaigns: [{ column: "owner_id", references: "public.users(id)" }],
  reports: [{ column: "campaign_id", references: "public.campaigns(id)" }],
  events: [{ column: "user_id", references: "public.users(id)" }],
};

/**
 * In-memory implementation of {@link BackendClient}. Swap this for a
 * MessagePort-backed client (same interface) when wiring the Electron backend.
 */
export class MockBackendClient implements BackendClient {
  /** Mock connections are already "live"; just echo the id back. */
  async connect(connectionId: string) {
    await delay(jitter(40, 120));
    return connectionId;
  }

  async listConnections() {
    await delay(jitter(60, 160));
    return structuredClone(MOCK_CONNECTIONS);
  }

  async listDockerContainers(): Promise<DockerContainer[]> {
    await delay(jitter(40, 120));
    // Canned running containers so the Docker section renders in browser dev.
    return [
      {
        id: "mock-pg",
        name: "local-postgres",
        image: "postgres:16",
        kind: "postgres",
        host: "localhost",
        port: 5432,
        status: "Up 2 hours",
        running: true,
        username: "postgres",
        password: "postgres",
        database: "postgres",
      },
      {
        id: "mock-mysql",
        name: "shop-mysql",
        image: "mysql:8",
        kind: "mysql",
        host: "localhost",
        port: 3307,
        status: "Up 11 minutes",
        running: true,
      },
    ];
  }

  async listSchemas(_connectionId: string) {
    await delay(jitter(40, 120));
    return structuredClone(MOCK_SCHEMAS);
  }

  async listTables(_connectionId: string, schema?: string) {
    await delay(jitter(60, 180));
    const all = structuredClone(MOCK_TABLES);
    return schema ? all.filter((t) => t.schema === schema) : all;
  }

  async describeTable(
    _connectionId: string,
    table: string,
    schema = "public"
  ): Promise<TableDescription> {
    await delay(jitter(50, 140));
    const columns = table === "users" ? USERS_COLUMNS : genericColumns(table);
    return {
      schema,
      table,
      columns,
      indexes: [
        { name: `${table}_pkey`, columns: ["id"], unique: true },
        { name: `${table}_status_idx`, columns: ["status"], unique: false },
      ],
      foreignKeys: MOCK_OUTGOING_FKS[table] ?? [],
      incomingForeignKeys: MOCK_INCOMING_FKS[table] ?? [],
    };
  }

  async getRelationCounts(params: GetRelationCountsParams): Promise<RelationCount[]> {
    await delay(jitter(40, 120));
    const incoming = MOCK_INCOMING_FKS[params.table] ?? [];
    const key = Number(params.rowKey);
    if (!incoming.length || !Number.isFinite(key)) return [];
    // Fake but stable per (child table, rowKey) counts so chips show numbers.
    return incoming.map((fk) => {
      const child = MOCK_TABLES.find(
        (t) => t.name === fk.fromTable && t.schema === fk.fromSchema
      );
      const total = child?.rowEstimate ?? 0;
      // Roughly: how many child rows would match fkValueFor(...) == key.
      const meta = GENERIC_FK_COLUMNS[fk.fromTable];
      const base = meta ? Math.round(total / meta.parentRows) : 0;
      const wobble = (key * 31 + fk.fromTable.length) % 4;
      return { ...fk, count: Math.max(0, base + wobble - 1) };
    });
  }

  async getPageRelationCounts(
    params: PageRelationCountsParams
  ): Promise<PageRelationCounts> {
    await delay(jitter(40, 140));
    const out: PageRelationCounts = {};
    const wanted = new Set(params.rowKeys.map((k) => String(k)));
    for (const rel of params.relations) {
      const meta = GENERIC_FK_COLUMNS[rel.table];
      const child = MOCK_TABLES.find((t) => t.name === rel.table);
      const byKey: Record<string, number> = {};
      if (meta && child) {
        // Exact grouped count: scan the child's deterministic FK values.
        for (let i = 0; i < child.rowEstimate; i++) {
          const fk = String(fkValueFor(rel.table, i));
          if (!wanted.has(fk)) continue;
          byKey[fk] = (byKey[fk] ?? 0) + 1;
        }
      }
      out[rel.id] = byKey;
    }
    return out;
  }

  async getTableStats(params: GetTableStatsParams): Promise<TableStats> {
    await delay(jitter(60, 180));
    const columns =
      params.table === "users" ? USERS_COLUMNS : genericColumns(params.table);
    return { columns: columns.map((c) => mockColumnStats(params.table, c)) };
  }

  async getMcpStatus(): Promise<McpStatus> {
    await delay(jitter(20, 60));
    return {
      running: true,
      url: "http://127.0.0.1:27500/mcp",
      port: 27500,
      requests: 15,
      errors: 0,
      lastCall: { name: "list_tables", durationMs: 12 },
      writeConnections: ["postgres"],
    };
  }

  async newConnection(): Promise<ConnectionConfig> {
    return {
      connectionType: "postgres",
      port: 5432,
      mcpAccess: "read",
      sshEnabled: false,
      sshPort: 22,
      sshMode: "agent",
    };
  }

  async saveConnection(config: ConnectionConfig): Promise<Connection> {
    await delay(jitter(80, 200));
    return {
      id: "mock:saved",
      name: config.name || "New Connection",
      kind: (config.connectionType as Connection["kind"]) ?? "postgres",
      host: config.host ?? undefined,
      connected: false,
    };
  }

  async testConnection(_config: ConnectionConfig): Promise<void> {
    await delay(jitter(120, 300));
  }

  async getConnectionConfig(_connectionId: string): Promise<ConnectionConfig | null> {
    return { connectionType: "postgres", name: "Mock connection", host: "localhost", port: 5432 };
  }

  async removeConnection(_connectionId: string): Promise<void> {
    await delay(jitter(40, 120));
  }

  async getRecords(params: GetRecordsParams): Promise<RecordPage> {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const meta = MOCK_TABLES.find(
      (t) => t.name === params.table && t.schema === params.schema
    );
    const total = meta?.rowEstimate || 100;
    await delay(jitter(120, 420));

    const columns = params.table === "users" ? USERS_COLUMNS : genericColumns(params.table);
    let full =
      params.table === "users" ? buildUsersRows(total) : genericRows(params.table, total);

    // Honor a simple subset of the compiled WHERE so the FilterBar visibly
    // filters offline (equals, not-equals, contains/not-contains, comparisons,
    // is [not] null). See {@link evalSimpleWhere}.
    if (params.where && params.where.trim()) {
      full = full.filter((row) =>
        evalSimpleWhere(params.where as string, columns, row as CellValue[])
      );
    }

    // Client-driven sort over the full set before paging.
    const sort = params.orderBy?.[0];
    if (sort) {
      const idx = columns.findIndex((c) => c.name === sort.column);
      if (idx >= 0) {
        const dir = sort.direction === "desc" ? -1 : 1;
        full.sort((a, b) => {
          const av = a[idx];
          const bv = b[idx];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (av < bv ? -1 : 1) * dir;
        });
      }
    }
    const rows = full.slice(offset, offset + limit);

    return {
      columns,
      rows,
      totalRows: total,
      loaded: rows.length,
      elapsedMs: Math.round(jitter(800, 2100)),
    };
  }

  async getSchemaGraph(
    _connectionId: string,
    options?: GetSchemaGraphOptions
  ): Promise<SchemaGraph> {
    await delay(jitter(120, 320));
    const schema = options?.schema;
    const tables = MOCK_TABLES.filter((t) => !schema || t.schema === schema);
    const colsFor = (table: string) =>
      (table === "users" ? USERS_COLUMNS : genericColumns(table)).map((c) => ({
        name: c.name,
        dataType: c.dataType,
        primaryKey: c.primaryKey,
      }));
    const full: SchemaGraph = {
      nodes: tables.map((t) => ({
        schema: t.schema,
        table: t.name,
        columns: colsFor(t.name),
      })),
      edges: [
        {
          fromSchema: "public",
          fromTable: "campaigns",
          fromColumn: "owner_id",
          toSchema: "public",
          toTable: "users",
          toColumn: "id",
        },
        {
          fromSchema: "public",
          fromTable: "reports",
          fromColumn: "campaign_id",
          toSchema: "public",
          toTable: "campaigns",
          toColumn: "id",
        },
        {
          fromSchema: "public",
          fromTable: "events",
          fromColumn: "user_id",
          toSchema: "public",
          toTable: "users",
          toColumn: "id",
        },
      ].filter(
        (e) =>
          tables.some((t) => t.schema === e.fromSchema && t.name === e.fromTable) &&
          tables.some((t) => t.schema === e.toSchema && t.name === e.toTable)
      ),
    };
    return focusGraph(full, options);
  }

  async executeQuery(_connectionId: string, sql: string): Promise<QueryResult> {
    await delay(jitter(300, 1200));
    const op = (sql.trim().split(/\s+/)[0] || "SELECT").toUpperCase();
    const tableMatch = sql.match(/\b(?:from|join|into|update)\s+([a-z_"][\w".]*)/i);
    const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "public.users";
    const shortName = table.split(".").pop() || "users";

    const columns = shortName === "users" ? USERS_COLUMNS : genericColumns(shortName);

    // Honor a simple `WHERE "col" = <number>` filter (used by relation
    // drilldown) so child/parent drilldowns return matching rows in the mock.
    const whereMatch = sql.match(/\bwhere\s+"?([a-z_][\w]*)"?\s*=\s*(\d+)\b/i);

    if (whereMatch) {
      const filterCol = whereMatch[1];
      const filterVal = Number(whereMatch[2]);
      const meta = MOCK_TABLES.find((t) => t.name === shortName);
      const total = meta?.rowEstimate || 100;
      const full =
        shortName === "users" ? buildUsersRows(total) : genericRows(shortName, total);
      const idx = columns.findIndex((c) => c.name === filterCol);
      const filtered =
        idx >= 0 ? full.filter((r) => Number(r[idx]) === filterVal) : full.slice(0, 0);
      const rows = filtered.slice(0, 200);
      return {
        columns,
        rows,
        rowCount: rows.length,
        elapsedMs: Math.round(jitter(900, 2300)),
        tables: [table],
        operation: op,
      };
    }

    const count = Math.floor(jitter(7, 60));
    const rows =
      shortName === "users" ? buildUsersRows(count) : genericRows(shortName, count);

    return {
      columns,
      rows,
      rowCount: rows.length,
      elapsedMs: Math.round(jitter(900, 2300)),
      tables: [table],
      operation: op,
    };
  }

  /**
   * Mock write path: the in-memory mock is always writable, so this just echoes
   * a plausible affected-row count. (The real MCP client gates this behind the
   * connection's read/write guard.)
   */
  async executeWrite(_connectionId: string, sql: string): Promise<QueryResult> {
    await delay(jitter(200, 700));
    const op = (sql.trim().split(/\s+/)[0] || "UPDATE").toUpperCase();
    const tableMatch = sql.match(/\b(?:from|join|into|update)\s+([a-z_"][\w".]*)/i);
    const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "";
    return {
      columns: [],
      rows: [],
      rowCount: 1,
      elapsedMs: Math.round(jitter(120, 400)),
      tables: table ? [table] : [],
      operation: op,
    };
  }
}

export const backend: BackendClient = new MockBackendClient();
