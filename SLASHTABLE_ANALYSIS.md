# SlashTable — deep analysis (reverse-engineered)

Reference for the React fork. Findings from static analysis of SlashTable's
Tauri bundle (`index-MXUmt46H.js`, ~4.5 MB) and Rust binary. Use this to
prioritize features and pick the same libraries where it makes sense.

## Confirmed stack

- **React** + **Zustand** stores: `useSettings`, `useLayout`, `useConnections`,
  `useNeonStore`, `useFilterStore`, `useTableConfig`, `useExplorerView`.
- **Glide Data Grid** (`@glideapps/glide-data-grid`) — canvas data grid.
- **React Flow** (`@xyflow/react`) — the schema-relationship graph (APIs seen:
  `panBy`, `setViewportConstrained`, `translateExtent`, edges with
  source/target/sourceHandle/targetHandle, bendpoints, cardinality).
- **TanStack Table + Virtual** (`@tanstack/react-table`, `react-virtual`) — the
  log panel, the row-drilldown (expanded row models), and breadcrumb.
- **Monaco** (+ **Vim mode**), **Radix UI**, **Lucide**, **Shiki**.
- **Tauri `invoke`** — IPC to the Rust backend.
- Telemetry: analytics + **Sentry**.

## Backend (Rust)

- Drivers: **Postgres, MySQL/MariaDB, SQLite, Redis, Neon** (sqlx + a Neon API
  client). russh for SSH tunnels.
- Dialect-specific introspection SQL (pg `information_schema` + `pg_index` +
  `pg_matviews`; mysql; sqlite), per-schema **table/view counts** and
  **estimated row counts**.
- **M2M join-table auto-detection in SQL**:
  `is_join_table = (fk_col_count >= 2 AND non_keyed_count = 0)`. Errors like
  "M2M missing join table", "Could not resolve M2M join columns" confirm a
  dedicated many-to-many resolver.
- Endpoints: `api.slashtable.dev/license/{exchange,refreshAuthorizationEntitlements}`,
  `downloads.slashtable.dev/{changelog,update}`.
- In-app **MCP server** over loopback HTTP (read/write guard per connection).

## The features that make it more than a SQL client

1. **Smart schema graph (React Flow).** Nodes = tables, edges = FKs with
   cardinality; join tables auto-detected and folded. Drill controls:
   "Add root table", expand/collapse, "Delete child branches first". This is
   the headline differentiator.
2. **Relationship drilldown + breadcrumb.** From a row, navigate to related
   rows by following FKs (`relationship_type` one-to-many / many-to-many,
   `isFK/isPK/isRelation/inverseFk`), with a breadcrumb of the path. A
   relational data explorer, not just a grid.
3. **Neon branching** (major, optional for us). `neonCreateBranch`,
   `neonDeleteBranch`, `neonPreviewBranches`, `neonResolveBranchCredentials`,
   `neonAddCredential`, `neonSetProjectVisibility`, branch sync/unsync with
   expiry + metadata. Settings: `neonAutoSubscribeBranches`,
   `neonBranchNameTemplate`. Git-like branching for the database.
4. **Nested filter groups.** AND/OR filter blocks (`FilterBlockEditor`,
   promote/toggle/clear). Operators: equals, not equals, contains, starts/ends
   with, greater/less than, between, in, is null / is not null.
5. **Smart explorer.** `publicFirst`, `joinTablesLast` (reuses M2M detection),
   `groupByPrefix` + `prefixTokenizer` (groups `user_*`, `campaign_*`…), table
   favorites, connection folders.
6. **Cell formatting.** Currency, percentage, thousands separators; copy as
   JSON / qualified name / data type / column name.
7. **Secret/credential providers.** A `provider`/`reference` abstraction:
   `listVaultItems`, `resolveVaultSecret`, `authenticateVault`,
   `listAwsProfiles` (1Password/Bitwarden/Vault/AWS in the binary).
8. **MCP toggle** built into settings (`mcpEnabled`) — the app is the MCP server.

## Settings (persisted Zustand store)

`mcpEnabled`, `vimMode`, `uiScale`, `requireMutationConfirmation` (confirm
writes before they run), `defaultRowLimit`, `tagCasing`, `theme`,
`tableFavorites`, `actionSettings`, `explorerSettings`, `showWelcomeScreen`,
`skippedUpdateVersion`.

## Keyboard model

Arrow/selection navigation (`shift+Arrow`, `alt+Arrow`), `shift+Enter`,
`shift+Tab`; a command/keybinding system (`useKeybindingDef`, command sequences
in the filter bar). Optional Vim mode in the editor.

## Priorities for our fork (highest differentiator first)

1. **Schema graph with React Flow + M2M auto-detection** — backend already has
   `get_schema_graph` (MCP); add the M2M `is_join_table` heuristic and render
   with `@xyflow/react`, FK edges + cardinality. Do NOT hand-roll SVG.
2. **Relationship drilldown + breadcrumb** — follow FKs from a row to related
   rows (Beekeeper backend already exposes `getTableKeys` / incoming+outgoing
   keys).
3. **Nested filter groups** + **cell formatting**.
4. **Smart explorer**: group-by-prefix + join-tables-last (reuse M2M).
5. **Write safety**: `requireMutationConfirmation` before INSERT/UPDATE/DELETE.
6. Neon branching — large, optional, later.

## Notes / lib choices for studio-react

- Schema graph: `@xyflow/react` (React Flow). Match SlashTable.
- Log panel + drilldown + breadcrumb: `@tanstack/react-table` + `react-virtual`.
- Keep the BackendClient interface as the seam; M2M detection can live in the
  backend (SQL) or be derived client-side from FK metadata.

---

# Global pass (from the beautified bundle, 184k lines)

The minified bundle was beautified locally (`~/Desktop/records/SlashTable/beautified/`,
not committed — proprietary). This is the full picture from readable logic +
the complete Tauri command surface.

## Complete backend API — 85 Tauri `invoke` commands

**Connections/data:** connect, disconnect, reconnect_connection, test_connection,
list_connections, list_databases, list_schemas, list_tables, describe_table,
get_records, get_cell_value, execute_query, get_schema_graph,
get_relation_counts, get_table_stats, get_object_definition,
refresh_table_description, refresh_materialized_view.
**Write path (notable):** `preview_changes_sql` + `commit_changes` — pending
edits are shown as SQL and confirmed before running (write-safety + diff).
**Saved state:** load/save_saved_connections, delete_saved_connection,
save/load/delete_folder(s), save_json/load_json, cache_* (offline tab/connection
result cache: put/load/clear/sweep_orphans).
**SSH/tools:** check_ssh_agent, test_ssh_tunnel, detect_docker_postgres,
detect_tools, set_tool_path, set_use_login_shell.
**Secrets:** authenticate_vault, check_vault_auth, list_vault_items,
get_vault_item, resolve_vault_secret, resolve_vault_connection_password,
list_aws_profiles.
**Neon (branching):** neon_authenticate, neon_discover_projects,
load_neon_projects/credentials, neon_add_credential, neon_add_projects_to_credential,
neon_remove_credential, neon_create_branch, neon_delete_branch,
neon_preview_branches(_for_credential), neon_resolve_branch_credentials,
neon_set_project_visibility, neon_set_synced_branches, neon_refresh_project.
**MCP:** start_mcp_server, stop_mcp_server.
**License (Polar):** activate/deactivate/refresh_license, get_license_info/key,
exchange_polar_key, dev_set_license.
**CLI companion:** install_cli, uninstall_cli, get_cli_install_status, cli_respond.
**Misc:** format_sql, hint_table_navigation, fetch_changelog, log_message,
set_frontend_log_level, open_config_file/folder, delete_config_file,
open_local_network_settings, discover_plugins_cmd, ensure_plugins_dir_cmd.

## Cell / semantic types (Glide renderers)

text, number, boolean, json, **image**, url, **relation** (drilldown column),
email, timestamp, date, **currency**, **percentage**, uuid, markdown. Columns
carry a semantic type that drives rendering + formatting; relation columns are
virtual (related rows appear as expandable columns in the grid).

## Credential providers (5)

`onepassword`, `keychain` (macOS), `hashicorp` (Vault), `bitwarden`, `aws` — a
unified provider/reference model; a connection's password can resolve from any
of them at connect time (`resolve_vault_connection_password`).

## Stores

`useFilterStore`, `useNeonStore`, `useMcpStore`, `useConfirmStore` (mutation
confirmation dialogs), `usePromptStore`, and **three separate log stores** —
`useLogStore` (SQL), `useAppLogStore` (App), `useMcpLogStore` (MCP) — which back
the Activity panel's category tabs (System/User/Connections likely derived).

## Refined fork priorities (updated)

1. **Relation columns + drilldown** — backend `get_schema_graph` +
   `get_relation_counts`; render OneToMany/ManyToMany as virtual expandable grid
   columns (the real SlashTable drilldown, now confirmed in code).
2. **Right detail panel** — ColumnDetailPanel (stats via `get_table_stats`,
   format, semantic type, visibility) + RowDetailSection.
3. **Preview + confirm writes** — `preview_changes_sql` → diff → `commit_changes`
   (maps to our MCP write guard nicely).
4. **Schema graph (React Flow) + M2M** — done in studio-react.
5. **Credential providers** — our MCP/Beekeeper already has keychain; the
   provider model (1Password/Vault/Bitwarden/AWS) is a larger add.
6. Neon branching, CLI companion, Polar licensing — out of scope for now.

---

# Filter system spec (for the studio-react nested-filter feature, step #3)

From the bundle: filters are a **tree** of nodes edited in a `FilterBar` /
`FilterBlockEditor`, with `isGroup`, a combinator, `negate`, and `children`.
Blocks can be saved per tab (`savedFilterBlocks`), promoted, toggled, cleared.

**Node model (proposed for studio-react):**
```ts
type FilterNode =
  | { id: string; kind: "group"; combinator: "AND" | "OR"; negate?: boolean; children: FilterNode[] }
  | { id: string; kind: "condition"; column: string; operator: FilterOp; value?: unknown; value2?: unknown };

type FilterOp =
  | "equals" | "not_equals"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "gt" | "gte" | "lt" | "lte"
  | "between"            // uses value + value2
  | "in" | "not_in"      // value = array
  | "is_null" | "is_not_null";  // no value
```

**Compile to SQL** (read-only WHERE): recurse the tree → groups become
`(child AND/OR child …)`, optional `NOT (...)` when `negate`; conditions map to
`col = $v`, `col ILIKE '%v%'`, `col BETWEEN a AND b`, `col IN (…)`,
`col IS [NOT] NULL`, etc. Quote identifiers per dialect; escape/parameterize
values (reuse the backend escaping the MCP `get_relation_counts` tool already
uses, or pass the WHERE to `executeQuery`).

**UI** (above the grid): a bar showing the active block; each row = a condition
(column select → operator select → value input(s)); buttons to add condition /
add nested group / toggle AND·OR / negate / remove; a Clear. Apply runs the
filtered query (drives the same grid). Persist the active filter per tab in a
`useFilterStore` (Zustand), mirroring SlashTable's store.

**Integration:** the filtered fetch can go through `executeQuery` with the
compiled WHERE (read path), or add an optional `where` param to `get_records`.
Compose with sorting/paging already in the grid. This composes naturally with
the drilldown (a drilldown tab is just a pre-seeded condition `fk = value`).

---

# Official reference (changelog + official screenshot, v0.1.4 shot)

Corrects/sharpens the reverse-engineered guesses with ground truth.

## What the official "orders" screenshot shows (our biggest gaps)

1. **Drilldown breadcrumb is a BRANCHING TREE, not linear.** Top bar:
   `customers › reviews › products #142 › inventory_log › reviews` AND a second
   branch `customers ⌐ orders › shipments`. Each hop is a removable chip (×),
   the active node is orange, and a pinned record shows as `#142`. Back/forward
   arrows + a refresh. Ours is a single linear path — needs to become a tree
   with branch points + removable chips + pinned-record nodes.
2. **Relation columns are first-class, inline, with per-row counts.**
   `order_items (3)`, `shipments (1)`, dimmed `shipments (0)` — the count shows
   on EVERY row (not just the selected one), header has a `↗` icon. FK columns
   (`customer_id`) render as an **orange clickable link** with a `→`. Ours
   appends relation chips and only counts the selected row.
3. **Semantic-type icons in column headers:** 🔑 (pk `id`), `T` (text), `🔗`
   (fk/relation, orange), `{}` (json `shipping_address`), `↗` (relation). We
   show none.
4. **Filter = compact chip bar + command input.** `customer_id = <uuid>` chip
   with a lock toggle, `+`, `Clear`, plus a sort chip `1 ↕ id ×`. Opened with
   `f` / ⌘⇧F (single command input, v0.5.0). View-mode toggles (table/grid) in
   the toolbar. Ours is an expandable tree editor — keep the engine, but the
   bar should read as compact chips.
5. **Sidebar has folders + env tags + counts.** CONNECTIONS grouped in folders
   (`Demo` ▸ accounting `TST`, ecommerce `STG`, mailman `DEV` — colored env
   tags + connection paint dots); `Production` folder. FAVORITES (ecommerce ▸
   MVPs). EXPLORER = schema folders with counts (`analytics 6`, `public 20`)
   and per-table row counts (`inventory_log 10.0K`, `returns 254`). Search hint
   `/t`. Ours is a flat list, no folders/tags/counts.
6. **Status bar:** `ecommerce · 9ms 100 loaded / ~2.0K total · v0.1.4`.

## Feature timeline highlights (from the changelog)

- **Filtering** rebuilt around a single command input (`f`/⌘⇧F) — v0.5.0.
- **Command palette** = ⌘K (also `/`); **DB switcher** = ⌘D; zoom ⌘±/⌘0;
  reconnect ⇧R; run query ctrl/⌘/shift+Enter.
- **Editing**: insert rows (double-click below last row, or `+`), delete rows
  (shift+Delete), cell editor for low-cardinality/enums, JSON editor, **array
  editor** (text[]/int[]/uuid[]), big-text popout, 4 KB cell preview slicing.
- **Per-connection AI access** (Hidden/Read/Write) — v0.5.4 (the toggle we
  already added). **Connection paint** (colors) same release.
- **MCP**: HTTP server (v0.1.7), `connect` tool (v0.1.9), `list_schemas`,
  per-call source attribution in the log panel, MCP settings tab with
  copy-paste config for Claude/Cursor/Windsurf, enforces connection limit.
- **get_schema_graph** explores from starting tables with configurable **depth**
  (default 1) — NOT a full dump. Graph tab opens with the table **pinned**.
  (Ours currently renders the whole schema — should default to depth 1 from a
  focus table.)
- **M2M**: collapsed join tables report the correct row count in the cell and
  add a join filter to the linked filter bar.
- Drivers shipped in order: Postgres (v0.1.0) → MySQL (v0.3.0) → SQLite (v0.5.5)
  → Neon (v0.5.2). SSH tunneling v0.4.3. Multi-database v0.4.0 (⌘D switcher,
  per-connection workspaces).
- Grid went **canvas** for GPU-accelerated scroll at v0.5.8 (we already use
  Glide canvas).

## Revised top priorities (sharpened by the official shot)

1. **Drilldown parity**: branching breadcrumb tree (removable chips, pinned
   records, orange active) + inline relation columns with **per-row counts** +
   FK-as-orange-link. This is the signature feature and our biggest visual gap.
2. **Semantic-type column headers** (icons + colors) — cheap, high visual impact.
3. **Sidebar**: connection folders + env tags + connection paint; schema
   folders with counts + per-table row counts; group-by-prefix.
4. **Editing + insert + preview/commit writes** (maps to our MCP write guard).
5. **Schema graph depth-from-focus** (default depth 1, pin the table) instead of
   full-schema dump.
6. Command palette (⌘K) + DB switcher (⌘D) + keybindings.

---

# Drilldown v2 spec (for studio-react, after the UI overhaul)

Brings our drilldown to parity with the official screenshot. Build on the
existing `lib/relations.ts`, `RelationView.tsx`, `useRelationCounts.ts`, the
`tabs` store, and the new `get_relation_counts` MCP tool.

## 1. Inline relation columns with per-row counts
- Render relation columns as first-class grid columns (after data columns) with
  a `↗` header icon, e.g. `order_items`, `shipments`.
- Each cell shows the count for THAT row: `order_items (3)`, dimmed `shipments (0)`.
  → fetch counts for the visible page, not just the selected row. Batch one
  `get_relation_counts` per row-key, or a single grouped query
  (`SELECT fk, count(*) ... WHERE fk IN (<page pks>) GROUP BY fk`) — prefer the
  grouped query for the page to stay cheap. Cache per (table, page).
- Clicking a relation cell drills in (opens/extends the breadcrumb, see §3).

## 2. FK value as orange link
- A column that IS a foreign key (e.g. `customer_id`) renders its value as an
  accent-colored (`var(--color-accent)`) clickable link with a trailing `→`.
- Clicking navigates to the parent row (the `N:1` direction): drill into the
  referenced table filtered to PK = this value.

## 3. Branching breadcrumb (the signature)
- The breadcrumb is a TREE, not a linear path: from one node you can follow
  multiple relations, creating branches (the screenshot shows `customers`
  branching into both `reviews › products #142 › inventory_log` AND
  `orders › shipments`).
- Each node is a removable chip (`×`); the active node is accent-colored; a
  node pinned to a specific record shows `#142`. Back/forward arrows navigate
  history; clicking a chip makes it active (and shows that node's rows).
- Model: a tree of `{ id, table, schema, relation?, recordKey?, children[] }`
  in the tabs store (extend the current linear `DrilldownCrumb[]`). Active path
  = highlighted; siblings collapsible with a count pill (changelog v0.2.7).
- Each drilldown step = a pre-seeded filter condition (`fk = value` /
  `pk = value`) — reuse `lib/filters.ts` so the linked FilterBar shows the join
  filter (changelog v0.5.9: collapsed M2M join filter appears in the filter bar).

## 4. Semantic-type column-header icons
- Header shows an icon by semantic type: 🔑 PK, `T` text, `#`/number, `{}` json,
  bool, date/timestamp, `🔗` FK (accent), `↗` relation, image, url, email, uuid.
- Derive from `describe_table` (column type + pk/fk flags) → a `semanticType()`
  helper; render a small Lucide icon + the name in the Glide header (custom
  header renderer) and in the detail panel.

## 5. Schema-graph depth-from-focus (separate, smaller)
- Default the graph to depth 1 from a focused/pinned table instead of dumping
  all 262 tables; expand neighbors on demand. `get_schema_graph` should take a
  `rootTable` + `depth` (changelog v0.2.7 / v0.3.1).

Order to build: §1 + §2 (inline counts + FK links) → §4 (header icons, cheap,
high impact) → §3 (branching breadcrumb) → §5 (graph depth).
