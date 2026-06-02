# Next steps — paste-ready prompts (continue in the cloud)

Hand any **Prompt** block below to a coding agent working on this repo
(`joceqo/beekeeper-studio`, branch `master`). They're self-contained.

## Repo state / how to run
- **`studio-react/`** — standalone React renderer (Vite + React 18 + TS + Tailwind v4
  + Glide Data Grid + React Flow + Monaco + Base UI + cva + Sonner + Vaul). Own
  `package.json` (NOT in root yarn workspaces).
- **`apps/studio/`** — the Electron app + Vue 2 renderer + the whole DB backend
  (15+ clients, handlers, appdb) + the in-app **MCP server**
  (`src/backend/mcp/{server,tools,sqlGuard}.ts`).
- **Run modes:**
  - `cd studio-react && yarn dev` → mock data (browser, default).
  - `cd studio-react && VITE_BACKEND=mcp yarn dev` → real data via the MCP HTTP
    server (needs the Electron app running with `[mcp] enabled` on :27500).
  - `cd apps/studio && yarn electron:serve` → the **Vue** app (default, untouched).
  - `cd studio-react && yarn dev` + `cd apps/studio && BKS_REACT=1 yarn electron:serve`
    → **studio-react as the Electron renderer** over MessagePort (real data).
- **Backend abstraction:** `studio-react/src/ipc/types.ts` (`BackendClient`) with three
  impls: `mockClient.ts`, `mcpClient.ts` (HTTP), `electronClient.ts` (MessagePort).
  IPC logging is tagged `[ipc] <handler> ...`; `VITE_DEBUG_IPC=1` for per-request logs.
- **Specs to read:** `SLASHTABLE_ANALYSIS.md` (the authoritative reverse-engineered
  spec — semantic types, icon map, drilldown, filters, keymap, behavior),
  `REACT_IPC_CONTRACT.md` (MessagePort contract), `REDESIGN.md`, `MCP_ROADMAP.md`.
- **Always:** `cd studio-react && yarn build` + `yarn typecheck` must pass; keep the
  mock default + all three backends working; never break the default Vue app.

---

## 1. AI-access toggle in Beekeeper's connection form (MCP) — highest value
> Add a per-connection "AI access" setting (Hidden / Read / Write) to Beekeeper
> Studio's **Vue** connection form, persisted, and honored by the in-app MCP
> server. Read the "AI access toggle" section of `MCP_ROADMAP.md`.
> 1. **DB column:** add `mcpAccess varchar(8) not null default 'read'` to
>    `saved_connection` via a new migration modeled on
>    `apps/studio/src/migration/ultimate/20221103_add_read_only.js`; register it in
>    `apps/studio/src/migration/index.js`; add the matching `@Column` to
>    `apps/studio/src/common/appdb/models/saved_connection.ts` (template: the
>    `readOnlyMode` column).
> 2. **UI:** add a 3-way control ("AI access": Hidden/Read/Write) to the advanced
>    section of the connection form (`apps/studio/src/components/connection/CommonAdvanced.vue`),
>    bound to `config.mcpAccess`, neutral helper text (see `CLAUDE.md` UI Copy Style).
> 3. **Plumb through:** `mcpAccess` is part of the saved config passed to
>    `conn/create` (`apps/studio/src-commercial/backend/handlers/connHandlers.ts`);
>    set `state(sId).mcpAccess = config.mcpAccess` there so UI-opened connections get
>    the saved level (today only MCP-opened ones set it). The MCP `connect` tool in
>    `apps/studio/src/backend/mcp/tools.ts` should default to the saved connection's
>    `mcpAccess` instead of hardcoding "read".
> 4. **Hidden:** map "Hidden" → `mcpAccess: "none"`; `list_connections` /
>    `list_saved_connections` already filter `none` — verify a Hidden connection
>    never appears over MCP and `connect` refuses it.
> Verify: `npx tsc --noEmit -p apps/studio/tsconfig.json` adds 0 errors over baseline;
> `yarn lint`; run the app and confirm Read rejects writes / Write allows / Hidden hides.

## 2. Schema graph: depth-from-focus
> In studio-react, make the schema graph open at **depth 1 from a focused table**
> instead of dumping the whole schema (SlashTable default depth 1, graph opens with
> the table pinned). Files: `studio-react/src/components/grid/SchemaGraphView.tsx`,
> `src/ipc/*` `getSchemaGraph`. Add a `rootTable` + `depth` arg to `getSchemaGraph`
> in `BackendClient` (types + mock + mcp + electron); expand neighbors on node click
> (BFS by FK from the root, cap depth). Opening the graph from a table tab pins that
> table as root. Keep React Flow + the M2M join-table dashed styling. `yarn build` +
> typecheck pass.

## 3. M2M traversal in drilldown
> In studio-react, extend the relationship drilldown to traverse **many-to-many**
> join tables (today only direct FK 1:N / N:1 work). When a relation goes through a
> detected join table (heuristic: PK = 2+ FK columns, no other non-keyed columns),
> drilling should hop through the junction and show the far-side rows, with the join
> condition reflected in the breadcrumb + linked FilterBar (SlashTable v0.5.9). Files:
> `src/lib/relations.ts`, `src/components/grid/{RelationView,DrilldownBreadcrumb}.tsx`,
> the relation columns in `DataGrid.tsx`. Keep mock + electron + mcp working.

## 4. Editing: insert row + array editor
> In studio-react, finish the editing surface to match SlashTable:
> (a) **Insert row** via Glide `trailingRowOptions` (sticky `+` trailing row) +
> `onRowAppended` → stage a new row in the pending-edits store
> (`src/store/pendingEdits.ts`); commit via the existing preview→commit flow
> (`executeWrite`). (b) **Array editor** for Postgres array columns
> (`text[]/int[]/uuid[]`) in the ROW detail panel (`src/components/detail/DetailPanel.tsx`)
> — a first-class multi-value editor with `{…}` literal round-trip. Keep edits
> behind the confirm dialog + read-only-connection guard. `yarn build` + typecheck pass.

## 5. React renderer as default + notarized build
> Decision/finalization task on `apps/studio`. Make studio-react the DEFAULT renderer
> (flip the `BKS_REACT` gate in `apps/studio/src/background/WindowBuilder.ts` so React
> loads by default, keep a flag to fall back to Vue), and produce a distributable
> macOS build. The packaging is already wired (electron-builder `extraResources`
> copies `studio-react/dist` → `<resources>/studio-react`; `electron:build` runs
> `build:react`). Steps: confirm the flip, run `yarn electron:build --dir` (unpacked,
> no notarization) and launch the `.app` to confirm React loads with real data; then
> document the notarized build (`yarn electron:build`, needs Apple creds). Keep Vue
> reachable behind the inverse flag. Don't break either renderer.

## 6. Trim the Monaco bundle (optional, size)
> studio-react bundles full Monaco + 5 language workers (`src/lib/monaco.ts`), ~5 MB
> main chunk + ~8 MB workers. Trim to what's actually used (SQL editor + JSON popout):
> import a minimal Monaco subset (editor API + the SQL basic-language + JSON), drop the
> css/html/ts workers from `MonacoEnvironment.getWorker`, and code-split Monaco out of
> the main chunk via dynamic import / `manualChunks`. Keep it offline (no CDN) and the
> SQL editor + theme defs working. `yarn build` + typecheck pass; report the new sizes.

## 7. MCP settings tab + bearer auth
> Two MCP polish items on `apps/studio`. (a) Add an **MCP settings tab** (Vue) showing
> the server on/off toggle + port + a copy-paste config snippet for Claude Desktop /
> Claude Code / Cursor (`{ "mcpServers": { "beekeeper": { "url": "http://127.0.0.1:27500/mcp" }}}`),
> like SlashTable. (b) Optional **bearer-token auth** on the MCP HTTP endpoint
> (`apps/studio/src/backend/mcp/server.ts`) for when the port is shared — generate a
> token, require it in the Authorization header, surface it in the settings tab.
> Keep the read/write guard. Typecheck 0 added; don't break existing tools.

## 8. Tests + CI
> Add tests for the React renderer's pure logic and an e2e smoke. Unit (vitest or the
> existing jest setup): `studio-react/src/lib/{filters,relations,semantic,explorer}.ts`
> (compileWhere, M2M detection, inferSemanticType, prefix grouping). E2e (Playwright):
> launch `studio-react` (mock backend), assert the grid renders, a filter narrows rows,
> a drilldown opens a relation tab, ⌘K opens the palette. Wire a GitHub Actions
> workflow that runs `studio-react` build + typecheck + tests on push. Keep it green.

---

### Suggested order
1 (AI-access toggle — closes the original MCP loop) → 2+3 (graph/drilldown parity) →
4 (editing) → 5 (React default + build) → 6/7/8 (polish, MCP tab, tests).
