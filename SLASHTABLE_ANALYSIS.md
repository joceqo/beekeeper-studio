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
