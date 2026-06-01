import { z } from "zod";
import _ from "lodash";
import { ConnHandlers } from "@commercial/backend/handlers/connHandlers";
import { allStates, state } from "@/handlers/handlerState";
import { checkSqlAccess, GuardDialect, McpAccess } from "./sqlGuard";

/** Hard cap on rows returned to an MCP client, regardless of requested limit. */
const MAX_ROWS = 1000;
const DEFAULT_ROWS = 100;

export interface ToolDeps {
  /** Fallback access level for connections that have no explicit `mcpAccess`. */
  defaultAccess: McpAccess;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** sql-query-identifier dialect for a Beekeeper connectionType. */
export function dialectForConnectionType(connectionType?: string): GuardDialect {
  switch (connectionType) {
    case "postgresql":
    case "redshift":
    case "cockroachdb":
      return "psql";
    case "mysql":
    case "mariadb":
    case "tidb":
      return "mysql";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "mssql";
    case "bigquery":
      return "bigquery";
    case "oracle":
      return "oracle";
    default:
      return "generic";
  }
}

/** Access level for a connection: explicit override, else the server default. */
function accessFor(sId: string, defaultAccess: McpAccess): McpAccess {
  return state(sId)?.mcpAccess ?? defaultAccess;
}

/** Resolve a connection by sId, throwing if it isn't exposed/connected. */
function requireExposed(sId: string, defaultAccess: McpAccess) {
  const s = state(sId);
  if (!s || !s.connection) {
    throw new Error(`Unknown or disconnected connection: ${sId}`);
  }
  const access = accessFor(sId, defaultAccess);
  if (access === "none") {
    throw new Error(`Connection ${sId} is not exposed over MCP`);
  }
  return { s, access };
}

export function createTools(deps: ToolDeps): McpTool[] {
  const { defaultAccess } = deps;

  return [
    {
      name: "list_connections",
      description:
        "List database connections currently open in Beekeeper Studio that are exposed to MCP. " +
        "Returns each connection's id (use it as `connectionId` in other tools), name, database type, " +
        "current database, and access level (read = SELECT/WITH/EXPLAIN only, write = any SQL).",
      inputSchema: {},
      async handler() {
        const conns = allStates()
          .map(({ sId, state: s }) => {
            const access = accessFor(sId, defaultAccess);
            if (access === "none" || !s.connection) return null;
            const cfg = s.usedConfig;
            return {
              connectionId: sId,
              name: cfg?.name ?? null,
              connectionType: cfg?.connectionType ?? s.connection.connectionType ?? null,
              database: s.database ?? cfg?.defaultDatabase ?? null,
              mcpAccess: access,
            };
          })
          .filter(Boolean);
        return ok(conns);
      },
    },

    {
      name: "list_schemas",
      description: "List the schemas available in a connection.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        requireExposed(sId, defaultAccess);
        const schemas = await ConnHandlers["conn/listSchemas"]({ sId });
        return ok(schemas);
      },
    },

    {
      name: "list_tables",
      description:
        "List tables and views in a connection, optionally filtered to a single schema.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        schema: z.string().optional().describe("Restrict to this schema"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        requireExposed(sId, defaultAccess);
        const filter = args.schema ? { schema: String(args.schema) } : undefined;
        const [tables, views] = await Promise.all([
          ConnHandlers["conn/listTables"]({ filter, sId }),
          ConnHandlers["conn/listViews"]({ filter, sId }),
        ]);
        return ok({
          tables: tables.map((t) => ({ name: t.name, schema: t.schema, entityType: "table" })),
          views: views.map((v) => ({ name: v.name, schema: v.schema, entityType: "view" })),
        });
      },
    },

    {
      name: "describe_table",
      description:
        "Describe a table: columns (name, type, nullable, default), primary key, indexes and foreign keys.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        table: z.string().describe("Table name"),
        schema: z.string().optional().describe("Schema the table belongs to"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        requireExposed(sId, defaultAccess);
        const table = String(args.table);
        const schema = args.schema ? String(args.schema) : undefined;
        const [columns, primaryKeys, indexes, keys] = await Promise.all([
          ConnHandlers["conn/listTableColumns"]({ table, schema, sId }),
          ConnHandlers["conn/getPrimaryKeys"]({ table, schema, sId }),
          ConnHandlers["conn/listTableIndexes"]({ table, schema, sId }),
          ConnHandlers["conn/getTableKeys"]({ table, schema, sId }),
        ]);
        return ok({
          table,
          schema: schema ?? null,
          columns: columns.map((c) => ({
            name: c.columnName,
            type: c.dataType,
            nullable: c.nullable,
            default: c.defaultValue ?? null,
          })),
          primaryKey: primaryKeys.map((pk) => pk.columnName),
          indexes: indexes.map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
          foreignKeys: keys.map((k) => ({
            column: k.fromColumn,
            referencesTable: k.toTable,
            referencesColumn: k.toColumn,
            referencesSchema: k.toSchema,
          })),
        });
      },
    },

    {
      name: "get_schema_graph",
      description:
        "Return the foreign-key relationship graph for a connection: nodes (tables) and edges " +
        "(foreign keys). Use this to understand how tables relate before querying.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        schema: z.string().optional().describe("Restrict the graph to this schema"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        requireExposed(sId, defaultAccess);
        const filter = args.schema ? { schema: String(args.schema) } : undefined;
        const tables = await ConnHandlers["conn/listTables"]({ filter, sId });
        const edges: unknown[] = [];
        // Fetch keys per table with bounded concurrency to avoid hammering the pool.
        for (const chunk of _.chunk(tables, 8)) {
          const keysPerTable = await Promise.all(
            chunk.map((t) =>
              ConnHandlers["conn/getTableKeys"]({ table: t.name, schema: t.schema, sId })
            )
          );
          chunk.forEach((t, i) => {
            for (const k of keysPerTable[i]) {
              edges.push({
                fromTable: t.name,
                fromSchema: t.schema,
                fromColumn: k.fromColumn,
                toTable: k.toTable,
                toSchema: k.toSchema,
                toColumn: k.toColumn,
              });
            }
          });
        }
        return ok({
          nodes: tables.map((t) => ({ table: t.name, schema: t.schema })),
          edges,
        });
      },
    },

    {
      name: "get_records",
      description:
        "Fetch rows from a table with optional paging. Read-only and safe on any connection.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        table: z.string().describe("Table name"),
        schema: z.string().optional().describe("Schema the table belongs to"),
        offset: z.number().int().min(0).optional().describe("Rows to skip (default 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_ROWS)
          .optional()
          .describe(`Max rows to return (default ${DEFAULT_ROWS}, hard cap ${MAX_ROWS})`),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        requireExposed(sId, defaultAccess);
        const table = String(args.table);
        const schema = args.schema ? String(args.schema) : undefined;
        const offset = typeof args.offset === "number" ? args.offset : 0;
        const limit = Math.min(
          typeof args.limit === "number" ? args.limit : DEFAULT_ROWS,
          MAX_ROWS
        );
        const result = await ConnHandlers["conn/selectTop"]({
          table,
          offset,
          limit,
          orderBy: [],
          filters: [],
          schema,
          sId,
        });
        return ok({ rowCount: result.result.length, rows: result.result });
      },
    },

    {
      name: "execute_query",
      description:
        "Run a SQL query against a connection. On read-only connections only SELECT/WITH/EXPLAIN/SHOW " +
        "statements are allowed; on write connections any SQL runs, including INSERT/UPDATE/DELETE and DDL.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        sql: z.string().describe("SQL to execute"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        const { s, access } = requireExposed(sId, defaultAccess);
        const sql = String(args.sql);
        const dialect = dialectForConnectionType(s.usedConfig?.connectionType);
        const guard = checkSqlAccess(sql, access, dialect);
        if (!guard.allowed) {
          return fail(`Rejected: ${guard.reason}`);
        }
        const results = await ConnHandlers["conn/executeQuery"]({
          queryText: sql,
          options: {},
          sId,
        });
        // executeQuery returns one result per statement; cap rows per result.
        const trimmed = (results ?? []).map((r) => ({
          rowCount: r.rowCount ?? r.rows?.length ?? 0,
          affectedRows: r.affectedRows ?? null,
          fields: r.fields?.map((f) => f.name ?? f) ?? [],
          rows: (r.rows ?? []).slice(0, MAX_ROWS),
          truncated: (r.rows?.length ?? 0) > MAX_ROWS,
        }));
        return ok(trimmed);
      },
    },
  ];
}
