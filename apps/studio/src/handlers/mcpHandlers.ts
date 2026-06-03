import type { BeekeeperMcpServer, McpStatus } from "@/backend/mcp/server";

export interface IMcpHandlers {
  "mcp/status": (args?: { sId?: string }) => Promise<McpStatus>;
}

const OFFLINE: McpStatus = {
  running: false,
  url: null,
  port: null,
  requests: 0,
  errors: 0,
  lastCall: null,
  writeConnections: [],
};

/**
 * Exposes the in-app MCP server's live status to the renderer (status-bar
 * popover). Built as a factory over a getter so it reads whatever server
 * instance the utility process currently holds (or null when MCP is disabled),
 * mirroring the PluginHandlers(pluginManager) pattern.
 */
export const McpHandlers = (getServer: () => BeekeeperMcpServer | null): IMcpHandlers => ({
  "mcp/status": async () => {
    const server = getServer();
    return server ? server.getStatus() : OFFLINE;
  },
});
