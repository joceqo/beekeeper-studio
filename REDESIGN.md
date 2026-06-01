# Beekeeper Studio — visual redesign toward SlashTable

Goal: make this fork look (and eventually work) like [SlashTable](https://slashtable.dev).

**SlashTable's stack** (reverse-engineered from its bundle):
React + Tailwind CSS v4 + Glide Data Grid (canvas, React-only) + Monaco +
Radix UI + Shiki + Lucide, Inter Variable / JetBrains Mono Variable fonts,
**burnt-orange accent** over a warm-neutral palette.

**Beekeeper's stack today:** Vue 2.7 (studio + ui-kit), Tabulator grid,
CodeMirror 5, SCSS themes. The DB engine + MCP server live in the Electron
main/utility process and are **framework-agnostic** (reused by any frontend).

Three routes, in priority order:

| Phase | Effort | Result | Status |
|-------|--------|--------|--------|
| **A — SCSS reskin + new components (Vue 2)** | 🟢 low–med | The SlashTable *look* + the missing chrome (activity panel, collapsible docks); keeps SCSS/Tabulator/CodeMirror | **do this first — prompt below** |
| **B — Migrate to Vue 3** | 🟡 med–large | Modern Vue + Reka UI; still no Glide | prompt below |
| **C — React renderer rewrite** | 🔴 large | SlashTable's exact stack (Glide + Radix + Tailwind), keeps backend + MCP | prompt below |

Design capture (tokens, screenshots, fonts) is local at
`~/Desktop/records/SlashTable/` — `css/design-tokens.json` has the full palette.

---

## Target layout (what we're building, all phases)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ●●●   [ public.users × ][ public.graph × ][ + ]            ⌗ theme   ⚙       │  title + tab strip
├──────────────┬────────────────────────────────────────────────────────────┤
│ ◧ SIDEBAR    │  MAIN CONTENT                                                │
│  CONNECTIONS │    (data grid · query editor · schema graph = current tab)   │
│   ▾ mlc  PRD │                                                              │
│   ▸ CLICKY   │                                                              │
│  TABLES   ⌕  │                                                              │
│   users      │                                                              │
│   campaigns  │                                                              │
│   reports …  │                                                              │
├──────────────┴────────────────────────────────────────────────────────────┤
│ ⌄ ACTIVITY                                          (drag ↕ resize · ⌄ hide)│  NEW bottom dock
│ [SQL][App][MCP ①][User][System][Connections]                    [🗑 Clear] │
│ Time         Ctg   Op      Connection  Tables           SQL          Dur Rows│
│ 20:42:05.445 User  SELECT  mlc         public.users     SELECT "u…   1.7s  7 │
│ 20:42:05.481 User  SELECT  mlc         public.campaigns SELECT "u…   1.7s 15 │
│ …                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│ Free — Personal Use            1.86s · 100 loaded / ~299 total       v5.8.0 │  status bar
└───────────────────────────────────────────────────────────────────────────┘
```

Sidebar collapsed (toggle) and activity panel collapsed:

```
┌──┬─────────────────────────────────────────...     │ ⌃ ACTIVITY  [SQL][App][MCP ①][User]… [🗑] │
│▸ │  MAIN (full width)                               (one-line header only; click ⌃ to expand)
│⛁ │
│⌕ │
└──┴─────────────────────────────────────────...
```

---

## Phase A — SCSS reskin + new components (paste-ready prompt)

> Make this Beekeeper Studio fork look like SlashTable, **in Vue 2 + SCSS** (no
> framework change, keep the existing theme system). Two parts: (1) reskin the
> palette/fonts; (2) build the chrome SlashTable has that Beekeeper lacks — a
> bottom **Activity panel** and collapsible docks. All new components are plain
> Vue 2 SFCs.
>
> ### PART 1 — Palette & fonts (SCSS)
>
> Theme colors are SCSS variables in
> `apps/studio/src/assets/styles/themes/dark/variables.scss` and
> `.../themes/light/variables.scss`, surfaced as CSS custom properties by
> `.../themes/scssvars-to-cssprops.scss`. Editing the variables cascades app-wide
> — do **not** edit component templates for colors. Base font is `$font-family`
> in `apps/studio/src/assets/styles/app/_variables.scss:87`.
>
> **Dark** (`themes/dark/variables.scss`) — left = current, right = new:
> ```
> $theme-bg:        #181818 -> #1e1e1e
> $theme-base:      #fff     -> #e8e4dc   ; warm off-white (drives text + border alphas)
> $theme-primary:   #fad83b  -> #d95200   ; ACCENT — burnt orange (signature change)
> $theme-secondary: #4ad0ff  -> #5a9ebf
> $brand-success:   #15db95  -> #5da050
> $brand-warning:   #ff8d21  -> #d98a35
> $brand-danger:    #ff5d59  -> #d94040
> $sidebar-bg:      (relative) -> #262626   ; set explicit
> $border-color:    (rgba)     -> #43433f   ; set explicit (warm)
> ```
> **Light** (`themes/light/variables.scss`):
> ```
> $theme-bg:        #f8f8f8 -> #f4f2ed
> $theme-base:      black    -> #2a2926
> $theme-primary:   (yellow) -> #b84200
> $theme-secondary: #0099ff  -> #4a8aaa
> $brand-success:   #15db95  -> #4a8a40
> $brand-warning:   #dc700c  -> #c07a25
> $brand-danger:    #ff5d59  -> #ce4343
> $sidebar-bg:      (relative) -> #ecebe7
> $border-color:    (rgba)     -> #d4d0ca
> ```
> **Fonts:** add `@fontsource/inter` + `@fontsource/jetbrains-mono` to
> `apps/studio/package.json`, import once in the renderer entry, set
> `$font-family` (line 87) to start with `"Inter Variable", "Inter", …` (keep
> system fallbacks), and set the editor/result monospace font to
> `"JetBrains Mono Variable", "JetBrains Mono", monospace`.
> **Accent check:** primary buttons, active tab underline, text selection
> (`$selection`), focus rings, the connection "Save" button must read burnt
> orange, not yellow.
>
> ### PART 2 — New components (Vue 2 SFCs)
>
> Main layout is `apps/studio/src/components/CoreInterface.vue` (tabs =
> `CoreTabs.vue`, status bar = `GlobalStatusBar.vue`, sidebar = `components/sidebar/`).
> Layout flex rules are in `apps/studio/src/assets/styles/app/_layout.scss`
> (column: tab strip → row[sidebar|content] → **activity dock** → status bar).
> There is no event bus library; the app uses `this.$root.$emit/$on` (see
> `apps/studio/src/common/AppEvent.ts`). Vuex modules live in
> `apps/studio/src/store/modules/` (`SidebarModule` already exists).
>
> **A. Activity panel (the big one).** A collapsible, resizable dock at the
> bottom of `CoreInterface`, above `GlobalStatusBar`. SlashTable reference:
> ```
> ┌─────────────────────────────────────────────────────────────────────────┐
> │ [SQL] [App] [MCP ①] [User] [System] [Connections]              [🗑 Clear] │  ← category tabs (active = orange underline); badge = unseen count
> ├─────────────────────────────────────────────────────────────────────────┤
> │ Time          Ctg   Op      Connection  Tables          SQL       Dur Rows│  ← column header
> │ 20:42:05.445  User  SELECT  mlc         public.users    SELECT…   1.7s  7 │  ← row; SQL truncated, click to expand
> │ 20:42:05.481  User  SELECT  mlc         public.campaigns SELECT…  1.7s 15 │
> └─────────────────────────────────────────────────────────────────────────┘
> ```
> Create:
> - `components/activity/ActivityPanel.vue` — dock container. A top drag handle
>   to resize height; a collapse caret (⌄/⌃) that shrinks it to just the
>   header row; persist height + collapsed state in settings/Vuex. When
>   collapsed, only the tab bar + Clear show.
> - `components/activity/ActivityTabBar.vue` — category tabs
>   (SQL · App · MCP · User · System · Connections) with per-tab unseen-count
>   badges; active tab uses the orange accent. A `Clear` button on the right.
> - `components/activity/ActivityLogTable.vue` — virtualized rows (reuse the
>   `vue-virtual-scroll-list` dep already in the project). Columns: Time, Ctg
>   (colored badge), Op (SELECT/INSERT/…), Connection, Tables, SQL (monospace,
>   truncated with expand), Duration, Rows. Monospace = JetBrains Mono.
> - Vuex module `store/modules/ActivityModule.ts` — a capped ring buffer
>   (~1000 entries) of `{ id, time, category, op, connection, tables, sql,
>   durationMs, rows }`, getters filtered by category, `clear()`, and
>   unseen-count per category.
> - **Feed it:** the cleanest injection point is the renderer↔backend seam
>   `apps/studio/src/lib/utility/ElectronUtilityConnectionClient.ts` (all
>   `$util.send` calls funnel here). On `query`/`executeQuery`/`selectTop`,
>   push an Activity entry (category `User`/`SQL`) with the SQL, target
>   table(s), elapsed ms and row count. For the **MCP** tab: the MCP server in
>   `apps/studio/src/backend/mcp/server.ts` already logs every tool call —
>   forward those to the renderer over the existing `MessagePort` (post a
>   `mcp/activity` message from the utility process; handle it in the renderer
>   and push to `ActivityModule`). If MCP wiring is too much for a first pass,
>   ship SQL/User now and leave MCP/App/System tabs stubbed.
>
> **B. Collapsible sidebar.** Add a toggle (button in the tab strip or a
> chevron at the sidebar edge) + a keyboard shortcut to collapse/expand the left
> sidebar; persist via the existing `SidebarModule`. Collapsed = a thin rail
> with icons only (connections / tables / search).
> ```
>  expanded            collapsed
> ┌──────────────┐    ┌──┐
> │ CONNECTIONS  │    │▸ │   ← click to expand
> │  ▾ mlc  PRD  │    │⛁ │   ← tables icon
> │ TABLES    ⌕  │    │⌕ │   ← search icon
> │  users …     │    └──┘
> └──────────────┘
> ```
>
> **C. Status bar polish.** `GlobalStatusBar.vue` — show the active result
> summary like SlashTable: `1.86s · 100 loaded / ~299 total` on the right, plus
> the app version. Reads from the active tab's last query result.
>
> ### Verify
> - `cd apps/studio && yarn electron:serve`; compare dark + light to
>   `~/Desktop/records/SlashTable/screenshots/`.
> - Run several queries → rows appear live in the Activity panel (User/SQL tab)
>   with correct Time/Connection/Tables/SQL/Duration/Rows; Clear empties it;
>   collapse/resize persists across restart.
> - Toggle the sidebar; state persists.
> - No SCSS build errors; `yarn lint` clean. `npx tsc --noEmit` adds 0 errors
>   over the pre-existing baseline.
>
> ### Notes
> - Highest-impact color change: accent yellow → burnt orange, and warming
>   `$theme-base` (the rest cascades).
> - Keep the Activity panel framework-light so it survives a later Vue 3 / React
>   migration — model the entry shape after the MCP server's tool-call log.
> - This phase closes no doors; B and C build on a repo that already looks right.

---

## Phase B — Migrate to Vue 3

### Goal & honest framing
Upgrade both `apps/ui-kit` and `apps/studio` from **Vue 2.7.16 → Vue 3** using the official `@vue/compat` migration build, then drop compat. This modernizes the renderer and unlocks **Reka UI** (the Vue port of Radix primitives) so the chrome can match SlashTable (burnt-orange `#d95200`/`#b84200`, Inter / JetBrains Mono, Tailwind v4).

**Explicit limitation — read first:** Vue 3 does **NOT** unlock Glide Data Grid. `@glideapps/glide-data-grid` is **React-only**. After Phase B the grid **stays Tabulator** (`apps/ui-kit/lib/components/table/Table.vue`, the `beekeeper-studio/tabulator` fork) or you embed an awkward React island. So Phase B is a **partial SlashTable match**: same fonts/colors/primitives/Tailwind, but the defining canvas grid is not achievable cleanly. Full parity = Phase C.

### What does NOT change (framework-agnostic backend)
Nothing in the Electron main/utility process is touched:
- 15+ DB clients in `apps/studio/src/lib/db/clients/` (`BasicDatabaseClient.ts` + `postgresql.ts`, `mysql.ts`, `sqlite.ts`, `sqlserver.ts`, `bigquery.ts`, `redis.ts`, `redshift.ts`, `cockroach.ts`, `mariadb.ts`, `bedrock.ts`, `base/`).
- Handlers: `apps/studio/src-commercial/backend/handlers/connHandlers.ts` (~670 lines) + export/import/backup/enum/aws/plugin handlers; OSS handlers in `apps/studio/src/handlers/`. IPC contract = `Handlers` interface in `handlers.ts`.
- MCP server `apps/studio/src/backend/mcp/{server,tools,sqlGuard}.ts`; appdb (TypeORM `SavedConnection`); SSH tunnels; entrypoints `apps/studio/src-commercial/entrypoints/{main,preload,utility}.ts`.
- Seam: `Vue.prototype.$util.send('conn/<method>', args)` over a `MessagePort`; client wrapper `apps/studio/src/lib/utility/ElectronUtilityConnectionClient.ts` (345 lines). **233 `$util.send` call-sites**.

### Sizing
- **`apps/studio`**: 198 `.vue` SFCs (`Vue.extend({...})` in 109, plain Options in 88). **No class components, no vue-router** (navigation is Vuex `TabModule` + dynamic `<component :is>` in `CoreTabs.vue`/`CoreInterface.vue`).
- **`apps/ui-kit`**: 20 SFCs, consumed by studio in 11 files.
- **Vuex**: 37 store files (root `store/index.ts` + ~14 modules).

### Vue-2 blockers to resolve
1. `vue-template-compiler` → `@vue/compiler-sfc`; `@vitejs/plugin-vue2` → `@vitejs/plugin-vue`; `@vue/vue2-jest` → `@vue/vue3-jest`; eslint Vue-3 ruleset.
2. `Vue.extend(...)` (109 SFCs) → `defineComponent`.
3. **Filters** (46 SFCs) — removed in Vue 3 → methods/computed.
4. **Event bus** `$root.$emit/$on` (44 SFCs + `AppEventHandler`) → `mitt` or a Pinia store (`$on/$off/$once` removed).
5. `mixins:` (15 SFCs) → keep, prefer composables later.
6. Pinned Vue-2 libs: `portal-vue` (44 SFCs) → `<Teleport>`; `vue-js-modal` → `vue-final-modal` v4 / Reka Dialog; `vue-select` → reka-ui; `vue2-datepicker` → `@vuepic/vue-datepicker`; `vuedraggable@2` → `@4`; `vue-clipboard2` → `@vueuse useClipboard`; `vue-virtual-scroll-list@2` → v3; `@vue/web-component-wrapper` (ui-kit) → `defineCustomElement`.
7. Vuex 3 → Vuex 4 (or Pinia, recommended end-state).
8. `Vue.prototype.$util/$store` → `app.config.globalProperties` + provide/inject.

Eases it: Vue 2.7 already ships the Composition API.

### Ordered phases
- **B0 — Prep (no version bump):** add `mitt` bus alongside `$root`; codemod filters→methods; wrap `portal-vue`; add `defineComponent` imports. Verify app still runs on Vue 2.
- **B1 — ui-kit on Vue 3 first (leaf, 20 SFCs, no Vuex):** switch to `@vitejs/plugin-vue` + Vue 3 + `defineCustomElement`; keep `@beekeeperstudio/ui-kit/vue/*` export surface stable. Verify ui-kit dev harness.
- **B2 — studio under `@vue/compat` (MODE 2):** Vuex 4, `new Vue()`→`createApp`, re-wire `$util`/`MessagePort`. Verify connect + open table + run query.
- **B3 — burn down compat warnings** → remove `@vue/compat`.
- **B4 — state + libs final:** Vuex→Pinia module-by-module (optional); finish dep replacements; mixins→composables opportunistically.
- **B5 — SlashTable chrome:** Tailwind v4, Inter/JetBrains Mono, Lucide (`lucide-vue-next`), Reka UI; burnt-orange into the theme vars. Grid stays Tabulator.

### First PR — `phase-b/ui-kit-vue3`
Migrate **only `apps/ui-kit`** (B1): swap build plugin + Vue 3, convert 20 SFCs `Vue.extend`→`defineComponent`, `vue2-teleport`→`<Teleport>`, `@vue/web-component-wrapper`→`defineCustomElement`, identical export paths. Don't touch studio yet.

### Effort & risk
**Medium-High (~4–8 weeks).** Mechanical (no class components/router). Risk medium — top items: 44 event-bus SFCs, 46 filter SFCs, 44 portal-vue SFCs, re-wiring `MessagePort`/`$util` onto `createApp`. Backend untouched = low blast radius. **Verify each phase:** connect Postgres+SQLite+MySQL, open/edit a table (Tabulator), run a query, reopen a saved connection, confirm MCP still answers; run jest suites.

### Bottom line
Lower-risk modernization that delivers SlashTable's *chrome* + a maintainable frontend, but **cannot deliver the Glide canvas grid** — that gates true parity and requires React (Phase C).

---

## Phase C — Rewrite renderer in React

### Goal
Replace the Vue renderer entirely with **React + Vite**, reusing the **whole Electron backend unchanged**, rebuilding the UI in **SlashTable's exact stack**: React + Tailwind v4 + `@glideapps/glide-data-grid` (replaces Tabulator) + Monaco (replaces CodeMirror 5) + Radix UI + Shiki + Lucide + Inter/JetBrains Mono, burnt-orange accent. The **only path to true SlashTable parity** (Glide is React-only).

### The seam — reused vs rewritten
**Reused 100% (the hard, framework-agnostic work — do not touch):**
- All DB clients in `apps/studio/src/lib/db/clients/` (15+ engines; `BasicDatabaseClient.ts` ~32 KB, `postgresql.ts` ~63 KB, `sqlserver.ts` ~51 KB, `mysql.ts` ~47 KB).
- Backend handlers `apps/studio/src-commercial/backend/handlers/*` + `apps/studio/src/handlers/*`, aggregated by `Handlers` in `handlers.ts`.
- MCP server `apps/studio/src/backend/mcp/{server,tools,sqlGuard}.ts`; appdb/TypeORM; SSH tunnels.
- Electron `main`/`preload`/`utility` (`apps/studio/src-commercial/entrypoints/`); the `utility` process owns the DB connection and talks to the renderer over a `MessagePort`. esbuild build (`esbuild.mjs`) unchanged.

**Rewritten:** only `renderer.ts` + the 198 studio SFCs + 37 Vuex files + 20 ui-kit SFCs. Vite repointed `@vitejs/plugin-vue2` → `@vitejs/plugin-react`.

### The IPC contract is the stable interface
Renderer talks to backend through one narrow typed seam: a `MessagePort`
(`renderer.ts`: `window.onmessage` → `$util.setPort(port, sId)`) and
`$util.send('<handlerName>', args)` → typed result. **233 call-sites**, all via
`apps/studio/src/lib/utility/ElectronUtilityConnectionClient.ts` (implements
`IBasicDatabaseClient`). **Action:** extract that client + the `Handlers` types
into a Vue-free shared module under `@shared`; the React renderer creates the
same client, wires the same `MessagePort`, exposes it via React context +
`useBackend()` / TanStack Query. **No backend changes.**

### Build the React app
- Entry `renderer.tsx`: `createRoot(...).render(<App/>)`, same port handshake.
- Routing: none today (tab state in `TabModule`) → Zustand store of open tabs + `<TabRouter>` switching on tab type.
- State: Vuex (37 files) → **Zustand**/Redux Toolkit; 14 modules → slices.
- Grid: `@glideapps/glide-data-grid` everywhere (centerpiece; model adapters off existing Tabulator column defs).
- Editor: **Monaco** replaces CodeMirror 5; Shiki for read-only highlight.
- Primitives: Radix UI (menus/dialogs/dropdowns), Lucide React, Tailwind v4 tokens (burnt-orange + Inter/JetBrains Mono) replacing the SCSS theme system.

### Ordered phases (by UI surface; backend untouched)
1. **C0 — seam + shell:** extract typed IPC client to `@shared`; React `renderer.tsx` + Vite React plugin; Tailwind v4 + tokens + fonts; Radix baseline. Verify: blank React window connects the port and calls `conn/versionString` on a live SQLite conn.
2. **C1 — connection screen** (`ConnectionInterface.vue` ~23 KB): create/save/open Postgres+SQLite+MySQL via existing handlers.
3. **C2 — sidebar / entity list** (`components/sidebar/*` + ui-kit `entity-list/*`): React virtual list; schemas/tables/pins/hidden.
4. **C3 — data grid (Glide):** biggest value — paging/sort/filter/inline-edit + save via `conn/*`. Verify: 1M-row table scrolls smoothly, edit a cell, commit.
5. **C4 — query editor (Monaco)** (`TabQueryEditor.vue` ~69 KB): run/cancel via `queryHandlers`, results in Glide, formatter.
6. **C5 — table view tabs** (`components/tableview/*`, `tableinfo/*`): structure/columns/indexes/triggers/relations; DDL via handlers.
7. **C6 — remaining:** shell/mongo, import/export/backup, plugins, settings, license, menus.

### First PR — `phase-c/seam-and-shell` (C0 + minimal C1)
(a) Extract `ElectronUtilityConnectionClient` + `Handlers`/`IBasicDatabaseClient` types to a Vue-free `@shared` module; (b) add a parallel React renderer entry + `@vitejs/plugin-react` in a second Vite config, **without** deleting the Vue renderer (run side-by-side behind an env flag); (c) Tailwind v4 + tokens + fonts; (d) one React screen that does the port handshake and lists tables via `conn/listTables` on SQLite. **Zero backend changes.** Proves the seam before committing to the full surface.

### Biggest risks (honest)
- **Huge surface:** 198 + 20 SFCs + 37 Vuex files, incl. `TabQueryEditor.vue` (69 KB), `CoreTabs.vue` (39 KB). Multi-month rewrite, **~3–6+ months** to parity.
- **GPL-3:** codebase is GPLv3 (`LICENSE.md`) + commercial EULA for `src-commercial`. A renderer rewrite is a derivative work — stays GPLv3, distribute source; honor the `src` vs `src-commercial` split. Copying SlashTable's *visual design* is fine; do not copy its proprietary code.
- **Parity drift:** Tabulator + CodeMirror have deep custom behavior (the BKS tabulator fork, SQL dialect completion). Reimplement on Glide+Monaco with per-surface acceptance checklists.
- **Preload bridge / MessagePort:** recreate the `setPort(port, sId)` handshake + reconnection faithfully in React; lock in C0.
- **Plugins + MCP:** `WebPluginManager` assumes a Vue host → needs a React host shim.

### Bottom line
Largest effort, **only path to true SlashTable parity** (Glide + Monaco + Radix + Tailwind), and it **preserves all the hard backend work** behind the narrow typed IPC seam. Treat that seam as the contract; rewrite only what's above it.
