/**
 * Shared IPC types. These intentionally mirror the shapes the real Electron
 * backend already exposes (see SlashTable/Beekeeper MCP tools:
 * list_connections, list_schemas, list_tables, describe_table,
 * execute_query, get_records). The mock client and a future MessagePort
 * client both implement {@link BackendClient} so the UI never changes.
 */

export interface Connection {
  id: string;
  name: string;
  /** Engine: postgres | mysql | sqlite | sqlserver ... */
  kind: "postgres" | "mysql" | "sqlite" | "sqlserver";
  host?: string;
  /** Default database name (shown in the title-bar connection indicator). */
  database?: string;
  /** Human label such as "PRD" rendered as a colored tag. */
  tag?: string;
  tagColor?: "danger" | "warning" | "success" | "info" | "neutral";
  /**
   * Optional folder this connection is grouped under in the sidebar (e.g.
   * "Production", "Demo"). Connections without a folder render at the top level.
   * Real MCP connections have no folders — that's fine.
   */
  folder?: string;
  /** Optional connection "paint" — a CSS color for the leading dot (SlashTable). */
  paint?: string;
  connected: boolean;
}

/**
 * A saved-connection config as exchanged with the backend (appdb/saved/* and
 * conn/test|create). Mirrors the backend SavedConnection / IConnection record;
 * loosely typed (index signature) since the form only sets a known subset and
 * the backend fills the rest with defaults (appdb/saved/new).
 */
export interface ConnectionConfig {
  id?: number | null;
  name?: string | null;
  connectionType?: string;
  host?: string | null;
  port?: number | null;
  defaultDatabase?: string | null;
  username?: string | null;
  password?: string | null;
  /** AI-access level honored by the in-app MCP server. */
  mcpAccess?: "none" | "read" | "write";
  // SSH tunnel (simple): auth via agent | userpass | keyfile.
  sshEnabled?: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUsername?: string | null;
  sshMode?: null | "agent" | "userpass" | "keyfile";
  sshPassword?: string | null;
  sshKeyfile?: string | null;
  sshKeyfilePassword?: string | null;
  [k: string]: unknown;
}

/**
 * A running Docker container hosting a database, detected on the host for
 * one-click connect (mirrors SlashTable's Docker auto-detect). Sourced from the
 * backend `docker/listContainers` handler; best-effort, so the list is empty
 * when Docker is unavailable.
 */
export interface DockerContainer {
  id: string;
  /** Container name (leading slash stripped). */
  name: string;
  /** Image reference, e.g. "postgres:16". */
  image: string;
  /** Engine, mapped onto the same union as {@link Connection.kind}. */
  kind: Connection["kind"];
  /** Host the container is reachable on (localhost for published ports). */
  host: string;
  /** Published host port, or the engine default. */
  port: number | null;
  /** Raw status string, e.g. "Up 3 hours". */
  status: string;
  running: boolean;
}

export interface Schema {
  name: string;
  tableCount: number;
}

export interface TableSummary {
  schema: string;
  name: string;
  /** "table" | "view" | "materialized-view" */
  type: "table" | "view" | "materialized-view";
  rowEstimate: number;
}

export interface ColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  default?: string | null;
}

/**
 * An incoming foreign key: a child table that references this table. Drives the
 * "1:N" (OneToMany) relation columns in the grid and child drilldown.
 */
export interface IncomingForeignKey {
  /** Schema of the referencing (child) table. */
  fromSchema: string;
  /** The referencing (child) table. */
  fromTable: string;
  /** The FK column on the child table. */
  fromColumn: string;
  /** The column on *this* table the FK points at (usually the PK). */
  toColumn: string;
}

export interface TableDescription {
  schema: string;
  table: string;
  columns: ColumnDef[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  /** Outgoing FKs: columns on this table that point at a parent (N:1). */
  foreignKeys: { column: string; references: string }[];
  /** Incoming FKs: child tables that reference this table (1:N). */
  incomingForeignKeys: IncomingForeignKey[];
}

/**
 * A per-relationship row count for a single source row, keyed by the same
 * fields as an incoming FK. Optional/best-effort: if the backend tool is
 * unavailable the UI simply renders relation chips without a count.
 */
export interface RelationCount {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toColumn: string;
  count: number;
}

export interface GetRelationCountsParams {
  connectionId: string;
  table: string;
  schema?: string;
  /** PK value of the source row whose related counts we want. */
  rowKey: CellValue;
}

/**
 * Per-page, per-relation row counts: for one incoming relation (a child table),
 * how many child rows reference each of the page's PK values. Fetched with a
 * single grouped query per relation so the whole visible page is cheap.
 */
export interface PageRelationCountsParams {
  connectionId: string;
  /** The parent table whose page we're counting children for. */
  schema?: string;
  /** The referenced column on the parent (usually its PK). */
  toColumn: string;
  /** The page's `toColumn` values (the visible rows' PKs). */
  rowKeys: CellValue[];
  /** Incoming relations to count, each a child table + its FK column. */
  relations: {
    /** Stable relation id (matches RelationColumn.id) to key results by. */
    id: string;
    schema?: string;
    /** Child table. */
    table: string;
    /** Child FK column referencing the parent's `toColumn`. */
    fromColumn: string;
  }[];
}

/**
 * Result of {@link BackendClient.getPageRelationCounts}: for each relation id,
 * a map of parent-PK-value (stringified) -> child count. Missing keys mean 0.
 */
export type PageRelationCounts = Record<string, Record<string, number>>;

export type CellValue = string | number | boolean | null;

/** A single (value, count) pair from a column's value distribution. */
export interface TopValue {
  value: CellValue;
  count: number;
}

/**
 * Per-column value statistics, used by {@link inferSemanticType} to classify a
 * column by sampling its most common values, and (optionally) by formatting
 * heuristics. Sourced from the MCP `get_table_stats` tool.
 */
export interface ColumnStats {
  name: string;
  /** Top ~10 most common non-null values, descending by count. */
  top_values: TopValue[];
  /** Fraction of rows that are NULL in this column (0..1), when known. */
  nullFraction?: number;
}

export interface TableStats {
  /** Per-column stats, keyed for lookup in the grid/detail panel. */
  columns: ColumnStats[];
}

export interface GetTableStatsParams {
  connectionId: string;
  table: string;
  schema?: string;
}

export interface RecordPage {
  columns: ColumnDef[];
  rows: CellValue[][];
  /** total rows in the table (estimate) */
  totalRows: number;
  /** rows actually fetched into this page */
  loaded: number;
  /** wall-clock time the query took, ms */
  elapsedMs: number;
}

export interface QueryResult {
  columns: ColumnDef[];
  rows: CellValue[][];
  rowCount: number;
  elapsedMs: number;
  /** affected tables, for the activity log */
  tables: string[];
  /** detected operation, e.g. SELECT / INSERT */
  operation: string;
}

export interface GetRecordsParams {
  connectionId: string;
  schema: string;
  table: string;
  limit?: number;
  offset?: number;
  /** Optional client-driven sort, applied via getRecords. */
  orderBy?: { column: string; direction: "asc" | "desc" }[];
  /**
   * Optional compiled SQL WHERE expression (without the leading `WHERE`),
   * produced by {@link compileWhere} in lib/filters.ts. When present, records
   * are filtered by it. The mock honors a simple subset; the MCP client appends
   * it to a SELECT.
   */
  where?: string;
}

/** A table node in the schema relationship graph. */
export interface SchemaGraphNode {
  schema: string;
  table: string;
  /** A few representative columns to render inside the node. */
  columns: { name: string; dataType?: string; primaryKey?: boolean }[];
}

/** A foreign-key edge between two tables in the schema graph. */
export interface SchemaGraphEdge {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface SchemaGraph {
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
}

export interface GetSchemaGraphOptions {
  /** Restrict the graph to a single schema. */
  schema?: string;
  /**
   * Focus the graph on a root table: only tables within `depth` FK-hops of it
   * are returned (a SlashTable "depth-from-focus" graph). Without `rootTable`
   * the whole schema is returned.
   */
  rootTable?: string;
  /** Schema of `rootTable` (defaults to `schema`, then "public"). */
  rootSchema?: string;
  /** Max FK-hops from `rootTable` (default 1). Ignored without `rootTable`. */
  depth?: number;
}

/**
 * The single narrow seam between the renderer and the backend.
 * A real implementation posts each call over a MessagePort
 * (`$util.send('<handler>', args)`); the mock implementation resolves
 * canned data. Keep this interface stable.
 */
export interface BackendClient {
  listConnections(): Promise<Connection[]>;
  /**
   * Running Docker DB containers detected on the host, for one-click connect.
   * Best-effort: implementations resolve to `[]` (not reject) when Docker is
   * unavailable, so the sidebar simply omits the Docker section.
   */
  listDockerContainers(): Promise<DockerContainer[]>;
  /**
   * Open/resolve a saved connection, mapping the UI connection id (e.g. a saved
   * id) to the live backend connectionId. Must be awaited before any
   * schema/data call so requests never fire with an unresolved id. Returns the
   * live connectionId. Idempotent and deduped per connection.
   */
  connect(connectionId: string): Promise<string>;
  listSchemas(connectionId: string): Promise<Schema[]>;
  listTables(connectionId: string, schema?: string): Promise<TableSummary[]>;
  describeTable(
    connectionId: string,
    table: string,
    schema?: string
  ): Promise<TableDescription>;
  getRecords(params: GetRecordsParams): Promise<RecordPage>;
  executeQuery(connectionId: string, sql: string): Promise<QueryResult>;
  /**
   * Run a mutating statement (UPDATE/INSERT/DELETE) on a WRITE connection.
   * The MCP backend re-opens the connection with `access: "write"`; if the
   * connection is read-only (or the MCP read guard is in effect) the call
   * rejects with a clear, surface-able error. Backs the editable row panel's
   * preview→commit flow. Implementations that cannot grant write access should
   * reject rather than silently no-op.
   */
  executeWrite(connectionId: string, sql: string): Promise<QueryResult>;
  /**
   * Foreign-key relationship graph. With {@link GetSchemaGraphOptions.rootTable}
   * the result is limited to the tables within `depth` FK-hops of that table
   * (depth-from-focus); otherwise the whole schema is returned.
   */
  getSchemaGraph(
    connectionId: string,
    options?: GetSchemaGraphOptions
  ): Promise<SchemaGraph>;
  /**
   * Best-effort related-row counts for a single source row, used to badge the
   * relation columns in the grid. Implementations should resolve to `[]` (not
   * reject) when the underlying tool is unavailable so the grid degrades
   * gracefully to count-less chips.
   */
  getRelationCounts(params: GetRelationCountsParams): Promise<RelationCount[]>;
  /**
   * Per-page child counts for a set of incoming relations, computed with one
   * grouped query per relation (`SELECT fk, count(*) ... WHERE fk IN (...) GROUP
   * BY fk`) so the whole visible page is cheap. Best-effort: resolves to `{}` on
   * error so the grid degrades to count-less chips.
   */
  getPageRelationCounts(params: PageRelationCountsParams): Promise<PageRelationCounts>;
  /**
   * Per-column value statistics (top values + null fraction) used to infer
   * semantic cell types. Best-effort: implementations should resolve to a
   * `{ columns: [] }` shape (not reject) when the underlying tool is
   * unavailable so the grid degrades to dataType-based inference.
   */
  getTableStats(params: GetTableStatsParams): Promise<TableStats>;
  /**
   * Live status of the in-app MCP server, for the status-bar popover. Best-effort:
   * the HTTP/mock backends return a minimal/stubbed status.
   */
  getMcpStatus(): Promise<McpStatus>;

  /** A fresh connection config with backend defaults (for a new connection form). */
  newConnection(): Promise<ConnectionConfig>;
  /** Persist a connection config; returns the saved connection (UI shape, with its id). */
  saveConnection(config: ConnectionConfig): Promise<Connection>;
  /** Test reachability of a connection config; rejects with the backend error. */
  testConnection(config: ConnectionConfig): Promise<void>;
  /** Load a saved connection's full config by UI id, for editing. */
  getConnectionConfig(connectionId: string): Promise<ConnectionConfig | null>;
  /** Delete a saved connection by UI id. */
  removeConnection(connectionId: string): Promise<void>;
}

/** Live MCP server status (mirrors the backend `mcp/status` handler). */
export interface McpStatus {
  running: boolean;
  url: string | null;
  port: number | null;
  requests: number;
  errors: number;
  lastCall: { name: string; durationMs: number } | null;
  /** Names of saved connections whose AI access is 'write'. */
  writeConnections: string[];
}
