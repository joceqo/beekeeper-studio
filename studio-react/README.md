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

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4 (`@theme` tokens in `src/index.css`, mapped 1:1 from
  `~/Desktop/records/SlashTable/css/design-tokens.json`)
- `@glideapps/glide-data-grid` — the canvas data grid (centerpiece)
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
  listSchemas(connectionId): Promise<Schema[]>;
  listTables(connectionId, schema?): Promise<TableSummary[]>;
  describeTable(connectionId, table, schema?): Promise<TableDescription>;
  getRecords(params): Promise<RecordPage>;
  executeQuery(connectionId, sql): Promise<QueryResult>;
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
