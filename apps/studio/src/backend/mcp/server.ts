import http from "http";
import { randomUUID } from "crypto";
import { AddressInfo } from "net";
import rawLog from "@bksLogger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTools, McpTool, ToolDeps } from "./tools";
import { McpAccess } from "./sqlGuard";
import { SavedConnection } from "@/common/appdb/models/saved_connection";
import { normalizeMcpAccess } from "./access";

const log = rawLog.scope("McpServer");

/** Live MCP server status, surfaced to the renderer's status-bar popover. */
export interface McpStatus {
  running: boolean;
  url: string | null;
  port: number | null;
  requests: number;
  errors: number;
  lastCall: { name: string; durationMs: number } | null;
  /** Names of saved connections whose AI access is 'write'. */
  writeConnections: string[];
}

/** Records one tool invocation's outcome into the server's running stats. */
type ToolCallRecorder = (name: string, durationMs: number, isError: boolean) => void;

export interface McpServerOptions {
  /** Port to bind. 0 = ephemeral. SlashTable uses a fixed loopback port. */
  port?: number;
  /** Host to bind. Loopback only by default — never expose DB access on the network. */
  host?: string;
  /** Fallback access level for connections without an explicit one. */
  defaultAccess?: McpAccess;
  /** Allow the create_connection tool (off -> the tool is not registered). */
  allowCreateConnections?: boolean;
  /** Server identity reported to MCP clients. */
  name?: string;
  version?: string;
}

/** Build a fresh McpServer with every tool registered. One per client session. */
function buildServer(
  tools: McpTool[],
  name: string,
  version: string,
  record: ToolCallRecorder
): McpServer {
  const server = new McpServer({ name, version });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (async (args: Record<string, unknown>) => {
        const start = Date.now();
        log.info(`tool call: ${tool.name}`, args);
        try {
          const result = await tool.handler(args);
          record(tool.name, Date.now() - start, !!result.isError);
          log.info(`tool ok: ${tool.name}${result.isError ? " (isError)" : ""}`);
          return result;
        } catch (err) {
          record(tool.name, Date.now() - start, true);
          log.warn(`tool ${tool.name} failed`, err);
          return {
            content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      }) as unknown as Parameters<typeof server.registerTool>[2]
    );
  }
  log.info(`registered ${tools.length} MCP tools: ${tools.map((t) => t.name).join(", ")}`);
  return server;
}

/**
 * In-process MCP server exposing the app's live database connections over a
 * loopback Streamable HTTP endpoint — the same model as SlashTable
 * (http://127.0.0.1:PORT/mcp). Connections run in this (utility) process, so
 * tools reuse the existing connection handlers directly.
 */
export class BeekeeperMcpServer {
  private httpServer: http.Server | null = null;
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();
  private readonly tools: McpTool[];
  private readonly host: string;
  private readonly port: number;
  private readonly name: string;
  private readonly version: string;
  private readonly defaultAccess: McpAccess;
  /** Running request stats, surfaced via getStatus(). */
  private requests = 0;
  private errors = 0;
  private lastCall: { name: string; durationMs: number } | null = null;

  constructor(opts: McpServerOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 0;
    this.name = opts.name ?? "beekeeper-studio";
    this.version = opts.version ?? "0.0.0";
    this.defaultAccess = opts.defaultAccess ?? "read";
    const deps: ToolDeps = {
      defaultAccess: this.defaultAccess,
      allowCreateConnections: opts.allowCreateConnections ?? false,
    };
    this.tools = createTools(deps);
  }

  /** Tally one tool invocation (called from the per-session server wrapper). */
  private recordToolCall: ToolCallRecorder = (name, durationMs, isError) => {
    this.requests += 1;
    if (isError) this.errors += 1;
    this.lastCall = { name, durationMs };
  };

  /** Resolved bound port once started, else null. */
  get boundPort(): number | null {
    if (!this.httpServer) return null;
    const addr = this.httpServer.address() as AddressInfo | null;
    return addr?.port ?? null;
  }

  /** Live status for the renderer's MCP popover. */
  async getStatus(): Promise<McpStatus> {
    let writeConnections: string[] = [];
    try {
      const saved = await SavedConnection.find();
      writeConnections = saved
        .filter((c) => normalizeMcpAccess(c.mcpAccess, this.defaultAccess) === "write")
        .map((c) => c.name);
    } catch (err) {
      log.warn("getStatus: failed to read saved connections", err);
    }
    return {
      running: !!this.httpServer,
      url: this.url,
      port: this.boundPort,
      requests: this.requests,
      errors: this.errors,
      lastCall: this.lastCall,
      writeConnections,
    };
  }

  /** Resolved URL once started, e.g. http://127.0.0.1:27420/mcp */
  get url(): string | null {
    if (!this.httpServer) return null;
    const addr = this.httpServer.address() as AddressInfo | null;
    if (!addr) return null;
    return `http://${this.host}:${addr.port}/mcp`;
  }

  async start(): Promise<string> {
    if (this.httpServer) return this.url!;

    this.httpServer = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        log.error("request handling failed", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(this.port, this.host, () => {
        this.httpServer!.removeListener("error", reject);
        resolve();
      });
    });

    log.info(`MCP server listening on ${this.url}`);
    return this.url!;
  }

  async stop(): Promise<void> {
    for (const transport of this.transports.values()) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
    this.transports.clear();
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }
    log.info("MCP server stopped");
  }

  /**
   * Reflect loopback origins so a local browser app (e.g. the standalone
   * studio-react dev server on http://localhost:5273) can call this endpoint.
   * Kept loopback-only — non-localhost origins get no CORS headers and the
   * browser blocks them. The endpoint itself is still bound to 127.0.0.1.
   */
  private applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    if (!origin) return;
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      return;
    }
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    if (!isLoopback) return;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, mcp-session-id, accept, mcp-protocol-version"
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    this.applyCors(req, res);

    // Preflight: answer here so the actual MCP request can carry custom headers.
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      const body = await readJson(req);
      let transport = sessionId ? this.transports.get(sessionId) : undefined;

      if (!transport && isInitializeRequest(body)) {
        // New session: create a transport + a fresh server bound to it.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            this.transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) {
            this.transports.delete(transport!.sessionId);
            log.info(`MCP session closed: ${transport!.sessionId}`);
          }
        };
        const server = buildServer(this.tools, this.name, this.version, this.recordToolCall);
        await server.connect(transport);
        log.info("new MCP session initializing");
      }

      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "No valid session. Send an initialize request first." },
            id: null,
          })
        );
        return;
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    // GET (SSE stream) and DELETE (session teardown) require an existing session.
    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sessionId ? this.transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400).end("Unknown session");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end();
  }
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
