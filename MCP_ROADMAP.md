# Beekeeper Studio — MCP server (fork roadmap)

Goal: expose Beekeeper's live database connections to AI agents over a local
MCP server, the way [SlashTable](https://slashtable.dev) does — the desktop app
*is* the MCP server, so agents reuse connections and credentials the user
already set up, with a per-connection read/write guard.

This file is the canonical plan. The actual code lives on branch
**`feat/mcp-server`** (not yet merged to `master`).

```bash
git fetch origin
git checkout feat/mcp-server   # all MCP code is here
```

---

## ✅ Done (branch `feat/mcp-server`)

A working MCP server, verified end-to-end against a real Postgres DB.

- **Server** — `apps/studio/src/backend/mcp/server.ts`
  `McpServer` + Streamable HTTP transport, bound to loopback
  (`http://127.0.0.1:27500/mcp`), one session per client. Runs inside the
  **utility process** (where DB connections live), started from
  `apps/studio/src-commercial/entrypoints/utility.ts`.
- **Read/write guard** — `apps/studio/src/backend/mcp/sqlGuard.ts`
  Uses `sql-query-identifier`. `read` allows only SELECT/WITH/EXPLAIN/SHOW;
  one mutating statement rejects the whole batch (fail closed). 18 unit tests
  in `apps/studio/tests/unit/backend/mcp/sqlGuard.spec.ts`.
- **Tools** — `apps/studio/src/backend/mcp/tools.ts`, mapped onto the existing
  `ConnHandlers`:
  - `list_saved_connections` — catalog of openable connections
  - `connect` — opens a saved connection by id; arg `access: read|write`
    (default read). Read connections also open in the driver's `readOnlyMode`
    (double enforcement). Returns a `connectionId` (`mcp:<savedId>`).
  - `disconnect`
  - `list_connections` — live connections + their access level
  - `list_schemas`, `list_tables`, `describe_table`
  - `get_schema_graph` — FK nodes + edges
  - `get_records` (paged selectTop), `execute_query` (guarded)
- **Config** — `[mcp]` section in `apps/studio/default.config.ini`
  (`enabled` off by default, `port = 27420`, `defaultAccess = read`).
  Per-connection access stored on `State.mcpAccess` (in
  `apps/studio/src/handlers/handlerState.ts`).

### Run & test locally

```bash
# enable MCP in dev (local.config.ini is the dev override; 27420 clashes with
# SlashTable if it's running, so use another port)
cat >> apps/studio/local.config.ini <<'INI'
[mcp]
enabled = true
port = 27500
defaultAccess = read
INI

yarn bks:dev   # or: cd apps/studio && yarn electron:serve
# esbuild watch does NOT auto-restart electron — kill & relaunch to load new code
```

The endpoint speaks MCP Streamable HTTP. Smoke test with curl: `initialize`
(grab the `mcp-session-id` response header) → `tools/call` `connect` →
`execute_query`. A `CREATE TABLE` on a read connection is rejected.

---

## ⏳ Next: connection-form "AI access" toggle (UI)

Mirror SlashTable's connection editor: a three-way **AI access** control —
**Hidden / Read / Write** — in Beekeeper's connection form, persisted per
connection, so each saved connection declares how agents may use it.

### Prompt (paste this to an agent on branch `feat/mcp-server`)

> Add a per-connection "AI access" setting to Beekeeper Studio's connection
> form, with values Hidden / Read / Write, persisted on the saved connection
> and honored by the MCP server.
>
> 1. **DB column.** Add `mcpAccess` to the `saved_connection` table via a new
>    migration modeled exactly on
>    `apps/studio/src/migration/ultimate/20221103_add_read_only.js`
>    (`ALTER TABLE saved_connection ADD COLUMN mcpAccess varchar(8) not null
>    default 'read'`; also `used_connection` if it mirrors columns). Register
>    the migration in `apps/studio/src/migration/index.js` (import + add to the
>    `realMigrations` array, next to `readOnlyMode` at line ~39). Add a matching
>    `@Column` to `DbConnectionBase`/`SavedConnection` in
>    `apps/studio/src/common/appdb/models/saved_connection.ts` (template: the
>    `readOnlyMode` column at line ~218/305).
> 2. **UI.** Add the control to the connection form. The advanced toggles live
>    in `apps/studio/src/components/connection/CommonAdvanced.vue` (it already
>    has an `x-switch` for read-only). Add a labeled 3-option control
>    ("AI access": Hidden / Read / Write) bound to `config.mcpAccess`, with the
>    same helper-text style as the rest of the form (neutral statements — see
>    the UI Copy Style section in `CLAUDE.md`). Match the existing SCSS theme.
> 3. **Plumb it through.** `mcpAccess` must reach the utility process: it's part
>    of `IConnection`/the saved config passed to `conn/create`
>    (`apps/studio/src-commercial/backend/handlers/connHandlers.ts`). In
>    `conn/create`, set `state(sId).mcpAccess = config.mcpAccess` so
>    UI-opened connections get the saved level (today only MCP-opened
>    connections set it). The MCP `connect` tool in
>    `apps/studio/src/backend/mcp/tools.ts` should default to the saved
>    connection's `mcpAccess` instead of hardcoding "read".
> 4. **Hidden.** `list_connections` and `list_saved_connections` already filter
>    out `mcpAccess === "none"` — map "Hidden" to `"none"`. Verify a Hidden
>    connection never appears over MCP and `connect` refuses it.
> 5. **Verify.** Typecheck (`npx tsc --noEmit` — touched files must add 0 errors
>    over the ~269 pre-existing baseline), `yarn lint`, and a unit test for the
>    access-resolution logic. Then run the app, set a connection to each level,
>    and confirm via curl that Read rejects writes, Write allows them, Hidden
>    hides the connection.

### Notes / decisions
- Keep `read` the safe default everywhere.
- `mcpAccess` (per-connection intent) and `readOnlyMode` (driver-level
  enforcement) stay distinct but should agree: opening at `read` should set the
  driver read-only, as `connect` already does.
- Don't expose passwords or `mcpAccess: none` connections over MCP, ever.

---

## ⏳ After that: `get_schema_graph` polish
- Exercise `get_schema_graph` on the local `mlc` DB (~200 tables): verify
  bounded-concurrency fetch, sensible payload size, and that the node/edge
  shape is what a UI graph (or an agent) wants. Add a `schema` filter and
  consider an `includeColumns` flag.
- This is the relationship view that makes Beekeeper+MCP more than a SQL pipe.

## Later ideas
- Per-connection access UI parity with SlashTable's editor (tags/labels,
  keychain hint).
- Auth on the MCP endpoint (SlashTable uses a bearer/OAuth provider) for when
  the port is shared.
- A `connect`-by-name convenience and a `current database` switch tool.
