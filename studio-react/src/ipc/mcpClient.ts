import type {
  BackendClient,
  CellValue,
  ColumnDef,
  Connection,
  ConnectionConfig,
  DockerContainer,
  GetRecordsParams,
  GetRelationCountsParams,
  GetSchemaGraphOptions,
  GetTableStatsParams,
  McpStatus,
  PageRelationCounts,
  PageRelationCountsParams,
  QueryResult,
  RecordPage,
  RelationCount,
  Schema,
  SchemaGraph,
  SchemaGraphEdge,
  TableDescription,
  TableStats,
  TableSummary,
  TopValue,
} from "./types";
import { graphKey, reachableKeys, rootKeyOf } from "@/lib/graph";

/**
 * BackendClient implementation that talks to Beekeeper Studio's in-app MCP
 * server over Streamable HTTP (the same endpoint a coding agent would use).
 *
 * Protocol:
 *  1. POST an `initialize` JSON-RPC request; capture the `mcp-session-id`
 *     response header.
 *  2. POST `tools/call` with that header. Responses come back as SSE
 *     (`data: {json}` lines); parse the JSON-RPC result, then JSON.parse the
 *     single text content block (`result.content[0].text`).
 *
 * The MCP server exposes saved connections (`list_saved_connections`) that must
 * be opened with `connect` before the data tools work. This client connects the
 * requested saved connection on demand (access "read") and caches the live
 * connectionId it gets back.
 */

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolResultEnvelope {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

interface SavedConnectionDTO {
  savedConnectionId: number;
  name: string;
  connectionType: string;
  host: string | null;
  port: number | null;
  database: string | null;
  open: boolean;
}

interface DescribeTableDTO {
  table: string;
  schema: string | null;
  columns: { name: string; type: string; nullable: boolean; default: string | null }[];
  primaryKey: string[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  foreignKeys: {
    column: string;
    referencesTable: string;
    referencesColumn: string;
    referencesSchema: string | null;
  }[];
  /** Child tables that reference this table (1:N). Added alongside foreignKeys. */
  incomingForeignKeys?: {
    fromSchema: string | null;
    fromTable: string;
    fromColumn: string;
    toColumn: string;
  }[];
}

/** Map a Beekeeper connectionType to the UI's narrower `kind`. */
function kindFor(connectionType: string): Connection["kind"] {
  switch (connectionType) {
    case "mysql":
    case "mariadb":
    case "tidb":
      return "mysql";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "sqlserver";
    default:
      return "postgres";
  }
}

/** Saved-connection id encoded into the UI Connection id, so we can connect it later. */
const idFor = (savedConnectionId: number) => `saved:${savedConnectionId}`;
const savedIdFromUiId = (uiId: string): number | null => {
  const m = /^saved:(\d+)$/.exec(uiId);
  return m ? Number(m[1]) : null;
};

export class McpBackendClient implements BackendClient {
  private readonly baseUrl: string;
  private sessionId: string | null = null;
  private initializing: Promise<void> | null = null;
  private requestId = 0;

  /** Maps the UI connection id (`saved:<n>`) to the live MCP connectionId. */
  private readonly liveByUiId = new Map<string, string>();
  /** In-flight connect() calls keyed by UI id, to dedupe concurrent opens. */
  private readonly connecting = new Map<string, Promise<string>>();
  /** Maps the UI connection id to a WRITE-access live MCP connectionId. */
  private readonly writeByUiId = new Map<string, string>();
  /** In-flight write-connect() calls keyed by UI id. */
  private readonly writeConnecting = new Map<string, Promise<string>>();

  constructor(baseUrl = "http://127.0.0.1:27500/mcp") {
    this.baseUrl = baseUrl;
  }

  // --- low-level MCP transport -------------------------------------------

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (!this.initializing) {
      this.initializing = this.initialize().catch((err) => {
        this.initializing = null;
        throw err;
      });
    }
    await this.initializing;
  }

  private async initialize(): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "studio-react", version: "0.1.0" },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`MCP initialize failed: HTTP ${res.status} ${res.statusText}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (!sid) {
      throw new Error("MCP initialize did not return an mcp-session-id header");
    }
    this.sessionId = sid;
    // Drain the initialize response body (SSE or JSON); we only needed the header.
    await res.text();

    // Per spec, follow up with the initialized notification.
    await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-session-id": this.sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    }).catch(() => {
      /* notification failure is non-fatal */
    });
  }

  /** Pull the single JSON-RPC response object out of an SSE or JSON body. */
  private parseRpc(body: string): JsonRpcResponse {
    const trimmed = body.trim();
    // Plain JSON body.
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as JsonRpcResponse;
    }
    // SSE: collect `data:` lines, parse each, return the first JSON-RPC response.
    for (const line of trimmed.split(/\r?\n/)) {
      const m = /^data:\s?(.*)$/.exec(line);
      if (!m || !m[1]) continue;
      try {
        const parsed = JSON.parse(m[1]) as JsonRpcResponse;
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
          return parsed;
        }
      } catch {
        /* skip non-JSON data lines */
      }
    }
    throw new Error("No JSON-RPC response found in MCP SSE body");
  }

  /** Call an MCP tool and JSON.parse its single text content block. */
  private async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ensureSession();
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-session-id": this.sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    if (res.status === 404) {
      // Session expired/unknown — reset and retry once.
      this.sessionId = null;
      this.initializing = null;
      await this.ensureSession();
      return this.callTool<T>(name, args);
    }
    if (!res.ok) {
      throw new Error(`MCP tool ${name} failed: HTTP ${res.status} ${res.statusText}`);
    }

    const rpc = this.parseRpc(await res.text());
    if (rpc.error) {
      throw new Error(`MCP tool ${name} error: ${rpc.error.message}`);
    }
    const envelope = rpc.result as ToolResultEnvelope;
    const text = envelope?.content?.[0]?.text ?? "";
    if (envelope?.isError) {
      throw new Error(`MCP tool ${name}: ${text}`);
    }
    if (!text) {
      throw new Error(`MCP tool ${name} returned no text content`);
    }
    return JSON.parse(text) as T;
  }

  /** Resolve the live MCP connectionId for a UI connection id, connecting if needed. */
  private async resolveConnection(uiId: string): Promise<string> {
    const cached = this.liveByUiId.get(uiId);
    if (cached) return cached;

    const inFlight = this.connecting.get(uiId);
    if (inFlight) return inFlight;

    const savedId = savedIdFromUiId(uiId);
    if (savedId == null) {
      // Already a live MCP connectionId (e.g. "mcp:3"); use as-is.
      this.liveByUiId.set(uiId, uiId);
      return uiId;
    }

    const promise = this.callTool<{ connectionId: string }>("connect", {
      savedConnectionId: savedId,
      access: "read",
    })
      .then((r) => {
        this.liveByUiId.set(uiId, r.connectionId);
        return r.connectionId;
      })
      .finally(() => this.connecting.delete(uiId));
    this.connecting.set(uiId, promise);
    return promise;
  }

  /**
   * Resolve a WRITE-access live MCP connectionId for a UI connection id. Opens
   * the saved connection with `access: "write"`; the backend's read/write guard
   * decides whether write is granted. Errors propagate so the caller can surface
   * "writes are disabled" to the user.
   */
  private async resolveWriteConnection(uiId: string): Promise<string> {
    const cached = this.writeByUiId.get(uiId);
    if (cached) return cached;

    const inFlight = this.writeConnecting.get(uiId);
    if (inFlight) return inFlight;

    const savedId = savedIdFromUiId(uiId);
    const args =
      savedId == null
        ? { connectionId: uiId, access: "write" }
        : { savedConnectionId: savedId, access: "write" };

    const promise = this.callTool<{ connectionId: string }>("connect", args)
      .then((r) => {
        this.writeByUiId.set(uiId, r.connectionId);
        return r.connectionId;
      })
      .finally(() => this.writeConnecting.delete(uiId));
    this.writeConnecting.set(uiId, promise);
    return promise;
  }

  // --- BackendClient ------------------------------------------------------

  /** Open/resolve the saved connection and return the live MCP connectionId. */
  async connect(connectionId: string): Promise<string> {
    return this.resolveConnection(connectionId);
  }

  async listDockerContainers(): Promise<DockerContainer[]> {
    // The MCP HTTP server exposes no Docker inspection; degrade to none.
    return [];
  }

  async listConnections(): Promise<Connection[]> {
    const saved = await this.callTool<SavedConnectionDTO[]>("list_saved_connections");
    return saved.map((c) => ({
      id: idFor(c.savedConnectionId),
      name: c.name,
      kind: kindFor(c.connectionType),
      host:
        c.host != null
          ? c.port != null
            ? `${c.host}:${c.port}`
            : c.host
          : c.database ?? undefined,
      connected: c.open,
    }));
  }

  async listSchemas(connectionId: string): Promise<Schema[]> {
    const live = await this.resolveConnection(connectionId);
    const schemas = await this.callTool<string[]>("list_schemas", { connectionId: live });
    return schemas.map((name) => ({ name, tableCount: 0 }));
  }

  async listTables(connectionId: string, schema?: string): Promise<TableSummary[]> {
    const live = await this.resolveConnection(connectionId);
    const res = await this.callTool<{
      tables: { name: string; schema: string; estimatedRows?: number | null }[];
      views: { name: string; schema: string; estimatedRows?: number | null }[];
    }>("list_tables", schema ? { connectionId: live, schema } : { connectionId: live });
    const tables: TableSummary[] = res.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      type: "table",
      // estimatedRows comes from the backend's pg_class.reltuples estimate
      // (Postgres); null/missing on other dialects -> 0 (no count shown).
      rowEstimate: t.estimatedRows ?? 0,
    }));
    const views: TableSummary[] = res.views.map((v) => ({
      schema: v.schema,
      name: v.name,
      type: "view",
      rowEstimate: v.estimatedRows ?? 0,
    }));
    return [...tables, ...views];
  }

  async describeTable(
    connectionId: string,
    table: string,
    schema?: string
  ): Promise<TableDescription> {
    const live = await this.resolveConnection(connectionId);
    const dto = await this.callTool<DescribeTableDTO>(
      "describe_table",
      schema ? { connectionId: live, table, schema } : { connectionId: live, table }
    );
    const pk = new Set(dto.primaryKey ?? []);
    return {
      schema: dto.schema ?? schema ?? "public",
      table: dto.table,
      columns: dto.columns.map((c) => ({
        name: c.name,
        dataType: c.type,
        nullable: c.nullable,
        primaryKey: pk.has(c.name),
        default: c.default,
      })),
      indexes: dto.indexes ?? [],
      foreignKeys: (dto.foreignKeys ?? []).map((k) => ({
        column: k.column,
        references: `${k.referencesSchema ? `${k.referencesSchema}.` : ""}${k.referencesTable}(${k.referencesColumn})`,
      })),
      incomingForeignKeys: (dto.incomingForeignKeys ?? []).map((k) => ({
        fromSchema: k.fromSchema ?? dto.schema ?? schema ?? "public",
        fromTable: k.fromTable,
        fromColumn: k.fromColumn,
        toColumn: k.toColumn,
      })),
    };
  }

  async getRelationCounts(params: GetRelationCountsParams): Promise<RelationCount[]> {
    // Best-effort: the get_relation_counts tool may not exist on every backend
    // build. On any error (unknown tool, RPC failure) degrade to no counts.
    try {
      const live = await this.resolveConnection(params.connectionId);
      // The backend tool returns { table, schema, truncated, relations: [...] }.
      const raw = await this.callTool<{
        relations?: {
          fromSchema: string | null;
          fromTable: string;
          fromColumn?: string;
          toColumn?: string;
          count: number | null;
          error?: string;
        }[];
      }>("get_relation_counts", {
        connectionId: live,
        table: params.table,
        ...(params.schema ? { schema: params.schema } : {}),
        rowKey: params.rowKey,
      });
      return (raw?.relations ?? [])
        .filter((r) => r.count != null && r.fromColumn && r.toColumn)
        .map((r) => ({
          fromSchema: r.fromSchema ?? params.schema ?? "public",
          fromTable: r.fromTable,
          fromColumn: r.fromColumn as string,
          toColumn: r.toColumn as string,
          count: r.count as number,
        }));
    } catch {
      return [];
    }
  }

  async getPageRelationCounts(
    params: PageRelationCountsParams
  ): Promise<PageRelationCounts> {
    const out: PageRelationCounts = {};
    if (!params.rowKeys.length || !params.relations.length) return out;
    try {
      const live = await this.resolveConnection(params.connectionId);
      const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lit = (v: CellValue) => {
        if (v === null) return "NULL";
        if (typeof v === "number") return String(v);
        if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        return `'${String(v).replace(/'/g, "''")}'`;
      };
      const inList = params.rowKeys.map(lit).join(", ");
      // One grouped query per relation: SELECT fk, count(*) ... WHERE fk IN (...) GROUP BY fk
      await Promise.all(
        params.relations.map(async (rel) => {
          const qualified = rel.schema
            ? `${ident(rel.schema)}.${ident(rel.table)}`
            : ident(rel.table);
          const col = ident(rel.fromColumn);
          const sql = `SELECT ${col} AS fk, count(*) AS n FROM ${qualified} WHERE ${col} IN (${inList}) GROUP BY ${col}`;
          try {
            const results = await this.callTool<
              { rows: Record<string, CellValue>[] }[]
            >("execute_query", { connectionId: live, sql });
            const rows = results?.[0]?.rows ?? [];
            const byKey: Record<string, number> = {};
            for (const r of rows) {
              const k = r.fk;
              if (k === null || k === undefined) continue;
              byKey[String(k)] = Number(r.n) || 0;
            }
            out[rel.id] = byKey;
          } catch {
            out[rel.id] = {};
          }
        })
      );
      return out;
    } catch {
      return out;
    }
  }

  async getTableStats(params: GetTableStatsParams): Promise<TableStats> {
    // Best-effort: the get_table_stats tool may be absent on older backends.
    // Degrade to no stats so the grid falls back to dataType-based inference.
    try {
      const live = await this.resolveConnection(params.connectionId);
      const raw = await this.callTool<{
        columns?: {
          name: string;
          top_values?: { value: CellValue; count: number }[];
          nullFraction?: number;
        }[];
      }>("get_table_stats", {
        connectionId: live,
        table: params.table,
        ...(params.schema ? { schema: params.schema } : {}),
      });
      return {
        columns: (raw?.columns ?? []).map((c) => ({
          name: c.name,
          top_values: (c.top_values ?? []) as TopValue[],
          ...(typeof c.nullFraction === "number" ? { nullFraction: c.nullFraction } : {}),
        })),
      };
    } catch {
      return { columns: [] };
    }
  }

  async getMcpStatus(): Promise<McpStatus> {
    // HTTP backend: no IPC status handler. Report a best-effort status derived
    // from the endpoint we talk to (no live request stats over the wire).
    let port: number | null = null;
    try {
      port = Number(new URL(this.baseUrl).port) || null;
    } catch {
      /* ignore */
    }
    return {
      running: true,
      url: this.baseUrl,
      port,
      requests: 0,
      errors: 0,
      lastCall: null,
      writeConnections: [],
    };
  }

  // Creating/saving connections requires the Electron appdb; not available over
  // the MCP HTTP backend (it only exposes already-saved connections).
  async newConnection(): Promise<ConnectionConfig> {
    throw new Error("Creating connections is not supported over the MCP HTTP backend");
  }
  async saveConnection(_config: ConnectionConfig): Promise<Connection> {
    throw new Error("Saving connections is not supported over the MCP HTTP backend");
  }
  async testConnection(_config: ConnectionConfig): Promise<void> {
    throw new Error("Testing connections is not supported over the MCP HTTP backend");
  }
  async getConnectionConfig(_connectionId: string): Promise<ConnectionConfig | null> {
    return null;
  }
  async removeConnection(_connectionId: string): Promise<void> {
    throw new Error("Removing connections is not supported over the MCP HTTP backend");
  }

  async getRecords(params: GetRecordsParams): Promise<RecordPage> {
    const live = await this.resolveConnection(params.connectionId);
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    // Always describe so the grid gets ordered, typed columns. (The get_records
    // tool returns rows as objects keyed by column name, with no metadata.)
    const desc = await this.describeTable(params.connectionId, params.table, params.schema);
    const columns = desc.columns;

    const started = performance.now();
    let rowObjs: Record<string, CellValue>[];
    const sort = params.orderBy?.[0];
    const where = params.where?.trim();

    if (sort || where) {
      // The get_records tool ignores orderBy and has no WHERE param, so issue an
      // explicit query composing the compiled filter, sort, and paging.
      const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const qualified = params.schema
        ? `${ident(params.schema)}.${ident(params.table)}`
        : ident(params.table);
      const whereClause = where ? ` WHERE ${where}` : "";
      const orderClause = sort
        ? ` ORDER BY ${ident(sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}`
        : "";
      const sql = `SELECT * FROM ${qualified}${whereClause}${orderClause} LIMIT ${limit} OFFSET ${offset}`;
      const results = await this.callTool<
        { rows: Record<string, CellValue>[]; rowCount: number }[]
      >("execute_query", { connectionId: live, sql });
      rowObjs = results?.[0]?.rows ?? [];
    } else {
      const res = await this.callTool<{
        rowCount: number;
        rows: Record<string, CellValue>[];
      }>(
        "get_records",
        params.schema
          ? { connectionId: live, table: params.table, schema: params.schema, offset, limit }
          : { connectionId: live, table: params.table, offset, limit }
      );
      rowObjs = res.rows ?? [];
    }

    const rows: CellValue[][] = rowObjs.map((obj) => columns.map((c) => normalize(obj[c.name])));
    const elapsedMs = Math.round(performance.now() - started);

    return {
      columns,
      rows,
      totalRows: offset + rows.length + (rows.length === limit ? limit : 0),
      loaded: rows.length,
      elapsedMs,
    };
  }

  async executeQuery(connectionId: string, sql: string): Promise<QueryResult> {
    const live = await this.resolveConnection(connectionId);
    const started = performance.now();
    const results = await this.callTool<
      {
        rowCount: number;
        affectedRows: number | null;
        fields: string[];
        rows: Record<string, CellValue>[];
        truncated: boolean;
      }[]
    >("execute_query", { connectionId: live, sql });
    const elapsedMs = Math.round(performance.now() - started);

    const first = results?.[0];
    const fields = first?.fields ?? [];
    const columns: ColumnDef[] = fields.map((name) => ({
      name,
      dataType: "text",
      nullable: true,
      primaryKey: false,
    }));
    const rows: CellValue[][] = (first?.rows ?? []).map((obj) =>
      fields.map((f) => normalize(obj[f]))
    );

    const op = (sql.trim().split(/\s+/)[0] || "SELECT").toUpperCase();
    const tableMatch = sql.match(/\b(?:from|join|into|update)\s+([a-z_"][\w".]*)/i);
    const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "";

    return {
      columns,
      rows,
      rowCount: first?.rowCount ?? rows.length,
      elapsedMs,
      tables: table ? [table] : [],
      operation: op,
    };
  }

  async executeWrite(connectionId: string, sql: string): Promise<QueryResult> {
    // Open (or reuse) a write-access connection. A read-only connection / the
    // MCP read guard rejects the `connect` with access:"write" here.
    let live: string;
    try {
      live = await this.resolveWriteConnection(connectionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Writes are disabled for this connection. The backend declined write access: ${msg}`
      );
    }
    const started = performance.now();
    const results = await this.callTool<
      {
        rowCount: number;
        affectedRows: number | null;
        fields: string[];
        rows: Record<string, CellValue>[];
        truncated: boolean;
      }[]
    >("execute_query", { connectionId: live, sql });
    const elapsedMs = Math.round(performance.now() - started);

    const first = results?.[0];
    const op = (sql.trim().split(/\s+/)[0] || "UPDATE").toUpperCase();
    const tableMatch = sql.match(/\b(?:from|join|into|update)\s+([a-z_"][\w".]*)/i);
    const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "";
    return {
      columns: [],
      rows: [],
      rowCount: first?.affectedRows ?? first?.rowCount ?? 0,
      elapsedMs,
      tables: table ? [table] : [],
      operation: op,
    };
  }

  async getSchemaGraph(
    connectionId: string,
    options?: GetSchemaGraphOptions
  ): Promise<SchemaGraph> {
    const live = await this.resolveConnection(connectionId);
    const schema = options?.schema;
    const raw = await this.callTool<{
      nodes: { table: string; schema: string }[];
      edges: {
        fromTable: string;
        fromSchema: string;
        fromColumn: string;
        toTable: string;
        toSchema: string;
        toColumn: string;
      }[];
    }>("get_schema_graph", schema ? { connectionId: live, schema } : { connectionId: live });

    const allEdges: SchemaGraphEdge[] = raw.edges.map((e) => ({
      fromSchema: e.fromSchema,
      fromTable: e.fromTable,
      fromColumn: e.fromColumn,
      toSchema: e.toSchema,
      toTable: e.toTable,
      toColumn: e.toColumn,
    }));

    // Depth-from-focus: choose the node set BEFORE describing, so a focused
    // graph only describes the tables within `depth` FK-hops of the root
    // (the edges come free from get_schema_graph). Without a root, keep all.
    const rootKey = rootKeyOf(options);
    const keep = rootKey ? reachableKeys(allEdges, rootKey, options?.depth ?? 1) : null;
    const rawNodes = keep
      ? raw.nodes.filter((n) => keep.has(graphKey(n.schema, n.table)))
      : raw.nodes;
    const edges = keep
      ? allEdges.filter(
          (e) =>
            keep.has(graphKey(e.fromSchema, e.fromTable)) &&
            keep.has(graphKey(e.toSchema, e.toTable))
        )
      : allEdges;

    // Enrich the selected nodes with a few columns via describe_table (bounded concurrency).
    const nodes: SchemaGraph["nodes"] = [];
    const limit = 8;
    for (let i = 0; i < rawNodes.length; i += limit) {
      const chunk = rawNodes.slice(i, i + limit);
      const described = await Promise.all(
        chunk.map((n) =>
          this.describeTable(connectionId, n.table, n.schema)
            .then((d) => d.columns.slice(0, 8))
            .catch(() => [] as ColumnDef[])
        )
      );
      chunk.forEach((n, j) => {
        nodes.push({
          schema: n.schema,
          table: n.table,
          columns: described[j].map((c) => ({
            name: c.name,
            dataType: c.dataType,
            primaryKey: c.primaryKey,
          })),
        });
      });
    }

    return { nodes, edges };
  }
}

/** Coerce arbitrary JSON values from the wire into the grid's CellValue union. */
function normalize(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  // Dates, buffers, json/array objects — render as text.
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
