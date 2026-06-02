import type { McpAccess } from "./sqlGuard";

/** The three AI-access levels a connection can declare, in UI order. */
export const MCP_ACCESS_LEVELS: readonly McpAccess[] = ["none", "read", "write"] as const;

/** Privilege ordering: a request may narrow toward "none" but never widen. */
const ACCESS_RANK: Record<McpAccess, number> = { none: 0, read: 1, write: 2 };

/**
 * Normalize a stored or raw `mcpAccess` value into a valid {@link McpAccess}.
 *
 * Unset, null, or unrecognized values fall back to `fallback` (default "read"),
 * so connections saved before the column existed — or configs that omit the
 * field — open at the safe level.
 */
export function normalizeMcpAccess(value: unknown, fallback: McpAccess = "read"): McpAccess {
  return value === "none" || value === "read" || value === "write" ? value : fallback;
}

export interface ConnectAccessResolution {
  /** The access level to open the connection at. */
  access: McpAccess;
  /** True when the connection must not be opened over MCP at all. */
  refused: boolean;
  /** Human-readable reason, set only when `refused` is true. */
  reason?: string;
}

/**
 * Resolve the access level for an MCP `connect` call.
 *
 * The connection's saved level is a ceiling: a request may only *narrow* it
 * (e.g. open a write connection read-only for a session), never widen it.
 *
 * - A hidden connection (`saved === "none"`) is never openable over MCP.
 * - A request above the saved level (e.g. "write" on a read connection) is
 *   refused rather than silently downgraded.
 * - Otherwise an explicit `requested` level wins; absent that, the saved level
 *   is used as the default.
 */
export function resolveConnectAccess(
  saved: McpAccess,
  requested?: McpAccess
): ConnectAccessResolution {
  if (saved === "none") {
    return { access: "none", refused: true, reason: "AI access is set to Hidden" };
  }
  if (requested && ACCESS_RANK[requested] > ACCESS_RANK[saved]) {
    return {
      access: saved,
      refused: true,
      reason: `AI access is limited to '${saved}'; '${requested}' is not allowed`,
    };
  }
  return { access: requested ?? saved, refused: false };
}
