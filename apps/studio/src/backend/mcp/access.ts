import type { McpAccess } from "./sqlGuard";

/** The three AI-access levels a connection can declare, in UI order. */
export const MCP_ACCESS_LEVELS: readonly McpAccess[] = ["none", "read", "write"] as const;

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
 * - A hidden connection (`saved === "none"`) is never openable over MCP: it is
 *   refused regardless of what the client requests.
 * - Otherwise an explicit `requested` level wins; absent that, the connection's
 *   saved level is used as the default.
 */
export function resolveConnectAccess(
  saved: McpAccess,
  requested?: McpAccess
): ConnectAccessResolution {
  if (saved === "none") {
    return { access: "none", refused: true, reason: "AI access is set to Hidden" };
  }
  return { access: requested ?? saved, refused: false };
}
