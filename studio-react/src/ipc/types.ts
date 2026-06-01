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
  /** Human label such as "PRD" rendered as a colored tag. */
  tag?: string;
  tagColor?: "danger" | "warning" | "success" | "info" | "neutral";
  connected: boolean;
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

export type CellValue = string | number | boolean | null;

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

/**
 * The single narrow seam between the renderer and the backend.
 * A real implementation posts each call over a MessagePort
 * (`$util.send('<handler>', args)`); the mock implementation resolves
 * canned data. Keep this interface stable.
 */
export interface BackendClient {
  listConnections(): Promise<Connection[]>;
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
  getSchemaGraph(connectionId: string, schema?: string): Promise<SchemaGraph>;
  /**
   * Best-effort related-row counts for a single source row, used to badge the
   * relation columns in the grid. Implementations should resolve to `[]` (not
   * reject) when the underlying tool is unavailable so the grid degrades
   * gracefully to count-less chips.
   */
  getRelationCounts(params: GetRelationCountsParams): Promise<RelationCount[]>;
}
