import type { BackendClient } from "./types";
import { MockBackendClient } from "./mockClient";
import { McpBackendClient } from "./mcpClient";

export * from "./types";

/**
 * Pick the backend from build-time env flags:
 *   VITE_BACKEND=mcp   -> McpBackendClient (talks to the app's MCP HTTP server)
 *   VITE_MCP_URL=...   -> override the MCP endpoint (default 127.0.0.1:27500/mcp)
 * Anything else falls back to the in-memory MockBackendClient (the default).
 */
function makeBackend(): BackendClient {
  if (import.meta.env.VITE_BACKEND === "mcp") {
    const url = import.meta.env.VITE_MCP_URL || "http://127.0.0.1:27500/mcp";
    return new McpBackendClient(url);
  }
  return new MockBackendClient();
}

export const backend: BackendClient = makeBackend();
