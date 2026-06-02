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

## Run it as Beekeeper's Electron renderer against the REAL backend (Phase C "C0")

This is the **C0** milestone from [`../REDESIGN.md`](../REDESIGN.md): studio-react
runs as the Electron **renderer**, receives the renderer↔utility `MessagePort` via
the existing preload handshake, and drives the **real** Beekeeper backend through
[`ElectronBackendClient`](src/ipc/electronClient.ts) — **no MCP HTTP server
involved**. It is gated behind the `BKS_REACT` env flag so the default Vue app is
untouched.

The transport ([`src/ipc/transport.ts`](src/ipc/transport.ts)) is a Vue-free port
of the Vue app's `UtilityConnection`: it speaks the exact wire framing from
[`../REACT_IPC_CONTRACT.md`](../REACT_IPC_CONTRACT.md) §1.3 —
`port.postMessage({ id, name, args: { sId, ...args } })` out; `{ id, type:
'reply'|'error', data|error, stack }` back; `{ type, input }` server pushes — with
the same queue-before-port + lazy `window.main.requestPorts()` behaviour. The
handshake is wired in [`src/main.tsx`](src/main.tsx) (`attachPortListener()` +
`window.onmessage` → `transport.setPort(port, sId)`), mirroring
`renderer.ts:205-215`.

`ElectronBackendClient` maps the `BackendClient` interface onto `conn/*` handlers:
`listConnections` → `appdb/saved/find`; `connect` → `conn/create` (with `osUser`
from `window.main.fetchUsername()`, mirroring the Vue store) opening a saved
connection into the single session this window owns; `listSchemas` →
`conn/listSchemas`; `listTables` → `conn/listTables`+`conn/listViews`;
`describeTable` → `conn/listTableColumns`+`getPrimaryKeys`+`listTableIndexes`+
`getTableKeys`+`getIncomingKeys`; `getRecords` → `conn/selectTop`; `executeQuery`
→ `conn/executeQuery`; relation counts / page counts run grouped `SELECT`s via
`conn/executeQuery` and degrade to empty on error; `getTableStats` degrades to
empty (no dedicated handler).

### Run both modes

```bash
# DEFAULT (Vue) — unchanged. BKS_REACT unset:
cd apps/studio && yarn electron:serve         # loads the Vue renderer (localhost:3003)

# REACT (C0) — two terminals:
cd studio-react && yarn dev                    # studio-react Vite dev server on :5273
cd apps/studio  && BKS_REACT=1 yarn electron:serve   # Electron loads :5273 as the renderer
```

With `BKS_REACT=1`, the Electron window loads studio-react with the **same
preload**, hands it the `MessagePort`, and studio-react: lists saved connections
(sidebar), opens one via `conn/create`, lists its tables, and shows real rows over
the port — proving the seam without MCP.

- `BKS_REACT_URL` overrides the dev URL (default `http://localhost:5273`).
- Inside the Electron renderer, [`src/ipc/index.ts`](src/ipc/index.ts) auto-detects
  the preload bridge (`window.main`) and selects `ElectronBackendClient`
  automatically — no `VITE_BACKEND` needed. Set `VITE_BACKEND=electron` to force it,
  or `VITE_BACKEND=mock` to force the mock even inside Electron.

### Deferred for C0

- **Production (packaged) load.** `WindowBuilder` points the prod path at
  `file://…/studio-react/index.html`, but the electron-builder config does not yet
  copy `studio-react/dist` into the packaged resources. C0 is verified via the dev
  server (`yarn dev`), which the spec accepts. A follow-up should add a build step
  that copies `studio-react/dist` and an `app://`-style protocol (or adjust the
  file path) so `BKS_REACT=1` works in a packaged build.
- **Total row counts** for the grid are estimated from the page size (no
  `conn/getTableLength` call yet); wire `getTableLength` for exact totals later.
- **Cancelable queries / pushes.** The transport supports server pushes
  (transaction-timeout events) but the C0 client uses one-shot `conn/executeQuery`
  (no `conn/query`+`query/execute` cancel handle). Add later for the editor.

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

| Env / environment | Client |
| --- | --- |
| `VITE_BACKEND=electron` | `ElectronBackendClient` (real backend over the renderer `MessagePort`) |
| running inside Electron (`window.main` present), no flag | `ElectronBackendClient` (auto-detected) |
| `VITE_BACKEND=mcp` | `McpBackendClient` (real DB via MCP HTTP) |
| `VITE_MCP_URL=<url>` | overrides the MCP endpoint (default `http://127.0.0.1:27500/mcp`) |
| `VITE_BACKEND=mock`, or plain browser with no flag | `MockBackendClient` (in-memory canned data) — **default** |

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
- **`@base-ui-components/react`** — headless UI primitives (Select, Menu,
  Tooltip, Tabs, Switch, ToggleGroup, Popover, Combobox, Dialog), matching
  SlashTable's actual stack
- **`class-variance-authority`** + **`clsx`** + **`tailwind-merge`** — variant
  + class composition for the design-system primitives (`cn()` in `src/lib/cn.ts`)
- **`sonner`** — toast notifications (`<Toaster/>` mounted once in `App.tsx`)
- **`vaul`** — drawer/sheet primitive (available via `src/ui/Drawer.tsx`)
- `@glideapps/glide-data-grid` — the canvas data grid (centerpiece)
- `@xyflow/react` (+ `dagre` for directed auto-layout) — the schema
  relationship graph (FK edges, cardinality, M2M join-table detection)
- `@monaco-editor/react` — the SQL editor
- **`react-resizable-panels`** — the whole app-shell layout (sidebar / main /
  detail dock + grid / activity vertical split). Replaced all hand-rolled
  mouse-drag resize. See "App-shell layout" below.
- `lucide-react` — icons
- Inter Variable / JetBrains Mono Variable (`@fontsource-variable/*`)
- Zustand — state (tabs, sidebar, theme, activity log, status, layout, filters,
  UI scale, transient command-palette/overlay UI)

> Radix UI has been removed from the source. Base UI is the headless-primitive
> layer now. (`@radix-ui/react-dialog` may still appear in `yarn.lock` as a
> transitive dependency of `vaul`, but nothing in `src/` imports Radix.)

## Design-system primitives (`src/ui/`)

A consistent, token-themed primitive layer (Base UI + cva) sits in
[`src/ui/`](src/ui) and is the single import surface (`import { … } from "@/ui"`):

| Primitive | Built on | Notes |
| --- | --- | --- |
| `Button` | cva | variants `primary / ghost / subtle / danger`, sizes `sm / md` |
| `IconButton` | cva | square icon button, replaces `.grid-toolbar-btn` / `.rail-btn` |
| `Input` / `Textarea` | native | token-themed form fields |
| `Select` | Base UI Select | `items` API, drop-in for native `<select>` |
| `Combobox` | Base UI Combobox | typeahead filter |
| `Popover` | Base UI Popover | themed anchored panel |
| `Menu` / `ContextMenu` | Base UI Menu / ContextMenu | dropdown + right-click, `items` API with icon/kbd/danger |
| `Tooltip` / `TooltipProvider` | Base UI Tooltip | optional `kbd` shortcut hint via `Kbd` |
| `Tabs` | Base UI Tabs | underlined tab bar with sliding indicator |
| `Switch` | Base UI Switch | on/off toggle |
| `SegmentedControl` | Base UI ToggleGroup | single-select (the AI-access Hidden/Read/Write control) |
| `Dialog` | Base UI Dialog | modal with backdrop + close |
| `Drawer` | Vaul | slide-in sheet (bottom/edge) |
| `Badge` / `Chip` | cva | env tags, relation/filter chips, count pills |
| `Kbd` | — | keyboard shortcut hint |
| `Toaster` / `notify` | Sonner | app-root toast host + `toast` re-export |

All are themed off the CSS tokens in `src/index.css` (accent `#d95200`, warm
neutrals) and respond to the dark/light `[data-theme]` switch.

### Migrated surfaces

These screens now use the `src/ui` primitives instead of raw
`<button>`/`<select>`/`<input>` or Radix:

- **App root** — `TooltipProvider` + Sonner `Toaster` mounted once
- **TitleBar** — theme/settings `IconButton`s + `Tooltip`
- **TabStrip** — close + new-tab `IconButton`s + `Tooltip`
- **Sidebar** — rail/header `IconButton`s, `Tooltip`s, env-tag `Badge`s,
  folder-grouped connections + paint dots, schema/prefix Explorer folders with
  counts + per-table row estimates (mono)
- **Grid toolbar** (TableView + RelationView) — refresh/sort/insert/paging/dock
  `IconButton`s + `Tooltip`s, Retry `Button`
- **FilterBar** — column/operator `Select`s, value `Input`s, add/remove
  `Button`/`IconButton`s, count `Badge`
- **DetailPanel** — close `IconButton`, visibility-toggle `Button`, semantic-type
  field icons (shared with the grid header, see Drilldown v2 below)
- **DrilldownBreadcrumb** — branching breadcrumb built from `src/ui` `Chip`
  (removable `×`), `Badge` (sibling count pill), `IconButton` + `Tooltip`
  (back/forward); no raw chips or Radix
- **ConnectionScreen** — engine `Tabs`, `Input` fields, AI-access
  `SegmentedControl`, Connect/Save `Button`s routing through `notify`
- **QueryEditor** — Run `Button`, format `IconButton`, success/error `notify`
- **SchemaGraphView** — refresh `IconButton`, Retry `Button`
- **ActivityPanel** — collapse `IconButton`, Clear `Button`, count `Badge`

### TODO (still on raw elements / not yet migrated)

- The **FilterBar group header** AND·OR combinator and NOT toggle are still
  styled raw buttons (intentional — they are bespoke pill toggles); could move
  to a small `Toggle`-based control later.
- The **DetailPanel format pills** (Text/Number/Currency/…) are bespoke
  active/inactive bordered buttons; a future `SegmentedControl` or `ToggleGroup`
  pass could unify them.
- **Connection / table list rows** in the sidebar are layout-specific
  `<button>`s (multi-slot rows with icons, tags, paint dots, counts) — fine
  as-is.
- **StatusBar** is text-only (no controls to migrate).
- **Drawer / Combobox / Popover** are built and exported but not yet adopted
  anywhere; they are wired and available for upcoming work (write-confirm
  dialogs, etc.). `Dialog` / `Switch` / `SegmentedControl` are now used by the
  command palette + settings dialog (see "Command palette + keybindings").

### Drilldown v2 + startup (recent work)

- **Seeded-tab connection fix** — the demo tabs no longer hardcode a connection
  id (`mlc-local`). On startup `useTabsStore.bootstrap()` resolves the real
  connection list (`listConnections` → `connect` → `listTables`) and opens the
  first table; the sidebar default `activeConnectionId` is `null` and resolves
  the same way. A fresh load now works in BOTH the mock and `VITE_BACKEND=mcp`
  with no "Unknown or disconnected connection" error. The QueryEditor also runs
  against the sidebar's active connection instead of a hardcoded id.
- **Semantic-type icons (§4)** — `semanticType(column, isFk, isRelation)` in
  [`lib/relations.ts`](src/lib/relations.ts) follows SlashTable's exact
  `pickSpriteName` priority (PK → FK → relation → semanticType → dataType
  fallback → text). The Lucide map lives in
  [`SemanticIcon.tsx`](src/components/grid/SemanticIcon.tsx) and the matching
  Glide header sprites in
  [`headerIcons.ts`](src/components/grid/headerIcons.ts); both share one mapping.
- **Branching breadcrumb model (§3)** — relation tabs carry a `DrilldownNode`
  tree (`tree` / `activeNodeId` / `history` / `historyIndex`) in
  [`store/tabs.ts`](src/store/tabs.ts). Re-drilling from an existing tab adds a
  BRANCH rather than opening a new tab.

### TODO (deferred from the Drilldown v2 spec)

- **§5 Schema-graph depth-from-focus** — defaulting the schema graph to depth 1
  from a focused/pinned table (instead of all tables) and expanding neighbours on
  demand, with `get_schema_graph(rootTable, depth)`. Left as a separate
  follow-up per the spec; `SchemaGraphView` still renders the full graph.

## Command palette + keybindings

A SlashTable-style command palette (⌘K) and a global keybinding system, modeled
on the `DEFAULT_KEYMAP` in [`../SLASHTABLE_ANALYSIS.md`](../SLASHTABLE_ANALYSIS.md)
("Behavioral logic" / DEFAULT_KEYMAP).

- **Keybinding registry** ([`src/lib/keymap.ts`](src/lib/keymap.ts)) — the
  `DEFAULT_KEYMAP` (command id → `[{ shortcut:{key,mod,shift,alt,ctrl}, when? }]`,
  multi-binding) plus `useGlobalKeybindings()`, a single capture-phase window
  `keydown` listener mounted once in [`App.tsx`](src/App.tsx). `mod` is the
  platform command key (⌘ on macOS, Ctrl elsewhere). `when` guards are evaluated
  against live context — notably `!inputFocus` (suppressed while typing in an
  `input` / `textarea` / `contenteditable` / Monaco editor) and `tableTab` (the
  active tab is a table). The listener `preventDefault`s matches so browser
  defaults like ⌘T / ⌘W / ⌘- don't fire.
- **Command registry** ([`src/lib/commands.ts`](src/lib/commands.ts)) — a central
  `useCommands()` hook returning `{ id, label, group, icon, run(), shortcut }`
  resolved against the app stores/backend, plus a `run(id)` dispatcher. The
  palette UI and the keybinding hook share this one list (so a shortcut and its
  palette row always do the same thing). Shortcut hints are derived from
  `DEFAULT_KEYMAP`.
- **Command palette UI** ([`CommandPalette.tsx`](src/components/palette/CommandPalette.tsx))
  — a Base UI `Dialog` modal; fuzzy-filtered (tiny inline subsequence matcher in
  [`src/lib/fuzzy.ts`](src/lib/fuzzy.ts), no dependency added), grouped by
  section, each row showing its label (mono) + a `Kbd` shortcut. ↑/↓ navigate,
  Enter runs, Esc closes; searching switches to a flat ranked list.
- **Connection switcher** ([`ConnectionSwitcher.tsx`](src/components/palette/ConnectionSwitcher.tsx))
  — ⌘D opens a filterable list of saved connections (`backend.listConnections`);
  selecting one sets it active in `useSidebarStore` (drives the explorer + new
  tabs).
- **Settings dialog** ([`SettingsDialog.tsx`](src/components/palette/SettingsDialog.tsx))
  — ⌘, opens a minimal settings modal: theme toggle, UI scale +/−/reset, and a
  vim-mode stub (persisted, not yet consumed by the editor).
- **UI scale** ([`store/uiScale.ts`](src/store/uiScale.ts)) — ⌘= / ⌘- / ⌘0 apply
  a `zoom` factor to the document root (persisted), scaling the whole shell.

### Commands

| Command | Shortcut | Action |
| --- | --- | --- |
| `core.palette` | ⌘K, ⌘P, `/` (when not typing) | Open the command palette |
| `core.db-switcher` | ⌘D | Open the connection switcher |
| `core.new-sql-tab` | ⌘T | New SQL/query tab |
| `core.new-explorer-tab` | ⌘⇧E | Reveal + focus the Explorer (sidebar) |
| `core.schema-graph` | ⌘⇧G | Open a schema-graph tab for the active connection |
| `core.close-tab` | ⌘W | Close the active tab |
| `core.next-tab` | ⌘⇧] | Activate the next tab |
| `core.prev-tab` | ⌘⇧[ | Activate the previous tab |
| `core.toggle-sidebar` | ⌘/ | Collapse/expand the sidebar |
| `core.toggle-context-sidebar` | ⌘⇧/ | Collapse/expand the detail panel |
| `core.toggle-log-panel` | ⌘J | Collapse/expand the activity log |
| `core.zoom-in` | ⌘= (also ⌘+) | Zoom the UI in |
| `core.zoom-out` | ⌘- | Zoom the UI out |
| `core.zoom-reset` | ⌘0 | Reset UI zoom to 100% |
| `core.focus-explorer-search` | ⇧T (when not typing) | Reveal + focus the sidebar search |
| `core.reconnect` | ⇧R (when not typing) | Reconnect the active connection (`backend.connect`) |
| `core.open-settings` | ⌘, | Open the settings dialog |
| `table.add-filter` | `f` (table tab, when not typing) | Open + seed the FilterBar |

Cross-component actions (focus the sidebar search, open the active table's
FilterBar) flow through small "signal" counters in
[`store/ui.ts`](src/store/ui.ts), so a command can ask a mounted component to do
something it owns without holding a ref to it.

## App-shell layout (react-resizable-panels)

The whole shell is a `PanelGroup` tree in [`App.tsx`](src/App.tsx); there is no
hand-rolled mouse-drag resize anywhere anymore.

```
PanelGroup horizontal (autoSaveId "studio-react.layout.horizontal")
├─ Panel  sidebar   collapsible, min 12 / max 32     → <Sidebar/>
├─ PanelResizeHandle (thin token line, accent on hover/drag)
├─ Panel  main      min 30
│   └─ PanelGroup vertical (autoSaveId "studio-react.layout.vertical")
│      ├─ Panel content   → <MainContent/> (grid / editor / graph / connection)
│      ├─ PanelResizeHandle
│      └─ Panel activity   collapsible          → <ActivityPanel/>
├─ PanelResizeHandle
└─ Panel  detail    collapsible, min 14 / max 40   → detail-dock portal host
```

- **Sizes** persist automatically via the two `autoSaveId`s (localStorage).
- **Collapse** is wired through [`store/layout.ts`](src/store/layout.ts): each
  collapsible Panel registers its `ImperativePanelHandle` and mirrors its
  collapsed state (synced from `onCollapse`/`onExpand`, persisted). The existing
  toggle buttons (sidebar collapse, detail-dock toggle in the grid toolbar,
  activity collapse chevron) now call `layout.toggle("sidebar"|"detail"|"activity")`,
  which collapses/expands the Panel via that handle.
- **Detail dock** is a structural Panel in the shell, but its *content*
  (`DetailPanel`) still comes from the active grid view (TableView /
  RelationView) since it depends on that view's page/selection/description.
  Rather than lift all of that into the shell, the dock Panel exposes a portal
  host ([`DetailDock.tsx`](src/components/shell/DetailDock.tsx)) and views
  teleport their `DetailPanel` into it with `createPortal`. So the layout owns
  sizing/collapse while the per-view detail logic is untouched.
- The old per-feature resize state (`sidebar.width`, `activity.height`,
  `detailDock.width` + their drag handlers) was removed; `store/detailDock.ts`
  was deleted.

## What's in the UI

- **Title bar + tab strip** — table / query / connection tabs, active tab uses
  the burnt-orange accent and an underline; `+` opens a new query tab.
- **Collapsible sidebar (SlashTable parity)** — a resizable Panel (see
  "App-shell layout") that collapses to a thin icon rail. Everything is
  JetBrains Mono.
  - **CONNECTIONS** are grouped into **folders** (mock: `Demo` ▸ mlc local
    `DEV` / ecommerce `TST`, `Production` ▸ mlc remote `PRD`, plus loose
    `CLICKY`). Each connection shows a colored env-**tag** `Badge` and a
    **paint** dot (`Connection.paint`); the active connection is highlighted.
    Real MCP connections have no folders/tags — they render flat, which is fine.
  - **EXPLORER** renders tables under a **schema folder** (`public`, …) showing
    the schema's table count on the right; within a schema, tables are
    **prefix-grouped** into collapsible sub-folders via a snake_case tokenizer
    (`achievements` + `achievement_categories` → an `achievements` group), with
    **join-tables-last** + **public-first** ordering
    ([`lib/explorer.ts`](src/lib/explorer.ts)). Each table shows its
    **estimated row count** on the right (`57.7K`, `882K`). Collapse state for
    every folder/group is persisted (`store/sidebar.ts`).
- **Data grid** — Glide canvas grid with ~50+ mock rows for `public.users`
  (id / email / username / …), smooth scrolling, NULL styling, typed cells.
- **Relationship drilldown v2** (SlashTable's #1 differentiator) — related
  tables appear as first-class **relation columns** after the real data columns,
  one per outgoing FK (parent, `N:1`) and one per incoming FK (children, `1:N`),
  each with a `↗` header icon. Each relation cell shows the **per-row count**
  for THAT row — `order_items (3)` in the accent color, dimmed `shipments (0)`.
  Counts are fetched for the **whole visible page** with one grouped query per
  relation (`SELECT fk, count(*) … WHERE fk IN (<page pks>) GROUP BY fk`, via
  `getPageRelationCounts`) and cached per (table, page) — cheap, not one call
  per row. A column that **is a foreign key** renders its value as an
  accent-coloured link with a trailing `→`; clicking it drills into the parent
  row (`N:1`). Clicking a relation cell drills into the children (`1:N`). Both
  open/extend a **branching breadcrumb**: the breadcrumb is a TREE, not a linear
  path — from any node you can follow multiple relations, creating sibling
  branches. Each node is a removable chip (`×`); the active node is
  accent-coloured; record-pinned nodes show `#<id>`; **back/forward** arrows walk
  the activation history; clicking a chip activates it; inactive sibling branches
  collapse behind a count pill that expands to switch branches. Each step seeds
  its join condition (`fk = value` / `pk = value`) into the linked FilterBar via
  `lib/filters`, so the join filter is visible and editable. Mock topology:
  `campaigns.owner_id → users.id`, `events.user_id → users.id`,
  `reports.campaign_id → campaigns.id`.
- **Nested AND/OR filters** — a collapsible **FilterBar** above the grid (a
  "Filter" chip with an active-condition count badge + Clear). It edits a per-tab
  **filter tree**: groups carry an `AND·OR` toggle and a `NOT` negate, and hold
  conditions or nested groups arbitrarily deep. Each condition is a column select
  → operator select → value input(s): `equals / not_equals / contains /
  not_contains / starts_with / ends_with / gt / gte / lt / lte / between` (two
  inputs) `/ in / not_in` (comma-separated) `/ is_null / is_not_null` (no input).
  The tree compiles to a read-only SQL `WHERE` (nested parens, `ILIKE` for
  substring matches with `LIKE` fallback off Postgres, `BETWEEN`, `IN (…)`,
  `IS [NOT] NULL`) in [`src/lib/filters.ts`](src/lib/filters.ts), composes with
  the existing sort + paging, and re-drives the same grid via `getRecords`
  (extended with an optional `where`). State lives per tab in
  [`useFilterStore`](src/store/filters.ts) (persisted to localStorage). The same
  engine refines a **drilldown** tab: the FilterBar's WHERE is `AND`-ed onto the
  crumb's pinned `fk = value` condition. The mock backend honours a useful subset
  (equals/comparisons/contains/in/null) so the bar visibly filters offline.
- **Right detail dock** — a collapsible, resizable Panel in the app-shell
  layout (toggle in the table toolbar; size + collapse persisted by
  react-resizable-panels). Two modes driven by grid
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
- **Activity panel** — a collapsible Panel in the main column's vertical split
  (size + collapse persisted); category tabs
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
  // TableSummary.rowEstimate is the per-table estimated row count shown in the
  // Explorer. The MCP list_tables tool now returns `estimatedRows` (Postgres:
  // pg_class.reltuples, cheap, no count(*)); the mcpClient surfaces it.
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

**The real backend is now wired** (Phase C "C0", see the Electron-renderer section
above): [`ElectronBackendClient`](src/ipc/electronClient.ts) implements
`BackendClient` over the renderer `MessagePort` via
[`src/ipc/transport.ts`](src/ipc/transport.ts), and [`src/ipc/index.ts`](src/ipc/index.ts)
selects it when `VITE_BACKEND=electron` or when the Electron preload bridge is
detected at runtime. No UI component changes were required — every view consumes
`BackendClient` only. Stores (`src/store/*`) and components never import a concrete
client directly.
