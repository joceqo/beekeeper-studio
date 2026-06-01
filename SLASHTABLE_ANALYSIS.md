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
