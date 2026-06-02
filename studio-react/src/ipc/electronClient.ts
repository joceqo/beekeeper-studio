import type {
  BackendClient,
  CellValue,
  ColumnDef,
  Connection,
  GetRecordsParams,
  GetRelationCountsParams,
  GetSchemaGraphOptions,
  GetTableStatsParams,
  IncomingForeignKey,
  PageRelationCounts,
  PageRelationCountsParams,
  QueryResult,
  RecordPage,
  RelationCount,
  Schema,
  SchemaGraph,
  TableDescription,
  TableStats,
  TableSummary,
} from "./types";
import type { BackendTransport } from "./transport";
import { focusGraph } from "@/lib/graph";

/**
 * BackendClient implementation that drives Beekeeper Studio's REAL backend over
 * the renderer's MessagePort, exactly as the Vue app's
 * ElectronUtilityConnectionClient does (apps/studio/src/lib/utility/
 * ElectronUtilityConnectionClient.ts), but Vue-free. Every method funnels
 * through `transport.send('<handler>', args)` per REACT_IPC_CONTRACT.md §3/§4.
 *
 * Session model: one renderer window has exactly one `sId`, so the utility
 * process holds exactly one live DB connection (`state(sId).connection`). The
 * `connectionId` the UI passes around is purely a UI handle here — all calls
 * target that single session. `connect()` opens a saved connection into the
 * session via `conn/create` (mirroring store/index.ts `connect`).
 */

// --- backend wire shapes (subset we consume) -------------------------------

/** apps/studio/src/common/interfaces/IConnection — the saved-connection record. */
interface IConnectionDTO {
  id?: number;
  name?: string;
  connectionType: string;
  host?: string | null;
  port?: number | null;
  defaultDatabase?: string | null;
  path?: string | null;
  [k: string]: unknown;
}

/** apps/studio/src/lib/db/models.ts TableOrView. */
interface TableOrViewDTO {
  schema?: string;
  name: string;
  entityType: "table" | "view" | "materialized-view" | "routine";
}

/** apps/studio/src/lib/db/models.ts ExtendedTableColumn (SchemaItem + extras). */
interface ExtendedTableColumnDTO {
  columnName: string;
  dataType: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: string;
  hasDefault?: boolean;
}

interface PrimaryKeyColumnDTO {
  columnName: string;
  position: number;
}

interface IndexColumnDTO {
  name: string;
}

/** apps/studio/src/lib/db/models.ts TableIndex. */
interface TableIndexDTO {
  name: string;
  columns: IndexColumnDTO[];
  unique: boolean;
  primary: boolean;
}

/** apps/studio/src/shared/lib/dialects/models.ts TableKey. */
interface TableKeyDTO {
  toTable: string;
  toSchema: string;
  toColumn: string | string[];
  fromTable: string;
  fromSchema: string;
  fromColumn: string | string[];
}

/** apps/studio/src/lib/db/models.ts TableResult ({ result: row objects, fields }). */
interface TableResultDTO {
  result: Record<string, unknown>[];
  fields: { name: string }[];
}

/** apps/studio/src/lib/db/models.ts NgQueryResult. */
interface NgQueryResultDTO {
  fields?: { name?: string; id?: string }[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  affectedRows?: number;
}

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

/** UI connection id encodes the saved-connection numeric id so connect() can find it. */
const idFor = (savedId: number) => `saved:${savedId}`;
const savedIdFromUiId = (uiId: string): number | null => {
  const m = /^saved:(\d+)$/.exec(uiId);
  return m ? Number(m[1]) : null;
};

function firstOf(c: string | string[]): string {
  return Array.isArray(c) ? c[0] : c;
}

/** Coerce wire values into the grid's CellValue union (same as mcpClient). */
function normalize(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** SQL identifier quoting for best-effort relation/stat queries. */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (v: CellValue) => {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
};

export class ElectronBackendClient implements BackendClient {
  private readonly transport: BackendTransport;

  /** The osUser, fetched once via the preload bridge (store/index.ts fetchUsername). */
  private osUser: string | undefined;
  private osUserPromise: Promise<string> | undefined;

  /** Saved-connection record cache, keyed by UI id, from listConnections(). */
  private readonly savedById = new Map<string, IConnectionDTO>();

  /** The UI id currently open in this session (one connection per window). */
  private openUiId: string | undefined;
  /** In-flight connect() per UI id, to dedupe concurrent opens. */
  private readonly connecting = new Map<string, Promise<string>>();

  constructor(transport: BackendTransport) {
    this.transport = transport;
  }

  private send<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return this.transport.send<T>(name, args);
  }

  private async getOsUser(): Promise<string> {
    if (this.osUser != null) return this.osUser;
    if (!this.osUserPromise) {
      const fetchUsername = window.main?.fetchUsername;
      this.osUserPromise = (fetchUsername ? fetchUsername() : Promise.resolve(""))
        .then((name) => {
          this.osUser = name;
          return name;
        })
        .catch(() => {
          this.osUser = "";
          return "";
        });
    }
    return this.osUserPromise;
  }

  // --- BackendClient ------------------------------------------------------

  async listConnections(): Promise<Connection[]> {
    const saved = await this.send<IConnectionDTO[]>("appdb/saved/find", {});
    const conns: Connection[] = [];
    for (const c of saved) {
      if (c.id == null) continue;
      const uiId = idFor(c.id);
      this.savedById.set(uiId, c);
      const host =
        c.connectionType === "sqlite"
          ? c.path ?? c.defaultDatabase ?? undefined
          : c.host != null
            ? c.port != null
              ? `${c.host}:${c.port}`
              : c.host
            : c.defaultDatabase ?? undefined;
      conns.push({
        id: uiId,
        name: c.name ?? `Connection ${c.id}`,
        kind: kindFor(c.connectionType),
        host: host ?? undefined,
        connected: this.openUiId === uiId,
      });
    }
    return conns;
  }

  /**
   * Open the saved connection into this session via conn/create, mirroring the
   * Vue store's connect (store/index.ts:498). Idempotent and deduped: if the
   * requested connection is already open in this session, returns immediately.
   * Returns the UI connection id (the session has a single live connection).
   */
  async connect(connectionId: string): Promise<string> {
    if (this.openUiId === connectionId) return connectionId;

    const inFlight = this.connecting.get(connectionId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      // Ensure the saved-connection record is loaded.
      if (!this.savedById.has(connectionId)) {
        await this.listConnections();
      }
      const config = this.savedById.get(connectionId);
      if (!config) {
        const savedId = savedIdFromUiId(connectionId);
        throw new Error(
          `Unknown connection ${connectionId}${savedId == null ? "" : ` (saved id ${savedId})`}`
        );
      }
      const osUser = await this.getOsUser();
      await this.send<void>("conn/create", { config, osUser });
      this.openUiId = connectionId;
      return connectionId;
    })().finally(() => this.connecting.delete(connectionId));

    this.connecting.set(connectionId, promise);
    return promise;
  }

  async listSchemas(connectionId: string): Promise<Schema[]> {
    await this.connect(connectionId);
    const schemas = await this.send<string[]>("conn/listSchemas", {});
    return (schemas ?? []).map((name) => ({ name, tableCount: 0 }));
  }

  async listTables(connectionId: string, schema?: string): Promise<TableSummary[]> {
    await this.connect(connectionId);
    const filter = schema ? { schema } : undefined;
    const [tables, views] = await Promise.all([
      this.send<TableOrViewDTO[]>("conn/listTables", { filter }),
      this.send<TableOrViewDTO[]>("conn/listViews", { filter }).catch(() => [] as TableOrViewDTO[]),
    ]);
    const out: TableSummary[] = (tables ?? []).map((t) => ({
      schema: t.schema ?? schema ?? "",
      name: t.name,
      type: "table",
      rowEstimate: 0,
    }));
    for (const v of views ?? []) {
      out.push({
        schema: v.schema ?? schema ?? "",
        name: v.name,
        type: v.entityType === "materialized-view" ? "materialized-view" : "view",
        rowEstimate: 0,
      });
    }
    return out;
  }

  async describeTable(
    connectionId: string,
    table: string,
    schema?: string
  ): Promise<TableDescription> {
    await this.connect(connectionId);
    const [columns, pks, indexes, outKeys, inKeys] = await Promise.all([
      this.send<ExtendedTableColumnDTO[]>("conn/listTableColumns", { table, schema }),
      this.send<PrimaryKeyColumnDTO[]>("conn/getPrimaryKeys", { table, schema }).catch(
        () => [] as PrimaryKeyColumnDTO[]
      ),
      this.send<TableIndexDTO[]>("conn/listTableIndexes", { table, schema }).catch(
        () => [] as TableIndexDTO[]
      ),
      this.send<TableKeyDTO[]>("conn/getTableKeys", { table, schema }).catch(
        () => [] as TableKeyDTO[]
      ),
      this.send<TableKeyDTO[]>("conn/getIncomingKeys", { table, schema }).catch(
        () => [] as TableKeyDTO[]
      ),
    ]);

    const pkNames = new Set((pks ?? []).map((p) => p.columnName));

    const cols: ColumnDef[] = (columns ?? []).map((c) => ({
      name: c.columnName,
      dataType: c.dataType,
      nullable: c.nullable ?? true,
      primaryKey: pkNames.has(c.columnName) || c.primaryKey === true,
      default: c.defaultValue ?? null,
    }));

    const foreignKeys = (outKeys ?? []).map((k) => {
      const from = firstOf(k.fromColumn);
      const toCol = firstOf(k.toColumn);
      const ref = `${k.toSchema ? `${k.toSchema}.` : ""}${k.toTable}(${toCol})`;
      return { column: from, references: ref };
    });

    const incomingForeignKeys: IncomingForeignKey[] = (inKeys ?? []).map((k) => ({
      fromSchema: k.fromSchema ?? schema ?? "",
      fromTable: k.fromTable,
      fromColumn: firstOf(k.fromColumn),
      toColumn: firstOf(k.toColumn),
    }));

    return {
      schema: schema ?? "",
      table,
      columns: cols,
      indexes: (indexes ?? []).map((i) => ({
        name: i.name,
        columns: (i.columns ?? []).map((c) => c.name),
        unique: i.unique,
      })),
      foreignKeys,
      incomingForeignKeys,
    };
  }

  async getRecords(params: GetRecordsParams): Promise<RecordPage> {
    await this.connect(params.connectionId);
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    // Columns come from describeTable so the grid gets ordered, typed, PK-aware
    // columns (selectTop's BksField only carries name + bksType).
    const desc = await this.describeTable(params.connectionId, params.table, params.schema);
    const columns = desc.columns;

    const orderBy = (params.orderBy ?? []).map((o) => ({
      field: o.column,
      dir: o.direction === "desc" ? ("DESC" as const) : ("ASC" as const),
    }));
    // compileWhere produces a SQL expression; selectTop takes a filter string.
    const filters = params.where?.trim() ? params.where.trim() : [];

    const started = performance.now();
    const res = await this.send<TableResultDTO>("conn/selectTop", {
      table: params.table,
      offset,
      limit,
      orderBy,
      filters,
      schema: params.schema,
    });
    const elapsedMs = Math.round(performance.now() - started);

    const rowObjs = res?.result ?? [];
    const rows: CellValue[][] = rowObjs.map((obj) => columns.map((c) => normalize(obj[c.name])));

    return {
      columns,
      rows,
      // No exact count here; estimate from the page so the grid can keep paging.
      totalRows: offset + rows.length + (rows.length === limit ? limit : 0),
      loaded: rows.length,
      elapsedMs,
    };
  }

  private async runQuery(connectionId: string, sql: string): Promise<QueryResult> {
    await this.connect(connectionId);
    const started = performance.now();
    const results = await this.send<NgQueryResultDTO[]>("conn/executeQuery", { queryText: sql });
    const elapsedMs = Math.round(performance.now() - started);

    const first = results?.[0];
    const fields = (first?.fields ?? []).map((f) => f.name ?? f.id ?? "");
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
      rowCount: first?.rowCount ?? first?.affectedRows ?? rows.length,
      elapsedMs,
      tables: table ? [table] : [],
      operation: op,
    };
  }

  async executeQuery(connectionId: string, sql: string): Promise<QueryResult> {
    return this.runQuery(connectionId, sql);
  }

  async executeWrite(connectionId: string, sql: string): Promise<QueryResult> {
    // The session connection respects the saved connection's read-only flag;
    // a rejected query surfaces the backend's error to the caller.
    return this.runQuery(connectionId, sql);
  }

  async getRelationCounts(params: GetRelationCountsParams): Promise<RelationCount[]> {
    try {
      await this.connect(params.connectionId);
      const desc = await this.describeTable(params.connectionId, params.table, params.schema);
      const out: RelationCount[] = [];
      await Promise.all(
        desc.incomingForeignKeys.map(async (fk) => {
          const qualified = fk.fromSchema
            ? `${ident(fk.fromSchema)}.${ident(fk.fromTable)}`
            : ident(fk.fromTable);
          const sql = `SELECT count(*) AS n FROM ${qualified} WHERE ${ident(fk.fromColumn)} = ${lit(params.rowKey)}`;
          try {
            const res = await this.send<NgQueryResultDTO[]>("conn/executeQuery", { queryText: sql });
            const n = Number(res?.[0]?.rows?.[0]?.n) || 0;
            out.push({
              fromSchema: fk.fromSchema,
              fromTable: fk.fromTable,
              fromColumn: fk.fromColumn,
              toColumn: fk.toColumn,
              count: n,
            });
          } catch {
            /* skip this relation */
          }
        })
      );
      return out;
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
      await this.connect(params.connectionId);
      const inList = params.rowKeys.map(lit).join(", ");
      await Promise.all(
        params.relations.map(async (rel) => {
          const qualified = rel.schema
            ? `${ident(rel.schema)}.${ident(rel.table)}`
            : ident(rel.table);
          const col = ident(rel.fromColumn);
          const sql = `SELECT ${col} AS fk, count(*) AS n FROM ${qualified} WHERE ${col} IN (${inList}) GROUP BY ${col}`;
          try {
            const res = await this.send<NgQueryResultDTO[]>("conn/executeQuery", { queryText: sql });
            const rows = res?.[0]?.rows ?? [];
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

  async getTableStats(_params: GetTableStatsParams): Promise<TableStats> {
    // Best-effort: no dedicated handler. Degrade to empty so the grid falls back
    // to dataType-based semantic inference.
    return { columns: [] };
  }

  async getSchemaGraph(
    connectionId: string,
    options?: GetSchemaGraphOptions
  ): Promise<SchemaGraph> {
    const schema = options?.schema;
    const nodes: SchemaGraph["nodes"] = [];
    const edges: SchemaGraph["edges"] = [];
    try {
    await this.connect(connectionId);
    const tables = await this.listTables(connectionId, schema);
    const baseTables = tables.filter((t) => t.type === "table");

    const limit = 8;
    for (let i = 0; i < baseTables.length; i += limit) {
      const chunk = baseTables.slice(i, i + limit);
      await Promise.all(
        chunk.map(async (t) => {
          const desc = await this.describeTable(connectionId, t.name, t.schema).catch(() => null);
          if (!desc) {
            nodes.push({ schema: t.schema, table: t.name, columns: [] });
            return;
          }
          nodes.push({
            schema: t.schema,
            table: t.name,
            columns: desc.columns.slice(0, 8).map((c) => ({
              name: c.name,
              dataType: c.dataType,
              primaryKey: c.primaryKey,
            })),
          });
          // Outgoing FK edges: "references" is "schema.table(col)" or "table(col)".
          for (const fk of desc.foreignKeys) {
            const m = /^(?:(.+)\.)?(.+)\((.+)\)$/.exec(fk.references);
            if (!m) continue;
            edges.push({
              fromSchema: t.schema,
              fromTable: t.name,
              fromColumn: fk.column,
              toSchema: m[1] ?? t.schema,
              toTable: m[2],
              toColumn: m[3],
            });
          }
        })
      );
    }
    } catch {
      /* degrade to whatever nodes/edges were gathered before the failure */
    }
    // TODO(perf): for a focused graph this still describes every table, then
    // narrows. A large schema would benefit from an incremental describe-BFS
    // from the root. The render is already depth-limited via focusGraph.
    return focusGraph({ nodes, edges }, options);
  }
}
