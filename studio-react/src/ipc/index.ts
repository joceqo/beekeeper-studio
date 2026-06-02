import type { BackendClient } from "./types";
import { MockBackendClient } from "./mockClient";
import { McpBackendClient } from "./mcpClient";
import { ElectronBackendClient } from "./electronClient";
import { transport } from "./transport";

export * from "./types";
export { transport } from "./transport";

/**
 * Pick the backend from build-time env flags + runtime environment:
 *
 *   VITE_BACKEND=electron -> ElectronBackendClient (real backend over the
 *                            renderer MessagePort; the desktop C0 path)
 *   VITE_BACKEND=mcp       -> McpBackendClient (the app's MCP HTTP server)
 *   VITE_MCP_URL=...        -> override the MCP endpoint (default 127.0.0.1:27500/mcp)
 *
 * Auto-detect: when no explicit flag selects MCP/mock and the Electron preload
 * bridge (`window.main`) is present, the Electron client is used — so launching
 * studio-react inside Beekeeper's renderer "just works" without a build flag.
 * Anything else falls back to the in-memory MockBackendClient (the default for
 * `yarn dev` in a plain browser).
 */
function hasElectronBridge(): boolean {
  return typeof window !== "undefined" && typeof window.main !== "undefined";
}

function makeBackend(): BackendClient {
  const flag = import.meta.env.VITE_BACKEND;
  if (flag === "mcp") {
    const url = import.meta.env.VITE_MCP_URL || "http://127.0.0.1:27500/mcp";
    return new McpBackendClient(url);
  }
  if (flag === "electron" || (flag !== "mock" && hasElectronBridge())) {
    return new ElectronBackendClient(transport);
  }
  return new MockBackendClient();
}

export const backend: BackendClient = makeBackend();
