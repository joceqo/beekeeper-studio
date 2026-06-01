# React ↔ Electron Backend IPC Contract

This document defines the **stable seam** (REDESIGN.md "Phase C — The IPC contract is
the stable interface", REDESIGN.md:264) between a future **React renderer** (built in
`studio-react/`) and Beekeeper Studio's **existing, unchanged Electron backend**.

The React frontend currently drives a **mock IPC client**. To run against the real app
it must implement the contract below. **No backend code changes are required** — the
contract is reverse-engineered from the live Vue renderer's seam.

All file references below are to the existing app under
`apps/studio/` and are given as `path:line`.

---

## 1. Transport

The renderer never talks to the database directly. A dedicated **Electron utility
process** owns every DB connection; the renderer and the utility process communicate
over a single **`MessagePort`** pair. The Electron **main** process brokers the
handshake; the **preload** script relays the port into the renderer's `window`.

### 1.1 Process topology

```
┌────────────┐   MessageChannelMain    ┌──────────────────┐
│  renderer  │◄───────port2 ── port1──►│  utility process │  (owns DB connection,
│  (React)   │      (MessagePort)      │  utility.ts      │   runs all handlers)
└────────────┘                         └──────────────────┘
       ▲                                        ▲
       │ window.postMessage('port')             │ utilityProcess.postMessage('init')
       │                                        │
┌────────────┐         ipcRenderer       ┌──────────────┐
│  preload   │◄──────── 'port' ─────────►│     main     │  (broker; creates the
│ preload.ts │                           │  main.ts     │   MessageChannel + sId)
└────────────┘                           └──────────────┘
```

### 1.2 Handshake — step by step (real code)

1. **Main creates the channel and the session id.**
   `main.ts:243-260` `createAndSendPorts()`:
   ```ts
   const { port1, port2 } = new electron.MessageChannelMain();
   const sId = uuidv4();                                  // main.ts:247
   utilityProcess.postMessage({ type: 'init', sId }, [port1]); // → utility  main.ts:250
   w.webContents.postMessage('port', { sId, utilDied }, [port2]); // → renderer main.ts:251
   ```
   `port1` goes to the utility process, `port2` goes to the renderer's web contents.
   The same `sId` (a UUID) is given to **both** ends — it is the shared session key.

2. **Utility process receives `port1` and builds per-session state.**
   `utility.ts:123-142` listens on `process.parentPort` for `{ type, sId }`:
   - `type: 'init'` with a port → `initState(sId, ports[0])` (`utility.ts:181-192`):
     calls `newState(sId)`, stores `state(sId).port = port`, attaches the message
     listener, and `port.start()`.
   - `type: 'init'` without a port → first-time process `init()` (ORM, plugins, MCP).
   - `type: 'close'` → `state(sId).port.close()` then `removeState(sId)` (`utility.ts:134-138`).

3. **Preload relays `port2` into the renderer's window.**
   `preload.ts:171-179` `attachPortListener()`:
   ```ts
   ipcRenderer.on('port', (event, { sId, utilDied }) => {
     window.postMessage({ type: 'port', sId }, '*', event.ports); // re-emits with the transferred port
     if (utilDied) ipcRenderer.emit('utilDied');
   });
   ```
   The renderer must have called `window.main.attachPortListener()` first
   (Vue does this at `renderer.ts:205`).

4. **Renderer receives the port via `window.onmessage`.**
   `renderer.ts:206-215`:
   ```ts
   window.onmessage = (event) => {
     if (event.source === window && event.data.type === 'port') {
       const [port] = event.ports;       // the transferred MessagePort
       const { sId } = event.data;
       Vue.prototype.$util.setPort(port, sId);  // hand port + sId to the client
       app.$store.dispatch('settings/initializeSettings');
     }
   };
   ```

5. **Renderer can request ports on demand** if the port isn't there yet.
   The client calls `window.main.requestPorts()` (preload `preload.ts:180-182`,
   `ipcRenderer.invoke('requestPorts')`), which triggers `main.ts:262-275`
   (`ipcMain.handle('requestPorts')`) to (re)create the utility process if dead and
   re-run `createAndSendPorts`. The Vue client does this lazily the first time
   `send()` is called before a port exists (`UtilityConnection.ts:97-100`).

### 1.3 Message framing

The renderer-side client and the utility process speak a tiny request/reply protocol
over the `MessagePort`.

**Request (renderer → utility)** — `UtilityConnection.ts:106`:
```ts
port.postMessage({ id, name, args });
```
- `id: string` — a fresh UUID per request (`uuidv4()`), used to correlate the reply.
- `name: string` — the handler name, e.g. `'conn/listTables'`.
- `args: object` — the handler arguments **with `sId` merged in**:
  `args = { sId, ...args }` (`UtilityConnection.ts:103`). Every request carries `sId`.

**Reply (utility → renderer)** — defined as `interface Reply` in `utility.ts:71-77`,
posted at `utility.ts:164`:
```ts
interface Reply {
  id: string;                  // echoes the request id
  type: 'reply' | 'error';
  data?: any;                  // present on success
  error?: string;              // present on failure (e.message ?? e)
  stack?: string;              // present on failure (e.stack)
}
```
The utility dispatches by `name` in `runHandler()` (`utility.ts:144-179`):
`handlers[name](args)` → on resolve sets `data`, on reject sets `type:'error'`,
`error`, `stack`. The reply is **always** posted back on `state(args.sId).port`.

**Reply handling (renderer)** — `UtilityConnection.ts:42-75` `port.onmessage`:
- `type === 'reply'` → look up `replyHandlers.get(id)`, `handler.resolve(data)`.
- `type === 'error'` → `handler.reject(new Error(error))` with `err.stack = stack`.
- otherwise → matched against registered **push listeners** (see §1.4).

### 1.4 Server-pushed events (no request id)

The utility process can post **unsolicited** messages that have a `type` but no
matching `replyHandler`. The Vue client routes these to listeners registered via
`addListener(type, listener)` / `removeListener(id)` (`UtilityConnection.ts:112-122`).
Known pushes (from `connHandlers.ts:649-661`, transaction auto-rollback):
- `{ type: 'transactionTimeoutWarning/<tabId>' }`
- `{ type: 'transactionTimedOut/<tabId>' }`

A push message shape is `{ type: string, input?: any }`; the listener is called with
`input` (`UtilityConnection.ts:70-71`). The React client must support this push
channel, not just request/reply.

### 1.5 Queueing before the port arrives

`send()` may be called before `setPort` runs. The Vue client queues such requests
(`UtilityConnection.ts:94-100`) and flushes them once the port arrives
(`UtilityConnection.ts:79-87`). The React client should replicate this so callers
never have to await the handshake.

---

## 2. Session model (`sId`)

- **`sId` is a per-window/per-connection UUID** minted by main (`main.ts:247`) and
  shared with both the utility process and the renderer. It is the key into the
  utility process's `states` map.

- **State map** — `handlerState.ts:53-58`:
  ```ts
  const states = new Map<string, State>();
  export function state(id: string): State { return states.get(id); }
  ```
  Every handler resolves its connection via `state(sId)` (e.g.
  `connHandlers.ts:276` `state(sId).connection.listTables(filter)`).

- **The `State` object** — `handlerState.ts:19-51` — holds everything tied to one
  session: `port`, `server` (`IDbConnectionPublicServer`), `usedConfig`
  (`IConnection`), `connection` (`BasicDatabaseClient`), `database`, a
  `queries: Map<string, CancelableQuery>`, `generator` (`SqlGenerator`), `exports`,
  `imports`, `backupProc`, `transactionTimeouts`, `tempFiles`, and `mcpAccess`.

- **Lifecycle helpers** — `handlerState.ts`: `newState(id)` (60-62) creates a state;
  `removeState(id)` (74-90) closes temp files and deletes the entry; `checkConnection(sId)`
  (108-112) throws `"No database connection found"` if `state(sId).connection` is null;
  `getDriverHandler(name)` (102-106) is the thin no-arg wrapper used for handlers like
  `conn/connect`, `conn/versionString`, `conn/supportedFeatures`.

- **Multiple connections coexist** because each gets a distinct `sId` and therefore a
  distinct `State`. A renderer window has exactly one `sId` from the handshake; opening
  additional connection windows mints additional `sId`s in main.

- **Shared with the MCP server (note).** The MCP server runs **in the same utility
  process** and uses the **same `states` map**. `apps/studio/src/backend/mcp/tools.ts`
  imports `allStates, newState, state` from `@/handlers/handlerState` (`tools.ts:5`),
  derives its own session ids via `mcpSessionId(savedConnectionId)` (e.g. `tools.ts:104`,
  `tools.ts:133-153`), calls `newState(sId)` for MCP-opened connections, and sets
  `state(sId).mcpAccess` (`tools.ts:153`). `list_connections` enumerates **all** live
  states via `allStates()` (`tools.ts:201`) including renderer-owned ones. Implication
  for the React client: the `sId` namespace is shared. The renderer must keep using the
  UUID handed to it by main and must not collide with or assume ownership of MCP-derived
  session ids. The React client touches only its own `sId`.

---

## 3. Handler catalogue

Handlers are aggregated into one object in `utility.ts:79-98` (`handlers = { ...ConnHandlers,
...QueryHandlers, ... }`) and typed by the `Handlers` interface (`handlers.ts:14-24`), which
extends `IConnectionHandlers`, `IQueryHandlers`, `IGeneratorHandlers`, `IImportHandlers`,
`IExportHandlers`, `IBackupHandlers`, `IFileHandlers`, `IEnumHandlers`, `ITempHandlers`,
`IAwsHandlers`.

Every `conn/*` handler signature includes `sId` (added automatically by the client).
The "Args" column below lists the **caller-supplied** fields; `sId` is implicit.
Source of truth: `IConnectionHandlers` in `connHandlers.ts:17-132` and the renderer
wrapper `ElectronUtilityConnectionClient.ts`.

### 3.1 Connection lifecycle

| Handler | Args | Returns | Purpose |
|---|---|---|---|
| `conn/create` | `{ config: IConnection, auth?: {input:string,mode:'pin'}, osUser: string }` | `void` | Build server + connect; populates `state(sId)`. `connHandlers.ts:135` |
| `conn/test` | `{ config: IConnection, osUser: string }` | `void` | Connect then immediately disconnect to validate. `connHandlers.ts:194` |
| `conn/connect` | `{}` | `void` | Connect using existing state. `connHandlers.ts:272` (`getDriverHandler`) |
| `conn/disconnect` | `{}` | `void` | Disconnect. `connHandlers.ts:273` |
| `conn/changeDatabase` | `{ newDatabase: string }` | `void` | Switch active DB within the server. `connHandlers.ts:229` |
| `conn/clearConnection` | `{}` | `void` | Null out connection/server/config/generator. `connHandlers.ts:249` |
| `conn/getServerConfig` | `{}` | `IDbConnectionServerConfig` | Return the live server config. `connHandlers.ts:256` |
| `conn/reserveConnection` | `{ tabId: number }` | `void` | Pin a pooled connection to a tab. `connHandlers.ts:599` |
| `conn/releaseConnection` | `{ tabId: number }` | `void` | Release the tab's pooled connection. `connHandlers.ts:604` |
| `conn/startTransaction` | `{ tabId: number }` | `void` | Begin a manual transaction (+ timeout). `connHandlers.ts:609` |
| `conn/commitTransaction` | `{ tabId: number }` | `void` | Commit + clear timeout. `connHandlers.ts:615` |
| `conn/rollbackTransaction` | `{ tabId: number }` | `void` | Rollback + clear timeout. `connHandlers.ts:621` |
| `conn/resetTransactionTimeout` | `{ tabId: number }` | `void` | Reset the auto-rollback timer. `connHandlers.ts:627` |
| `conn/syncDatabase` | `{}` | `void` | Driver sync (e.g. SurrealDB). `connHandlers.ts:563` |
| `conn/azureCancelAuth` | `{}` | `void` | Abort an in-flight Azure auth. `connHandlers.ts:565` |
| `conn/azureGetAccountName` | `{ authId: number }` | `string \| null` | Signed-in Azure account name. `connHandlers.ts:569` |
| `conn/azureSignOut` | `{ config: IConnection }` | `void` | SSO sign-out + clear authId. `connHandlers.ts:578` |

### 3.2 DB metadata / capabilities

| Handler | Args | Returns | Purpose |
|---|---|---|---|
| `conn/supportedFeatures` | `{}` | `SupportedFeatures` | Capability flags the UI gates on. `connHandlers.ts:261` |
| `conn/versionString` | `{}` | `string` | DB version string (the C0 smoke test). `connHandlers.ts:262` |
| `conn/defaultSchema` | `{}` | `string \| null` | Default schema name. `connHandlers.ts:263` |
| `conn/listCharsets` | `{}` | `string[]` | Available charsets. `connHandlers.ts:264` |
| `conn/getDefaultCharset` | `{}` | `string` | Default charset. `connHandlers.ts:265` |
| `conn/listCollations` | `{ charset: string }` | `string[]` | Collations for a charset. `connHandlers.ts:267` |

### 3.3 Schema introspection (read path — exhaustive)

| Handler | Args | Returns | Purpose |
|---|---|---|---|
| `conn/listDatabases` | `{ filter?: DatabaseFilterOptions }` | `string[]` | List databases. `connHandlers.ts:374` |
| `conn/listSchemas` | `{ filter?: SchemaFilterOptions }` | `string[]` | List schemas. `connHandlers.ts:310` |
| `conn/listTables` | `{ filter?: FilterOptions }` | `TableOrView[]` | List tables. `connHandlers.ts:275` |
| `conn/listViews` | `{ filter?: FilterOptions }` | `TableOrView[]` | List views. `connHandlers.ts:280` |
| `conn/listMaterializedViews` | `{ filter?: FilterOptions }` | `TableOrView[]` | List materialized views. `connHandlers.ts:389` |
| `conn/listRoutines` | `{ filter?: FilterOptions }` | `Routine[]` | List procedures/functions. `connHandlers.ts:285` |
| `conn/listTableColumns` | `{ table: string, schema?: string }` | `ExtendedTableColumn[]` | Columns of a table. `connHandlers.ts:295` |
| `conn/listMaterializedViewColumns` | `{ table: string, schema?: string }` | `TableColumn[]` | Columns of a mat. view. `connHandlers.ts:290` |
| `conn/listTableTriggers` | `{ table: string, schema?: string }` | `TableTrigger[]` | Triggers on a table. `connHandlers.ts:300` |
| `conn/listTableIndexes` | `{ table: string, schema?: string }` | `TableIndex[]` | Indexes on a table. `connHandlers.ts:305` |
| `conn/listTablePartitions` | `{ table: string, schema?: string }` | `TablePartition[]` | Partitions of a table. `connHandlers.ts:335` |
| `conn/getTableReferences` | `{ table: string, schema?: string }` | `string[]` | Tables this table references. `connHandlers.ts:315` |
| `conn/getTableKeys` | `{ table: string, schema?: string }` | `TableKey[]` | FK/relations of a table. `connHandlers.ts:320` |
| `conn/getIncomingKeys` | `{ table: string, schema?: string }` | `TableKey[]` | Inbound FKs. `connHandlers.ts:325` |
| `conn/getOutgoingKeys` | `{ table: string, schema?: string }` | `TableKey[]` | Outbound FKs. `connHandlers.ts:330` |
| `conn/getPrimaryKey` | `{ table: string, schema?: string }` | `string \| null` | Single PK column name. `connHandlers.ts:394` |
| `conn/getPrimaryKeys` | `{ table: string, schema?: string }` | `PrimaryKeyColumn[]` | Composite PK columns. `connHandlers.ts:399` |
| `conn/getTableProperties` | `{ table: string, schema?: string }` | `TableProperties \| null` | Size/rows/owner/etc. `connHandlers.ts:379` |
| `conn/getTableLength` | `{ table: string, schema?: string }` | `number` | Row count. `connHandlers.ts:524` |
| `conn/getCollectionValidation` | `{ collection: string }` | `any` | Mongo collection validation. `connHandlers.ts:439` |
| `conn/getTableCreateScript` | `{ table: string, schema?: string }` | `string` | `CREATE TABLE` DDL. `connHandlers.ts:414` |
| `conn/getViewCreateScript` | `{ view: string, schema?: string }` | `string[]` | `CREATE VIEW` DDL. `connHandlers.ts:419` |
| `conn/getMaterializedViewCreateScript` | `{ view: string, schema?: string }` | `string[]` | Mat. view DDL. `connHandlers.ts:424` |
| `conn/getRoutineCreateScript` | `{ routine: string, type: string, schema?: string }` | `string[]` | Routine DDL. `connHandlers.ts:429` |

### 3.4 Data read (grid / query — exhaustive)

| Handler | Args | Returns | Purpose |
|---|---|---|---|
| `conn/selectTop` | `{ table, offset, limit, orderBy: OrderBy[], filters: string\|TableFilter[], schema?, selects? }` | `TableResult` | Paged table read (the grid's core). `connHandlers.ts:529` |
| `conn/selectTopSql` | same as above (no `selects` required) | `string` | The SQL that `selectTop` would run. `connHandlers.ts:534` |
| `conn/selectTopStream` | `{ table, orderBy, filters, chunkSize, schema? }` | `StreamResults` | Streamed read for export. `connHandlers.ts:539` |
| `conn/queryStream` | `{ query: string, chunkSize: number }` | `StreamResults` | Streamed read of an arbitrary query. `connHandlers.ts:544` |
| `conn/getQuerySelectTop` | `{ table, limit, schema? }` | `string` | Default `SELECT … LIMIT` text for an editor tab. `connHandlers.ts:384` |
| `conn/getQueryForFilter` | `{ filter: TableFilter }` | `string` | SQL for a single filter. `connHandlers.ts:590` |
| `conn/getFilteredDataCount` | `{ table, schema: string\|null, filter: string }` | `string` | Count of rows matching a filter. `connHandlers.ts:595` |
| `conn/getResultEditData` | `{ queryText: string, fields: FieldDescriptor[] }` | `FieldEditData[]` | Edit metadata for a result set. `connHandlers.ts:354` |
| `conn/getInsertQuery` | `{ tableInsert: TableInsert, runAsUpsert?: boolean }` | `string` | Generated `INSERT` SQL. `connHandlers.ts:559` |

### 3.5 Query execution

`conn/query` registers a query and returns a **query id (string)**; the renderer then
drives it through the `query/*` handlers (`queryHandlers.ts:7-10`). The Vue client wraps
this into a `CancelableQuery` object (`ElectronUtilityConnectionClient.ts:90-103`).

| Handler | Args | Returns | Purpose |
|---|---|---|---|
| `conn/query` | `{ queryText: string, options?: any, tabId: number, hasActiveTransaction: boolean }` | `string` (queryId) | Prepare a cancelable query; stores it in `state(sId).queries`. `connHandlers.ts:345` |
| `query/execute` | `{ queryId: string, isManualCommit?: boolean }` | `QueryResult` (NgQueryResult[], truncated to `maxResults`) | Run a prepared query; deletes it after. `queryHandlers.ts:13` |
| `query/cancel` | `{ queryId: string }` | `void` | Cancel a prepared query. `queryHandlers.ts:33` |
| `conn/executeQuery` | `{ queryText: string, options?: any }` | `NgQueryResult[]` | One-shot execute (no cancel handle). `connHandlers.ts:369` |
| `conn/executeCommand` | `{ commandText: string }` | `NgQueryResult[]` | Run a non-query command (shell/Mongo). `connHandlers.ts:340` |
| `conn/getCompletions` | `{ cmd: string }` | `string[]` | Autocomplete suggestions (shell). `connHandlers.ts:359` |
| `conn/getShellPrompt` | `{}` | `string` | Current shell prompt. `connHandlers.ts:364` |
| `generator/build` | `{ schema: Schema }` | `string` | Build SQL from a schema spec (SqlGenerator). `generatorHandlers.ts` |

### 3.6 Table CRUD / DDL (write path — summarized)

These follow a uniform shape: each `*Sql` variant **returns the SQL string** without
executing; the bare variant **executes**. All take `sId` + the change spec. Source:
`connHandlers.ts:404-557`.

- **Create:** `conn/createDatabase` `{databaseName,charset,collation}→string`,
  `conn/createDatabaseSQL` `{}→string`, `conn/createTable` `{table: CreateTableSpec}→void`,
  `conn/setCollectionValidation` `{params}→void`.
- **Alter (paired sql/exec):** `conn/alterTableSql`/`conn/alterTable` `{change: AlterTableSpec}`,
  `conn/alterIndexSql`/`conn/alterIndex` `{changes: IndexAlterations}`,
  `conn/alterRelationSql`/`conn/alterRelation` `{changes: RelationAlterations}`,
  `conn/alterPartitionSql`/`conn/alterPartition` `{changes: AlterPartitionsSpec}`.
- **Apply grid edits (paired):** `conn/applyChangesSql` `{changes: TableChanges}→string`,
  `conn/applyChanges` `{changes: TableChanges, tabId?}→TableUpdateResult[]`.
- **Rename / drop / truncate:** `conn/setTableDescription` `{table,description,schema?}→string`,
  `conn/setElementName` `{elementName,newElementName,typeOfElement: DatabaseElement,schema?}→void`,
  `conn/dropElement` `{elementName,typeOfElement,schema?}→void`,
  `conn/truncateElement` `{elementName,typeOfElement,schema?}→void`,
  `conn/truncateAllTables` `{schema?}→void`.
- **Duplicate (paired):** `conn/duplicateTableSql`/`conn/duplicateTable`
  `{tableName,duplicateTableName,schema?}`.

> Note: `import*` methods exist on `IBasicDatabaseClient` but the renderer-side client
> throws `"Do not use on front end"` for them (`ElectronUtilityConnectionClient.ts:295-321`);
> imports are driven by `IImportHandlers` server-side. Likewise `getServerStatistics` is
> `not implemented` on the renderer client (`ElectronUtilityConnectionClient.ts:352`).

### 3.7 Other handler groups (non-`conn/`, by need)

These are aggregated into `Handlers` too (`utility.ts:79-98`); the React client reaches
them through the same `send(name, args)`. First phases need at least:

| Group | Interface / file | Representative handlers |
|---|---|---|
| Query | `IQueryHandlers` — `queryHandlers.ts` | `query/execute`, `query/cancel` |
| Generator | `IGeneratorHandlers` — `generatorHandlers.ts` | `generator/build` |
| AppDB (TypeORM) | `appDbHandlers.ts` | `appdb/save`, `appdb/find`, `appdb/findOne`, `appdb/handleEntityList`, plus url/settings/token helpers — backs saved connections, open tabs, settings, pins. |
| File | `IFileHandlers` — `fileHandlers.ts` | `config/readVimrc` `()→string\|null`, `file/readSqlFile` `{path}→string` |
| Temp | `ITempHandlers` — `tempHandlers.ts` | `temp/create` `{}→{id,name}`, `temp/open` `{id}`, `temp/write` `{id,content}`, `temp/delete` `{id}` |
| Tab history | `tabHistoryHandlers.ts` | tab history persistence |
| Enum / Export / Import / Backup / Aws | commercial `*Handlers.ts` | enum metadata, export/import jobs, backups (later phases) |
| Plugin / License / DriverDep / Lock / Formatter | various | `PluginHandlers(...)`, `LicenseHandlers`, `DriverDepHandlers(...)`, `LockHandlers`, `FormatterPresetHandlers` |

Type imports needed: `IConnection` (`@/common/interfaces/IConnection`), the db models
(`@/lib/db/models` — `SupportedFeatures`, `TableOrView`, `ExtendedTableColumn`,
`TableResult`, `NgQueryResult`, `TableChanges`, `OrderBy`, `TableFilter`,
`StreamResults`, `FieldDescriptor`, `FieldEditData`, `TableInsert`, `Routine`,
`TableIndex`, `TableTrigger`, `TablePartition`, `TableProperties`, `PrimaryKeyColumn`,
`TableUpdateResult`, `CancelableQuery`, …), the dialect specs (`@shared/lib/dialects/models`
— `CreateTableSpec`, `AlterTableSpec`, `IndexAlterations`, `RelationAlterations`,
`AlterPartitionsSpec`, `TableKey`, `Schema`), and `DatabaseElement`/`IDbConnectionServerConfig`
(`@/lib/db/types`). Per REDESIGN.md:269, the plan is to extract these types into a
Vue-free `@shared` module so the React client can import them directly.

---

## 4. Proposed React-side client interface

Framework-free. Two layers: a transport core (`createBackendTransport`) that owns the
`MessagePort` and the request/reply protocol, and a typed `BackendClient` facade that
mirrors `ElectronUtilityConnectionClient` minus Vue. `sId` is injected by the transport,
never passed by callers — exactly as `UtilityConnection.send` does it
(`UtilityConnection.ts:103`).

```ts
// ─── transport core (replaces UtilityConnection, no Vue) ───────────────────
export interface BackendTransport {
  /** Hand the MessagePort + session id from the handshake (see §1.2 step 4). */
  setPort(port: MessagePort, sId: string): void;
  /** Current session id, or undefined before the handshake. */
  readonly sId: string | undefined;
  /**
   * Send a request and resolve with the typed reply data.
   * Merges { sId } into args automatically. Queues if the port isn't set yet
   * (and lazily calls window.main.requestPorts()), flushing on setPort.
   */
  send<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Subscribe to server pushes (e.g. 'transactionTimedOut/<tabId>'). Returns an id. */
  addListener(type: string, listener: (input: any) => void): string;
  removeListener(id: string): void;
}

// Wire framing (must match utility.ts exactly):
//   request : port.postMessage({ id: uuid, name, args: { sId, ...args } })
//   reply   : { id, type: 'reply', data } | { id, type: 'error', error, stack }
//   push    : { type: string, input?: any }   (no id)

// ─── typed facade (replaces ElectronUtilityConnectionClient, no Vue) ───────
export interface BackendClient {
  // capabilities / metadata
  supportedFeatures(): Promise<SupportedFeatures>;
  versionString(): Promise<string>;
  defaultSchema(): Promise<string | null>;
  listCharsets(): Promise<string[]>;
  getDefaultCharset(): Promise<string>;
  listCollations(charset: string): Promise<string[]>;

  // connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  changeDatabase(newDatabase: string): Promise<void>;
  getServerConfig(): Promise<IDbConnectionServerConfig>;
  reserveConnection(tabId: number): Promise<void>;
  releaseConnection(tabId: number): Promise<void>;
  startTransaction(tabId: number): Promise<void>;
  commitTransaction(tabId: number): Promise<void>;
  rollbackTransaction(tabId: number): Promise<void>;
  syncDatabase(): Promise<void>;

  // schema introspection
  listDatabases(filter?: DatabaseFilterOptions): Promise<string[]>;
  listSchemas(filter?: SchemaFilterOptions): Promise<string[]>;
  listTables(filter?: FilterOptions): Promise<TableOrView[]>;
  listViews(filter?: FilterOptions): Promise<TableOrView[]>;
  listMaterializedViews(filter?: FilterOptions): Promise<TableOrView[]>;
  listRoutines(filter?: FilterOptions): Promise<Routine[]>;
  listTableColumns(table: string, schema?: string): Promise<ExtendedTableColumn[]>;
  listTableTriggers(table: string, schema?: string): Promise<TableTrigger[]>;
  listTableIndexes(table: string, schema?: string): Promise<TableIndex[]>;
  listTablePartitions(table: string, schema?: string): Promise<TablePartition[]>;
  getTableReferences(table: string, schema?: string): Promise<string[]>;
  getTableKeys(table: string, schema?: string): Promise<TableKey[]>;
  getPrimaryKey(table: string, schema?: string): Promise<string | null>;
  getPrimaryKeys(table: string, schema?: string): Promise<PrimaryKeyColumn[]>;
  getTableProperties(table: string, schema?: string): Promise<TableProperties | null>;
  getTableLength(table: string, schema?: string): Promise<number>;
  getTableCreateScript(table: string, schema?: string): Promise<string>;
  getViewCreateScript(view: string, schema?: string): Promise<string[]>;
  getRoutineCreateScript(routine: string, type: string, schema?: string): Promise<string[]>;

  // data read (grid)
  selectTop(
    table: string, offset: number, limit: number, orderBy: OrderBy[],
    filters: string | TableFilter[], schema?: string, selects?: string[],
  ): Promise<TableResult>;
  selectTopSql(
    table: string, offset: number, limit: number, orderBy: OrderBy[],
    filters: string | TableFilter[], schema?: string, selects?: string[],
  ): Promise<string>;
  selectTopStream(
    table: string, orderBy: OrderBy[], filters: string | TableFilter[],
    chunkSize: number, schema?: string,
  ): Promise<StreamResults>;
  queryStream(query: string, chunkSize: number): Promise<StreamResults>;
  getFilteredDataCount(table: string, schema: string | null, filter: string): Promise<string>;
  getResultEditData(queryText: string, fields: FieldDescriptor[]): Promise<FieldEditData[]>;
  getInsertQuery(tableInsert: TableInsert, runAsUpsert?: boolean): Promise<string>;

  // query execution — note query() returns a CancelableQuery built from query id
  query(queryText: string, tabId: number, options?: any, hasActiveTransaction?: boolean): Promise<CancelableQuery>;
  executeQuery(queryText: string, options?: any): Promise<NgQueryResult[]>;
  executeCommand(commandText: string): Promise<NgQueryResult[]>;
  getCompletions(cmd: string): Promise<string[]>;
  getShellPrompt(): Promise<string>;

  // table CRUD / DDL (sql = preview, bare = execute)
  createTable(table: CreateTableSpec): Promise<void>;
  alterTableSql(change: AlterTableSpec): Promise<string>;
  alterTable(change: AlterTableSpec): Promise<void>;
  applyChangesSql(changes: TableChanges): Promise<string>;
  applyChanges(changes: TableChanges, tabId?: number): Promise<TableUpdateResult[]>;
  setElementName(elementName: string, newElementName: string, typeOfElement: DatabaseElement, schema?: string): Promise<void>;
  dropElement(elementName: string, typeOfElement: DatabaseElement, schema?: string): Promise<void>;
  truncateElement(elementName: string, typeOfElement: DatabaseElement, schema?: string): Promise<void>;
  duplicateTable(tableName: string, duplicateTableName: string, schema?: string): Promise<void>;
  // …remaining alter*/duplicate*Sql/createDatabase* per §3.6
}

// Example facade method bodies — identical pattern to ElectronUtilityConnectionClient:
//   listTables(filter)        => transport.send('conn/listTables', { filter })
//   versionString()           => transport.send('conn/versionString', {})
//   query(text, tabId, opts)  => {
//     const id = await transport.send<string>('conn/query',
//       { queryText: text, options: opts, tabId, hasActiveTransaction });
//     return {
//       execute: () => transport.send('query/execute', { queryId: id, isManualCommit: opts?.isManualCommit }),
//       cancel:  () => transport.send('query/cancel',  { queryId: id }),
//     };
//   }
```

Reference implementation of the facade bodies is `ElectronUtilityConnectionClient.ts`
line-for-line — replace `Vue.prototype.$util.send` with `transport.send` and drop the
`import Vue`. The `recordSqlActivity(...)` calls in `selectTop`/`executeQuery`/`query`
(`ElectronUtilityConnectionClient.ts:96,120,251`) are optional telemetry; port or omit.

---

## 5. Wiring steps — swap the mock for the real client

The React app currently uses a **mock IPC client**. To go live against the real backend:

1. **Add the port handshake to the React entry** (`studio-react/src/.../renderer.tsx`,
   the `createRoot(...).render(<App/>)` entry from REDESIGN.md:275). Replicate the Vue
   handshake from `renderer.ts:205-215`, before/around mount:
   ```ts
   const transport = createBackendTransport();           // your real impl
   window.main.attachPortListener();                     // preload bridge, unchanged
   window.onmessage = (event) => {
     if (event.source === window && event.data?.type === 'port') {
       const [port] = event.ports;
       transport.setPort(port, event.data.sId);
       // kick off settings load / first queries here
     }
   };
   createRoot(document.getElementById('root')!).render(
     <BackendProvider value={new RealBackendClient(transport)}>
       <App />
     </BackendProvider>
   );
   ```
   `window.main` is the preload API (`preload.ts:199` `contextBridge.exposeInMainWorld('main', api)`);
   it already exposes `attachPortListener()` and `requestPorts()`. The preload script is
   **reused unchanged** (REDESIGN.md:260) — no new IPC channels needed.

2. **Implement the transport core** to match the framing in §1.3 exactly: UUID per
   request, `{ id, name, args: { sId, ...args } }` out, dispatch replies by `id`, reject
   on `type:'error'` (restoring `err.stack`), route `type`-only messages to push
   listeners, and queue-before-port with lazy `window.main.requestPorts()`. This is a
   direct port of `UtilityConnection.ts` (88-122) with no Vue.

3. **Keep the mock's method signatures identical.** The mock the React team built should
   already expose the `BackendClient` shape from §4 (same method names, same Promise
   return types). The real client implements the **same interface**, so swapping is a
   one-line provider change: construct `new RealBackendClient(transport)` instead of the
   mock, behind the env flag REDESIGN.md:292 describes (run Vue + React side-by-side).
   Components calling `useBackend()` / TanStack Query keys do not change.

4. **C0 smoke test** (REDESIGN.md:283): after the handshake on a live SQLite connection,
   call `backend.versionString()` and `backend.listTables()`; both should round-trip
   through the utility process and return real data — proving the seam before building UI.

5. **Wire push events** for transaction timeouts: subscribe via
   `transport.addListener('transactionTimeoutWarning/<tabId>', …)` and
   `transport.addListener('transactionTimedOut/<tabId>', …)` (emitted at
   `connHandlers.ts:649-661`) so the React UI can warn / refresh on auto-rollback.

### Invariants the React client must preserve

- **Never invent or change handler names or arg keys** — they are matched by exact string
  in `utility.ts:151` (`handlers[name]`) and destructured by key in each handler.
- **Always carry `sId`** — injected by the transport; the backend reads it from
  `args.sId` for `state(args.sId)` (`utility.ts:164`). A missing `sId` breaks the reply.
- **One `sId` per renderer window**, taken from the handshake. Do not reuse or guess MCP
  session ids (§2).
- **Reply is matched by `id`, not by order** — concurrent requests are fine.
- **Errors arrive as `{type:'error', error, stack}`**, not thrown — reject the promise
  and reattach `stack` for parity with the Vue client (`UtilityConnection.ts:52-55`).
