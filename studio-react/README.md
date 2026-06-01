# studio-react

A standalone, SlashTable-style React renderer prototype for Beekeeper Studio.

This is **Phase C** from [`../REDESIGN.md`](../REDESIGN.md): the eventual
replacement for Beekeeper Studio's Vue renderer, rebuilt in SlashTable's exact
stack. For now it runs **standalone in a browser against mock data** so the full
UI can be reviewed without the Electron backend.

It is intentionally **not** part of the root Yarn workspaces and does not touch
`apps/` or the Electron main/utility process.

## Run it

```bash
cd studio-react
yarn install
yarn dev        # opens http://localhost:5273
```

Other scripts:

```bash
yarn build      # type-check + production build to dist/
yarn preview    # serve the production build
yarn typecheck  # tsc only
```

## Run it against a REAL database (via the app's MCP server)

The app ships an in-process **MCP** (Model Context Protocol) server over loopback
Streamable HTTP. This React renderer can talk to it directly from the browser —
no Electron renderer build required — to show live tables and rows.

1. **Enable MCP in the Electron app.** In `apps/studio/local.config.ini`:

   ```ini
   [mcp]
   enabled = true
   port = 27500
   defaultAccess = read
   ```

2. **Start the Electron app** and wait for `MCP server listening on
   http://127.0.0.1:27500/mcp` in the log:

   ```bash
   cd apps/studio && yarn electron:serve
   ```

3. **Open a connection in the app** (e.g. `mlc (local)`). Saved connections are
   listed by MCP; this renderer auto-opens (`connect`, access `read`) whichever
   one you click in the sidebar, so it doesn't strictly need to be open first.

4. **Run this renderer pointed at MCP:**

   ```bash
   cd studio-react
   VITE_BACKEND=mcp yarn dev          # -> http://localhost:5273
   # optional: VITE_MCP_URL=http://127.0.0.1:27500/mcp (this is the default)
   ```

   Click a connection in the sidebar to load its tables; click a table for live
   rows in the Glide grid; the **schema-graph** button (TABLES header, or a graph
   tab) renders foreign-key relationships from `get_schema_graph`.

The data-loading flow **awaits `backend.connect(connectionId)` first** (it maps a
saved/UI connection id to the live `connectionId`, e.g. `saved:1` → `mcp:1`) and
uses the resolved id for every subsequent `describeTable` / `getRecords` /
`listTables` call, so no request fires with an unresolved id.

CORS: the MCP server reflects loopback origins (`localhost` / `127.0.0.1`) so the
browser dev server can call it; non-loopback origins are not granted CORS.

### Backend selection

The app picks its `BackendClient` at startup from Vite env flags
([`src/ipc/index.ts`](src/ipc/index.ts)):

| Env | Client |
| --- | --- |
| _(unset / anything else)_ | `MockBackendClient` (in-memory canned data) — **default** |
| `VITE_BACKEND=mcp` | `McpBackendClient` (real DB via MCP HTTP) |
| `VITE_MCP_URL=<url>` | overrides the MCP endpoint (default `http://127.0.0.1:27500/mcp`) |

`McpBackendClient` ([`src/ipc/mcpClient.ts`](src/ipc/mcpClient.ts)) implements the
exact same `BackendClient` interface: it lazily `initialize`s a session (capturing
the `mcp-session-id` header), then `tools/call`s `list_saved_connections` /
`connect` / `list_schemas` / `list_tables` / `describe_table` / `get_records` /
`execute_query` / `get_schema_graph`, parsing the SSE `data:` line and the JSON in
`content[0].text`. Components and stores still consume only the interface.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4 (`@theme` tokens in `src/index.css`, mapped 1:1 from
  `~/Desktop/records/SlashTable/css/design-tokens.json`)
- `@glideapps/glide-data-grid` — the canvas data grid (centerpiece)
- `@xyflow/react` (+ `dagre` for directed auto-layout) — the schema
  relationship graph (FK edges, cardinality, M2M join-table detection)
- `@monaco-editor/react` — the SQL editor
- `@radix-ui/react-*` — tabs / tooltip primitives
- `lucide-react` — icons
- Inter Variable / JetBrains Mono Variable (`@fontsource-variable/*`)
- Zustand — state (tabs, sidebar, theme, activity log, status)

## What's in the UI

- **Title bar + tab strip** — table / query / connection tabs, active tab uses
  the burnt-orange accent and an underline; `+` opens a new query tab.
- **Collapsible sidebar** — CONNECTIONS (mock: `mlc local`, `mlc remote` with a
  red `PRD` tag, `CLICKY`) and TABLES with a search box; collapses to a thin
  icon rail.
- **Data grid** — Glide canvas grid with ~50+ mock rows for `public.users`
  (id / email / username / …), smooth scrolling, NULL styling, typed cells.
- **Relationship drilldown** (SlashTable's #1 differentiator) — related tables
  appear as virtual **relation columns** after the real data columns, one per
  outgoing FK (parent, `N:1`) and one per incoming FK (children, `1:N`),
  rendered as info-coloured chips (e.g. `▸ campaigns (1:N)`) with a child-row
  **count** badge when the backend exposes `get_relation_counts`. Clicking a
  relation chip opens a new **drilldown tab** showing the related rows filtered
  to that relationship (`SELECT … WHERE fk = <pk>` for children, `pk = <fk>` for
  parents, via a read-only `executeQuery`), with a clickable **breadcrumb** of
  the path (`users[42] › campaigns(owner_id)`). Drilldown nests arbitrarily deep
  and back-navigates by clicking any crumb. FK values in the detail panel follow
  the same drilldown. Mock topology: `campaigns.owner_id → users.id`,
  `events.user_id → users.id`, `reports.campaign_id → campaigns.id`.
- **Right detail dock** — collapsible + resizable panel docked on the right of
  the grid (toggle in the table toolbar, persisted). Two modes driven by grid
  selection: **Row detail** (select a row) shows a vertical key→value form with
  column name / type / value, NULLs styled, and foreign-key values rendered as
  clickable links that trigger the relationship drilldown (open the referenced
  parent row in a breadcrumbed relation tab). **Column detail** (click
  a header) shows name / type / nullable / PK / FK plus per-column **format**
  options (Text / Number / Currency / Percentage / Thousands) and a
  **visibility** toggle, both stored per column in a Zustand store and applied
  when the Glide grid renders that column.
- **Query editor** — Monaco with a Run button and a results grid below
  (resizable splitter); themed to match the app.
- **Activity panel** — resizable + collapsible bottom dock; category tabs
  `[SQL][App][MCP ①][User][System][Connections]` with unseen-count badges and
  an active orange underline; log table with Time / Ctg / Op / Connection /
  Tables / SQL / Duration / Rows; click a row to expand the SQL; Clear button.
  Running a table view or a query feeds live entries into it.
- **Status bar** — `Free — Personal Use` (left), `1.86s · 100 loaded / ~299
  total` + version (right).
- **Connection screen** — SlashTable-style "Edit Connection": Postgres / MySQL /
  SQLite tabs, a connection URL field, name/host/port/db/user/password, and an
  `AI access: Hidden / Read / Write` segmented control.
- **Dark + light themes** — toggled via the sun/moon button; applied through the
  `[data-theme]` attribute on `<html>`, exactly like SlashTable. Default dark.

## The IPC seam (how it swaps to the real backend later)

All data access goes through one narrow typed interface,
[`BackendClient`](src/ipc/types.ts):

```ts
interface BackendClient {
  listConnections(): Promise<Connection[]>;
  // Resolve a saved/UI connection id to the live connectionId. AWAIT this
  // before any schema/data call so requests never fire with an unresolved id.
  connect(connectionId): Promise<string>;
  listSchemas(connectionId): Promise<Schema[]>;
  listTables(connectionId, schema?): Promise<TableSummary[]>;
  // describeTable also returns incomingForeignKeys (child tables referencing
  // this one) alongside outgoing foreignKeys — drives the 1:N relation columns.
  describeTable(connectionId, table, schema?): Promise<TableDescription>;
  getRecords(params): Promise<RecordPage>;
  executeQuery(connectionId, sql): Promise<QueryResult>;
  getSchemaGraph(connectionId, schema?): Promise<SchemaGraph>;
  // Best-effort related-row counts for relation chips; resolves to [] when the
  // backend's get_relation_counts tool is unavailable (graceful degradation).
  getRelationCounts(params): Promise<RelationCount[]>;
}
```

Today the app imports a single `backend` instance from `src/ipc`, which is a
[`MockBackendClient`](src/ipc/mockClient.ts) that resolves canned data via
Promises (with small artificial latency).

The type shapes mirror what the Electron backend already exposes (the same
`list_connections` / `list_schemas` / `list_tables` / `describe_table` /
`get_records` / `execute_query` operations used by Beekeeper's MCP server and
the `IBasicDatabaseClient` contract).

**To wire the real backend** (Phase C, inside Electron):

1. Add an `ElectronBackendClient implements BackendClient` under `src/ipc/`
   that, instead of returning canned data, does
   `$util.send('conn/<handler>', args)` over the renderer↔utility `MessagePort`
   (the same handshake `renderer.ts` uses today: `window.onmessage` →
   `setPort(port, sId)`).
2. Map each interface method to its existing handler name (e.g.
   `getRecords` → `conn/selectTop`, `executeQuery` → `conn/query`,
   `listTables` → `conn/listTables`).
3. Swap the one export in `src/ipc/index.ts`:
   `export { backend } from "./electronClient"`.

No UI component changes are required — every view consumes `BackendClient`
only. Stores (`src/store/*`) and components never import the mock directly.
