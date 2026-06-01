import type {
  BackendClient,
  ColumnDef,
  GetRecordsParams,
  GetRelationCountsParams,
  IncomingForeignKey,
  QueryResult,
  RecordPage,
  RelationCount,
  SchemaGraph,
  TableDescription,
} from "./types";
import {
  MOCK_CONNECTIONS,
  MOCK_SCHEMAS,
  MOCK_TABLES,
  USERS_COLUMNS,
  buildUsersRows,
} from "./mockData";

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

  async getRecords(params: GetRecordsParams): Promise<RecordPage> {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const meta = MOCK_TABLES.find(
      (t) => t.name === params.table && t.schema === params.schema
    );
    const total = meta?.rowEstimate || 100;
    await delay(jitter(120, 420));

    const columns = params.table === "users" ? USERS_COLUMNS : genericColumns(params.table);
    const full =
      params.table === "users" ? buildUsersRows(total) : genericRows(params.table, total);

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

  async getSchemaGraph(_connectionId: string, schema?: string): Promise<SchemaGraph> {
    await delay(jitter(120, 320));
    const tables = MOCK_TABLES.filter((t) => !schema || t.schema === schema);
    const colsFor = (table: string) =>
      (table === "users" ? USERS_COLUMNS : genericColumns(table)).map((c) => ({
        name: c.name,
        dataType: c.dataType,
        primaryKey: c.primaryKey,
      }));
    return {
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
}

export const backend: BackendClient = new MockBackendClient();
