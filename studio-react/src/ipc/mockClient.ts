import type {
  BackendClient,
  ColumnDef,
  GetRecordsParams,
  QueryResult,
  RecordPage,
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

/** Generic columns used for tables other than `users`. */
function genericColumns(table: string): ColumnDef[] {
  return [
    { name: "id", dataType: "int4", nullable: false, primaryKey: true },
    { name: `${table}_name`, dataType: "varchar(120)", nullable: false, primaryKey: false },
    { name: "status", dataType: "varchar(24)", nullable: false, primaryKey: false, default: "'pending'" },
    { name: "amount", dataType: "numeric(12,2)", nullable: true, primaryKey: false },
    { name: "updated_at", dataType: "timestamptz", nullable: false, primaryKey: false, default: "now()" },
  ];
}

function genericRows(table: string, count: number) {
  const statuses = ["pending", "active", "archived", "failed"];
  return Array.from({ length: count }, (_, i) => [
    i + 1,
    `${table}-${(i + 1).toString().padStart(4, "0")}`,
    statuses[i % statuses.length],
    Number((Math.sin(i) * 5000 + 5000).toFixed(2)),
    new Date(Date.UTC(2025, 0, 1) + i * 3600_000).toISOString().slice(0, 19).replace("T", " "),
  ]);
}

/**
 * In-memory implementation of {@link BackendClient}. Swap this for a
 * MessagePort-backed client (same interface) when wiring the Electron backend.
 */
export class MockBackendClient implements BackendClient {
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
      foreignKeys:
        table === "campaigns" ? [{ column: "owner_id", references: "public.users(id)" }] : [],
    };
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
    const rows = full.slice(offset, offset + limit);

    return {
      columns,
      rows,
      totalRows: total,
      loaded: rows.length,
      elapsedMs: Math.round(jitter(800, 2100)),
    };
  }

  async executeQuery(_connectionId: string, sql: string): Promise<QueryResult> {
    await delay(jitter(300, 1200));
    const op = (sql.trim().split(/\s+/)[0] || "SELECT").toUpperCase();
    const tableMatch = sql.match(/\b(?:from|join|into|update)\s+([a-z_][\w.]*)/i);
    const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "public.users";
    const shortName = table.split(".").pop() || "users";

    const columns = shortName === "users" ? USERS_COLUMNS : genericColumns(shortName);
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
