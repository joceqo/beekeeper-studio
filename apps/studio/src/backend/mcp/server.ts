import http from "http";
import { randomUUID } from "crypto";
import { AddressInfo } from "net";
import rawLog from "@bksLogger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTools, McpTool, ToolDeps } from "./tools";
import { McpAccess } from "./sqlGuard";

const log = rawLog.scope("McpServer");

export interface McpServerOptions {
  /** Port to bind. 0 = ephemeral. SlashTable uses a fixed loopback port. */
  port?: number;
  /** Host to bind. Loopback only by default — never expose DB access on the network. */
  host?: string;
  /** Fallback access level for connections without an explicit one. */
  defaultAccess?: McpAccess;
  /** Server identity reported to MCP clients. */
  name?: string;
  version?: string;
}

/** Build a fresh McpServer with every tool registered. One per client session. */
function buildServer(tools: McpTool[], name: string, version: string): McpServer {
  const server = new McpServer({ name, version });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (async (args: Record<string, unknown>) => {
        log.info(`tool call: ${tool.name}`, args);
        try {
          const result = await tool.handler(args);
          log.info(`tool ok: ${tool.name}${result.isError ? " (isError)" : ""}`);
          return result;
        } catch (err) {
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

  constructor(opts: McpServerOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 0;
    this.name = opts.name ?? "beekeeper-studio";
    this.version = opts.version ?? "0.0.0";
    const deps: ToolDeps = { defaultAccess: opts.defaultAccess ?? "read" };
    this.tools = createTools(deps);
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

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
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
        const server = buildServer(this.tools, this.name, this.version);
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
