import os from "os";
import { z } from "zod";
import _ from "lodash";
import rawLog from "@bksLogger";
import { ConnHandlers } from "@commercial/backend/handlers/connHandlers";
import { allStates, newState, state } from "@/handlers/handlerState";
import { SavedConnection } from "@/common/appdb/models/saved_connection";
import { dialectFor, defaultEscapeString, defaultWrapIdentifier } from "@shared/lib/dialects/models";
import { getDialectData } from "@shared/lib/dialects";
import { checkSqlAccess, GuardDialect, McpAccess } from "./sqlGuard";
import { normalizeMcpAccess, resolveConnectAccess } from "./access";

const log = rawLog.scope("McpTools");

/** Max number of incoming relations counted by get_relation_counts in one call. */
const MAX_RELATIONS = 50;

/** Max number of columns profiled by get_table_stats in one call. */
const MAX_STATS_COLUMNS = 30;
/** Top-N most common values returned per column by get_table_stats. */
const TOP_VALUES_LIMIT = 10;

/** sId scheme for connections opened by the MCP server itself. */
const mcpSessionId = (savedConnectionId: number) => `mcp:${savedConnectionId}`;

/** Hard cap on rows returned to an MCP client, regardless of requested limit. */
const MAX_ROWS = 1000;
const DEFAULT_ROWS = 100;

export interface ToolDeps {
  /** Fallback access level for connections that have no explicit `mcpAccess`. */
  defaultAccess: McpAccess;
  /** When true, register the create_connection tool. */
  allowCreateConnections: boolean;
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

/**
 * Identifier-quoting / value-escaping functions for a Beekeeper connectionType,
 * resolved from the matching SQL dialect. Falls back to the generic helpers when
 * the connectionType has no dialect (e.g. NoSQL stores).
 */
function quotingForConnectionType(connectionType?: string): {
  wrapIdentifier: (s: string) => string;
  escapeString: (s: string, quote?: boolean) => string;
} {
  const dialect = connectionType ? dialectFor(connectionType) : null;
  const data = dialect ? getDialectData(dialect) : null;
  return {
    wrapIdentifier: data?.wrapIdentifier ?? defaultWrapIdentifier,
    escapeString: data?.escapeString ?? defaultEscapeString,
  };
}

/** Access level for a connection: explicit override, else the server default. */
function accessFor(sId: string, defaultAccess: McpAccess): McpAccess {
  return state(sId)?.mcpAccess ?? defaultAccess;
}

/** Resolve a connection by sId, throwing if it isn't exposed/connected. */
/**
 * Best-effort per-table estimated row counts for `list_tables`. Uses the
 * database's planner statistics (cheap, no count(*)). Postgres-family only for
 * now (pg_class.reltuples); other dialects return an empty map so the caller
 * reports `estimatedRows: null`. Any failure (permissions, odd dialect) is
 * swallowed and degrades to no estimates.
 *
 * TODO: add MySQL (information_schema.tables.table_rows) and SQLite
 * (sqlite_stat1) estimators when those backends need the explorer counts.
 *
 * Returns a Map keyed by `"<schema>.<table>"`.
 */
async function estimateRowCounts(
  sId: string,
  connectionType: string | undefined,
  tables: { schema: string | null | undefined; name: string }[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!tables.length) return out;
  const isPg =
    connectionType === "postgresql" ||
    connectionType === "redshift" ||
    connectionType === "cockroachdb";
  if (!isPg) return out;
  try {
    // reltuples is the planner's estimate; GREATEST(.,0) guards the -1 ("never
    // analyzed") sentinel. Join to pg_namespace for the schema qualifier.
    const sql =
      "SELECT n.nspname AS schema, c.relname AS name, " +
      "GREATEST(c.reltuples, 0)::bigint AS estimate " +
      "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE c.relkind IN ('r','p','m')";
    const results = await ConnHandlers["conn/executeQuery"]({
      queryText: sql,
      options: {},
      sId,
    });
    const rows = (results?.[0]?.rows ?? []) as Record<string, unknown>[];
    const wanted = new Set(tables.map((t) => `${t.schema ?? ""}.${t.name}`));
    for (const r of rows) {
      const schema = r.schema == null ? "" : String(r.schema);
      const name = String(r.name);
      const key = `${schema}.${name}`;
      // Match either schema-qualified or (when the listing omits schema) bare name.
      if (!wanted.has(key) && !wanted.has(`.${name}`)) continue;
      const n = Number(r.estimate);
      if (Number.isFinite(n)) {
        out.set(key, n);
        out.set(`.${name}`, n);
      }
    }
  } catch (e) {
    log.debug("estimateRowCounts failed; reporting null estimates", e);
  }
  return out;
}

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

/** Database types accepted by create_connection. */
const CONNECTION_TYPES = [
  "postgresql", "mysql", "mariadb", "tidb", "sqlite", "sqlserver", "oracle",
  "cockroachdb", "redshift", "bigquery", "cassandra", "clickhouse", "duckdb",
  "libsql", "mongodb", "firebird", "redis", "sqlanywhere",
] as const;

/**
 * Create + persist a new saved connection (gated behind mcp.allowCreateConnections).
 * Accepts either a connection url or explicit fields. New connections default to
 * 'read' AI access; the caller may opt up to 'write'.
 */
function createConnectionTool(defaultAccess: McpAccess): McpTool {
  return {
    name: "create_connection",
    description:
      "Create and save a new database connection in Beekeeper Studio, then return its " +
      "savedConnectionId (open it afterwards with the `connect` tool). Provide either a " +
      "connection `url` (e.g. postgres://user:pass@host:5432/db) or explicit fields. Optionally " +
      "tunnel over SSH (sshHost + sshMode 'agent'/'keyfile'/'userpass'). New connections default " +
      "to 'read' AI access; pass mcpAccess='write' to allow writes over MCP.",
    inputSchema: {
      name: z.string().optional().describe("Display name (defaults to host/database)"),
      url: z.string().optional().describe("Full connection string; alternative to the explicit fields"),
      connectionType: z
        .enum(CONNECTION_TYPES as unknown as [string, ...string[]])
        .optional()
        .describe("Database type, e.g. postgresql, mysql, sqlite, sqlserver, oracle"),
      host: z.string().optional(),
      port: z.number().int().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      defaultDatabase: z
        .string()
        .optional()
        .describe("Default database/schema, or the file path for sqlite/duckdb"),
      mcpAccess: z
        .enum(["read", "write"])
        .optional()
        .describe("AI access level for this connection (default 'read')"),
      // SSH tunnel (optional). Providing sshHost enables the tunnel.
      sshEnabled: z.boolean().optional().describe("Tunnel the connection over SSH"),
      sshHost: z.string().optional().describe("SSH host (enables the tunnel if set)"),
      sshPort: z.number().int().optional().describe("SSH port (default 22)"),
      sshUsername: z.string().optional().describe("SSH username"),
      sshMode: z
        .enum(["agent", "keyfile", "userpass"])
        .optional()
        .describe("SSH auth mode (default 'agent' — uses the running ssh-agent)"),
      sshKeyfile: z.string().optional().describe("Path to the private key (sshMode='keyfile')"),
      sshKeyfilePassword: z.string().optional().describe("Passphrase for the private key"),
      sshPassword: z.string().optional().describe("SSH password (sshMode='userpass')"),
    },
    async handler(args) {
      const conn = new SavedConnection();
      if (args.url) {
        if (!conn.parse(String(args.url))) {
          return fail("Unable to parse connection url.");
        }
      } else if (args.connectionType) {
        conn.connectionType = String(args.connectionType) as SavedConnection["connectionType"];
        if (args.host != null) conn.host = String(args.host);
        if (args.port != null) conn.port = Number(args.port);
        if (args.username != null) conn.username = String(args.username);
        if (args.password != null) conn.password = String(args.password);
        if (args.defaultDatabase != null) conn.defaultDatabase = String(args.defaultDatabase);
      } else {
        return fail("Provide either `url` or `connectionType` (plus host/credentials).");
      }

      // SSH tunnel: enabled explicitly, or implicitly when an sshHost is given.
      const sshOn = (args.sshEnabled as boolean | undefined) ?? args.sshHost != null;
      if (sshOn) {
        conn.sshEnabled = true;
        if (args.sshHost != null) conn.sshHost = String(args.sshHost);
        if (args.sshPort != null) conn.sshPort = Number(args.sshPort);
        if (args.sshUsername != null) conn.sshUsername = String(args.sshUsername);
        // The sshMode setter clears mode-specific fields, so set it FIRST.
        conn.sshMode = ((args.sshMode as SavedConnection["sshMode"]) ?? "agent");
        if (conn.sshMode === "keyfile") {
          if (args.sshKeyfile != null) conn.sshKeyfile = String(args.sshKeyfile);
          if (args.sshKeyfilePassword != null) conn.sshKeyfilePassword = String(args.sshKeyfilePassword);
        } else if (conn.sshMode === "userpass") {
          if (args.sshPassword != null) conn.sshPassword = String(args.sshPassword);
        }
      }

      conn.name =
        (args.name != null ? String(args.name) : "") ||
        conn.name ||
        [conn.host, conn.defaultDatabase].filter(Boolean).join("/") ||
        `${conn.connectionType} connection`;
      conn.mcpAccess = (args.mcpAccess as McpAccess) ?? "read";

      try {
        await conn.save();
      } catch (err) {
        log.error("create_connection failed to save", err);
        return fail(`Failed to save connection: ${(err as Error)?.message ?? err}`);
      }

      return ok({
        savedConnectionId: conn.id,
        name: conn.name,
        connectionType: conn.connectionType,
        host: conn.host ?? null,
        port: conn.port ?? null,
        database: conn.defaultDatabase ?? null,
        mcpAccess: normalizeMcpAccess(conn.mcpAccess, defaultAccess),
        ssh: conn.sshEnabled
          ? { host: conn.sshHost, port: conn.sshPort, username: conn.sshUsername, mode: conn.sshMode }
          : null,
        hint: "Open it with the connect tool using this savedConnectionId.",
      });
    },
  };
}

export function createTools(deps: ToolDeps): McpTool[] {
  const { defaultAccess } = deps;

  return [
    ...(deps.allowCreateConnections ? [createConnectionTool(defaultAccess)] : []),
    {
      name: "list_saved_connections",
      description:
        "List database connections saved in Beekeeper Studio that can be opened with the `connect` " +
        "tool. These are not necessarily open yet — use `connect` to open one, then `list_connections` " +
        "to see what is live.",
      inputSchema: {},
      async handler() {
        const saved = await SavedConnection.find({ order: { name: "ASC" } });
        return ok(
          saved
            // Hidden connections (mcpAccess "none") are never exposed over MCP.
            .filter((c) => normalizeMcpAccess(c.mcpAccess, defaultAccess) !== "none")
            .map((c) => ({
              savedConnectionId: c.id,
              name: c.name,
              connectionType: c.connectionType,
              host: c.host ?? null,
              port: c.port ?? null,
              database: c.defaultDatabase ?? null,
              mcpAccess: normalizeMcpAccess(c.mcpAccess, defaultAccess),
              open: !!state(mcpSessionId(c.id))?.connection,
            }))
        );
      },
    },

    {
      name: "connect",
      description:
        "Open a saved database connection by its savedConnectionId (from list_saved_connections). " +
        "By default the connection opens at its saved AI-access level. The saved level is a ceiling: " +
        "you may pass access='read' to further restrict a write-enabled connection to read-only for this " +
        "session, but you cannot widen beyond the saved level (requesting 'write' on a read connection is " +
        "refused). Read connections are also opened in the driver's read-only mode (enforced below the SQL " +
        "guard). Connections whose AI access is Hidden cannot be opened. Returns the connectionId to pass " +
        "to the other tools. Idempotent; calling again with a different access reopens the connection.",
      inputSchema: {
        savedConnectionId: z
          .number()
          .int()
          .describe("Saved connection id from list_saved_connections"),
        access: z
          .enum(["read", "write"])
          .optional()
          .describe("Access level for this connection (defaults to the connection's saved AI access)"),
      },
      async handler(args) {
        const savedId = Number(args.savedConnectionId);
        const sId = mcpSessionId(savedId);

        const config = await SavedConnection.findOneBy({ id: savedId });
        if (!config) {
          return fail(`No saved connection with id ${savedId}`);
        }

        // Default to the connection's saved AI-access level (a ceiling): an
        // explicit arg may only narrow it. Hidden connections are never openable.
        const saved = normalizeMcpAccess(config.mcpAccess, defaultAccess);
        const resolved = resolveConnectAccess(saved, args.access as McpAccess | undefined);
        if (resolved.refused) {
          return fail(`Cannot open connection ${savedId} over MCP: ${resolved.reason}.`);
        }
        const access = resolved.access;

        const existing = state(sId);
        if (existing?.connection) {
          // Same access → reuse. Different access → reopen (driver read-only
          // mode is fixed at connect time, so we can't just flip the flag).
          if (existing.mcpAccess === access) {
            return ok({ connectionId: sId, alreadyOpen: true, mcpAccess: access });
          }
          await ConnHandlers["conn/disconnect"]({ sId });
          await ConnHandlers["conn/clearConnection"]({ sId });
        }

        // Defense in depth: read connections also run in the driver's read-only
        // mode, which rejects mutating queries below our SQL guard. Reflect the
        // resolved access on the config so conn/create records it on the state.
        config.readOnlyMode = access === "read";
        config.mcpAccess = access;

        if (!state(sId)) newState(sId);
        state(sId).mcpAccess = access;
        try {
          await ConnHandlers["conn/create"]({
            config,
            osUser: os.userInfo().username,
            sId,
          });
        } catch (err) {
          // Roll back the half-initialised state so a retry starts clean.
          state(sId).connection = null;
          throw err;
        }
        return ok({
          connectionId: sId,
          name: config.name,
          connectionType: config.connectionType,
          database: state(sId).database ?? config.defaultDatabase ?? null,
          mcpAccess: access,
        });
      },
    },

    {
      name: "disconnect",
      description: "Close a connection that was opened with the `connect` tool.",
      inputSchema: {
        connectionId: z.string().describe("Connection id returned by connect"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        const s = state(sId);
        if (!s?.connection) {
          return ok({ connectionId: sId, alreadyClosed: true });
        }
        await ConnHandlers["conn/disconnect"]({ sId });
        await ConnHandlers["conn/clearConnection"]({ sId });
        return ok({ connectionId: sId, closed: true });
      },
    },

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
        const { s } = requireExposed(sId, defaultAccess);
        const filter = args.schema ? { schema: String(args.schema) } : undefined;
        const [tables, views] = await Promise.all([
          ConnHandlers["conn/listTables"]({ filter, sId }),
          ConnHandlers["conn/listViews"]({ filter, sId }),
        ]);
        // Best-effort per-table estimated row counts (cheap — from the planner
        // statistics, never count(*)). Currently Postgres-family only via
        // pg_class.reltuples; other dialects report null. Failures degrade to
        // null so the listing never breaks.
        const estimates = await estimateRowCounts(
          sId,
          s.usedConfig?.connectionType,
          tables.map((t) => ({ schema: t.schema, name: t.name }))
        );
        const estimateOf = (schema: string | null | undefined, name: string): number | null =>
          estimates.get(`${schema ?? ""}.${name}`) ?? null;
        return ok({
          tables: tables.map((t) => ({
            name: t.name,
            schema: t.schema,
            entityType: "table",
            estimatedRows: estimateOf(t.schema, t.name),
          })),
          views: views.map((v) => ({
            name: v.name,
            schema: v.schema,
            entityType: "view",
            estimatedRows: null,
          })),
        });
      },
    },

    {
      name: "describe_table",
      description:
        "Describe a table: columns (name, type, nullable, default), primary key, indexes, outgoing " +
        "foreign keys (this table -> parents), and incoming foreign keys (child tables -> this table). " +
        "Use incomingForeignKeys with get_relation_counts to drill into related child rows.",
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
        const [columns, primaryKeys, indexes, outgoingKeys, incomingKeys] = await Promise.all([
          ConnHandlers["conn/listTableColumns"]({ table, schema, sId }),
          ConnHandlers["conn/getPrimaryKeys"]({ table, schema, sId }),
          ConnHandlers["conn/listTableIndexes"]({ table, schema, sId }),
          ConnHandlers["conn/getTableKeys"]({ table, schema, sId }),
          ConnHandlers["conn/getIncomingKeys"]({ table, schema, sId }),
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
          foreignKeys: outgoingKeys.map((k) => ({
            column: k.fromColumn,
            referencesTable: k.toTable,
            referencesColumn: k.toColumn,
            referencesSchema: k.toSchema,
          })),
          incomingForeignKeys: incomingKeys.map((k) => ({
            fromSchema: k.fromSchema,
            fromTable: k.fromTable,
            fromColumn: k.fromColumn,
            toColumn: k.toColumn,
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
      name: "get_relation_counts",
      description:
        "Count related child rows for a single parent row. Given a parent table and the primary " +
        "key of one row (rowKey, as { columnName: value }), this looks up every incoming foreign " +
        "key (child tables referencing this table) and returns, for each, the number of child rows " +
        "whose FK column equals the matching rowKey value. Read-only; works on read connections. " +
        `Caps at ${MAX_RELATIONS} relations per call. Use describe_table.incomingForeignKeys first ` +
        "to see which relations exist.",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        table: z.string().describe("Parent table name"),
        schema: z.string().optional().describe("Schema the parent table belongs to"),
        rowKey: z
          .record(z.string(), z.unknown())
          .describe(
            "Primary key of one parent row as { columnName: value }. The value is matched against " +
              "each child FK column referencing that parent column."
          ),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        // Read-only by construction (SELECT count(*)); requireExposed already rejects
        // "none" access, so this works on both read and write connections.
        const { s } = requireExposed(sId, defaultAccess);
        const table = String(args.table);
        const schema = args.schema ? String(args.schema) : undefined;
        const rowKey = (args.rowKey ?? {}) as Record<string, unknown>;
        if (!_.isPlainObject(args.rowKey) || Object.keys(rowKey).length === 0) {
          return fail("rowKey must be a non-empty object of { columnName: value }");
        }

        const { wrapIdentifier, escapeString } = quotingForConnectionType(
          s.usedConfig?.connectionType
        );

        const allIncoming = await ConnHandlers["conn/getIncomingKeys"]({ table, schema, sId });
        // Only single-column FKs can be matched against a scalar rowKey value.
        const incoming = allIncoming.filter((k) => !k.isComposite);
        const skippedComposite = allIncoming.length - incoming.length;
        if (skippedComposite > 0) {
          log.info(
            `get_relation_counts: skipped ${skippedComposite} composite incoming key(s) for ${schema ?? ""}.${table}`
          );
        }

        let relations = incoming;
        let truncated = false;
        if (relations.length > MAX_RELATIONS) {
          truncated = true;
          log.warn(
            `get_relation_counts: ${relations.length} relations for ${schema ?? ""}.${table}, capping at ${MAX_RELATIONS}`
          );
          relations = relations.slice(0, MAX_RELATIONS);
        }

        const asScalar = (v: string | string[]): string | undefined =>
          Array.isArray(v) ? v[0] : v;

        const counts = await Promise.all(
          relations.map(async (k) => {
            const fromColumn = asScalar(k.fromColumn);
            const toColumn = asScalar(k.toColumn);
            const base = {
              fromSchema: k.fromSchema ?? null,
              fromTable: k.fromTable,
              fromColumn,
              toColumn,
            };
            if (!fromColumn || !toColumn) {
              return { ...base, count: null, error: "Unresolved key column" };
            }
            const keyValue = rowKey[toColumn];
            if (keyValue === undefined) {
              return {
                ...base,
                count: null,
                error: `rowKey is missing referenced column "${toColumn}"`,
              };
            }

            // Safely build SELECT count(*): identifiers are dialect-quoted and the
            // single scalar value is escaped as a quoted string literal (NULL handled
            // explicitly). This is a read-only count, run through executeQuery.
            const qualifiedTable = k.fromSchema
              ? `${wrapIdentifier(k.fromSchema)}.${wrapIdentifier(k.fromTable)}`
              : wrapIdentifier(k.fromTable);
            const col = wrapIdentifier(fromColumn);
            const predicate =
              keyValue === null
                ? `${col} IS NULL`
                : `${col} = ${escapeString(String(keyValue), true)}`;
            const sql = `SELECT count(*) AS cnt FROM ${qualifiedTable} WHERE ${predicate}`;

            try {
              const results = await ConnHandlers["conn/executeQuery"]({
                queryText: sql,
                options: {},
                sId,
              });
              const firstRow = (results?.[0]?.rows ?? [])[0] as
                | Record<string, unknown>
                | unknown[]
                | undefined;
              let raw: unknown;
              if (Array.isArray(firstRow)) {
                raw = firstRow[0];
              } else if (firstRow && typeof firstRow === "object") {
                raw = (firstRow as Record<string, unknown>).cnt ?? Object.values(firstRow)[0];
              }
              const count = raw === undefined || raw === null ? null : Number(raw);
              return { ...base, count: Number.isNaN(count as number) ? null : count };
            } catch (err) {
              log.warn(
                `get_relation_counts: count failed for ${k.fromTable}.${fromColumn}: ${(err as Error).message}`
              );
              return { ...base, count: null, error: (err as Error).message };
            }
          })
        );

        return ok({
          table,
          schema: schema ?? null,
          truncated,
          relations: counts,
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

    {
      name: "get_table_stats",
      description:
        "Per-column value statistics for a table, used to infer semantic types (email/url/color/ip/" +
        "phone, etc.) and to drive cell formatting. For each column it returns the top ~10 most common " +
        `values with their counts, plus the fraction of NULLs. Read-only; caps at ${MAX_STATS_COLUMNS} ` +
        "columns per call. Cheap by construction (one grouped query per column, each LIMIT 10).",
      inputSchema: {
        connectionId: z.string().describe("Connection id from list_connections"),
        table: z.string().describe("Table name"),
        schema: z.string().optional().describe("Schema the table belongs to"),
      },
      async handler(args) {
        const sId = String(args.connectionId);
        // Read-only by construction (SELECT ... GROUP BY); requireExposed rejects "none".
        const { s } = requireExposed(sId, defaultAccess);
        const table = String(args.table);
        const schema = args.schema ? String(args.schema) : undefined;

        const { wrapIdentifier } = quotingForConnectionType(s.usedConfig?.connectionType);

        const allColumns = await ConnHandlers["conn/listTableColumns"]({ table, schema, sId });
        let columns = allColumns;
        let truncated = false;
        if (columns.length > MAX_STATS_COLUMNS) {
          truncated = true;
          log.warn(
            `get_table_stats: ${columns.length} columns for ${schema ?? ""}.${table}, capping at ${MAX_STATS_COLUMNS}`
          );
          columns = columns.slice(0, MAX_STATS_COLUMNS);
        }

        const qualifiedTable = schema
          ? `${wrapIdentifier(schema)}.${wrapIdentifier(table)}`
          : wrapIdentifier(table);

        const stats = await Promise.all(
          columns.map(async (c) => {
            const col = wrapIdentifier(c.columnName);
            // Top values: one grouped query per column, ORDER BY count DESC LIMIT 10.
            // NULLs are excluded from top_values; the null fraction is computed separately.
            const topSql =
              `SELECT ${col} AS value, count(*) AS cnt FROM ${qualifiedTable} ` +
              `WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY cnt DESC LIMIT ${TOP_VALUES_LIMIT}`;
            const nullSql =
              `SELECT count(*) AS total, count(${col}) AS non_null FROM ${qualifiedTable}`;

            const scalar = (
              firstRow: Record<string, unknown> | unknown[] | undefined,
              key: string,
              index: number
            ): unknown => {
              if (Array.isArray(firstRow)) return firstRow[index];
              if (firstRow && typeof firstRow === "object") {
                const obj = firstRow as Record<string, unknown>;
                return obj[key] ?? Object.values(obj)[index];
              }
              return undefined;
            };

            try {
              const [topRes, nullRes] = await Promise.all([
                ConnHandlers["conn/executeQuery"]({ queryText: topSql, options: {}, sId }),
                ConnHandlers["conn/executeQuery"]({ queryText: nullSql, options: {}, sId }),
              ]);

              const topRows = (topRes?.[0]?.rows ?? []) as (
                | Record<string, unknown>
                | unknown[]
              )[];
              const topValues = topRows.map((r) => {
                const value = scalar(r, "value", 0);
                const rawCount = scalar(r, "cnt", 1);
                const count = Number(rawCount);
                return {
                  value: value === undefined ? null : (value as unknown),
                  count: Number.isNaN(count) ? 0 : count,
                };
              });

              const nullRow = (nullRes?.[0]?.rows ?? [])[0] as
                | Record<string, unknown>
                | unknown[]
                | undefined;
              const total = Number(scalar(nullRow, "total", 0));
              const nonNull = Number(scalar(nullRow, "non_null", 1));
              const nullFraction =
                Number.isFinite(total) && total > 0 && Number.isFinite(nonNull)
                  ? (total - nonNull) / total
                  : undefined;

              return {
                name: c.columnName,
                top_values: topValues,
                ...(nullFraction === undefined ? {} : { nullFraction }),
              };
            } catch (err) {
              log.warn(
                `get_table_stats: stats failed for ${table}.${c.columnName}: ${(err as Error).message}`
              );
              return { name: c.columnName, top_values: [], error: (err as Error).message };
            }
          })
        );

        return ok({ table, schema: schema ?? null, truncated, columns: stats });
      },
    },
  ];
}
