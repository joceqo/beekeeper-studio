/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mcp" to use the MCP HTTP backend; anything else uses the mock. */
  readonly VITE_BACKEND?: string;
  /** Override the MCP Streamable-HTTP endpoint URL. */
  readonly VITE_MCP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
