import { identify } from "sql-query-identifier";
import type { IdentifyResult } from "sql-query-identifier/lib/defines";

/**
 * Access level granted to an MCP client for a given connection.
 * Mirrors SlashTable's `mcpAccess` field:
 *   - "read"  → only read-only statements (SELECT/WITH/EXPLAIN/SHOW/…)
 *   - "write" → any statement, including INSERT/UPDATE/DELETE and DDL
 *   - "none"  → connection is not exposed over MCP at all
 */
export type McpAccess = "none" | "read" | "write";

/** Dialects understood by sql-query-identifier. */
export type GuardDialect =
  | "generic"
  | "mssql"
  | "sqlite"
  | "mysql"
  | "psql"
  | "oracle"
  | "bigquery";

/**
 * Statement types from sql-query-identifier that are read-only.
 * `executionType === "LISTING"` covers SELECT; the rest are explicit
 * read keywords that the parser tags individually.
 */
const READ_ONLY_TYPES = new Set<string>([
  "SELECT",
  "SHOW",
  "DESCRIBE",
  "EXPLAIN",
  "PRAGMA",
  "USE",
]);

/**
 * Leading keywords we still treat as read-only when the parser returns
 * UNKNOWN (it does not tag EXPLAIN/WITH/PRAGMA on every dialect).
 */
const READ_ONLY_LEADING = /^\s*(?:\(?\s*)?(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC|PRAGMA)\b/i;

export interface GuardResult {
  allowed: boolean;
  /** Per-statement classification, useful for logging/telemetry. */
  statements: { text: string; type: string; executionType: string }[];
  /** Human-readable reason when `allowed` is false. */
  reason?: string;
}

function isReadOnlyStatement(stmt: IdentifyResult): boolean {
  if (stmt.executionType === "LISTING") return true;
  if (READ_ONLY_TYPES.has(stmt.type)) return true;
  // Parser couldn't classify it — fall back to the leading keyword. Anything
  // that isn't an obvious read stays rejected (fail closed).
  if (stmt.type === "UNKNOWN") return READ_ONLY_LEADING.test(stmt.text ?? "");
  return false;
}

/**
 * Decide whether `sql` may run under the given access level.
 *
 * `write` allows everything. `read` allows a query only when *every*
 * statement in it is read-only — a single mutating statement rejects the
 * whole batch (fail closed). `none` always rejects.
 */
export function checkSqlAccess(
  sql: string,
  access: McpAccess,
  dialect: GuardDialect = "generic"
): GuardResult {
  if (access === "none") {
    return { allowed: false, statements: [], reason: "Connection is not exposed over MCP" };
  }

  let parsed: IdentifyResult[];
  try {
    parsed = identify(sql, { strict: false, dialect });
  } catch (err) {
    // If we can't even parse it, only write access may run it.
    if (access === "write") {
      return { allowed: true, statements: [] };
    }
    return {
      allowed: false,
      statements: [],
      reason: `Could not parse SQL to verify it is read-only: ${(err as Error).message}`,
    };
  }

  const statements = parsed.map((s) => ({
    text: s.text,
    type: s.type,
    executionType: s.executionType,
  }));

  if (access === "write") {
    return { allowed: true, statements };
  }

  // read mode
  const offending = parsed.find((s) => !isReadOnlyStatement(s));
  if (offending) {
    return {
      allowed: false,
      statements,
      reason: `Read-only connection: only SELECT/WITH/EXPLAIN/SHOW statements are allowed, got ${offending.type}`,
    };
  }

  return { allowed: true, statements };
}
