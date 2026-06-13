import { create } from "zustand";
import { backend } from "@/ipc";

export type TabKind = "table" | "query" | "connection" | "graph" | "relation";

/** Relationship direction for a drilldown step. */
export type RelationKind = "incoming" | "outgoing";

/**
 * A many-to-many hop through a detected join (junction) table. The drilldown
 * lands on the FAR table but joins through the junction, so the crumb carries
 * the junction join condition (`junction.nearColumn = nearValue`) and how the
 * far table attaches (`far.farRefColumn = junction.farColumn`).
 */
export interface M2MCrumb {
  junctionSchema: string;
  junctionTable: string;
  /** Junction column referencing the source row. */
  nearColumn: string;
  /** The source row's key value matched by `nearColumn`. */
  nearValue: string | number;
  /** Junction column referencing the far table. */
  farColumn: string;
  /** The far table's referenced column (what `farColumn` points at). */
  farRefColumn: string;
}

/**
 * One hop in a relationship drilldown path. The first crumb is the origin row
 * (no relation); each subsequent crumb records the relation followed and the
 * filter applied to the target table.
 */
export interface DrilldownCrumb {
  /** Target schema/table this crumb lands on. */
  schema: string;
  table: string;
  /** Filter applied to this target table, embedded in the drilldown query. */
  filterColumn?: string;
  filterValue?: string | number;
  /** "incoming" = children (1:N), "outgoing" = parent (N:1). */
  relation?: RelationKind;
  /** Source row's primary-key value, shown as `table[pk]` in the crumb label. */
  sourceKey?: string | number;
  /** Source table the relation was followed *from*. */
  sourceTable?: string;
  /** When set, this hop traverses a many-to-many junction to the far table. */
  m2m?: M2MCrumb;
}

/**
 * A node in the branching drilldown TREE (§3). Each node lands on one table; a
 * node can branch into multiple relations (its `children`), so the breadcrumb is
 * a tree rather than a linear path. The `activeChildId` records which branch is
 * currently being followed, so the active path can be reconstructed from the
 * root down to the active leaf.
 */
export interface DrilldownNode {
  id: string;
  schema: string;
  table: string;
  /** "incoming" = children (1:N), "outgoing" = parent (N:1). Root has none. */
  relation?: RelationKind;
  /** Filter applied to this node's table (the join condition `fk`/`pk` = value). */
  filterColumn?: string;
  filterValue?: string | number;
  /** When pinned to a single record, the PK value shown as `#<id>` in the chip. */
  recordKey?: string | number;
  /** Source table the relation was followed from (for labels). */
  sourceTable?: string;
  /** Junction table name when this hop traversed a many-to-many relation. */
  via?: string;
  /** The many-to-many join condition, carried so the active path can rebuild it. */
  m2m?: M2MCrumb;
  children: DrilldownNode[];
  /** Which child is currently active (the branch being viewed). */
  activeChildId?: string;
}

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** for table + relation tabs */
  schema?: string;
  table?: string;
  connectionId?: string;
  /** for graph tabs: focus the graph on this root table (depth-from-focus). */
  rootTable?: string;
  rootSchema?: string;
  /** for connection tabs: the saved connection being edited (absent = new). */
  editConnectionId?: string;
  /** for connection tabs: the saved connection whose fields seed a NEW connection. */
  duplicateConnectionId?: string;
  /** for query tabs, persisted editor text */
  sql?: string;
  /**
   * for relation (drilldown) tabs: the linear ACTIVE path of hops, derived from
   * the tree. The last crumb is what the grid renders. Kept for the query layer
   * (lib/relations.ts, RelationView) which consumes a linear path.
   */
  path?: DrilldownCrumb[];
  /** for relation tabs: the full branching breadcrumb tree (§3). */
  tree?: DrilldownNode;
  /** for relation tabs: the active node id within the tree. */
  activeNodeId?: string;
  /** for relation tabs: back/forward history of active-node ids. */
  history?: string[];
  historyIndex?: number;
}

/** The connection editor modal: closed, or open in new/edit/duplicate mode. */
export interface ConnectionModalState {
  open: boolean;
  /** Editing a saved connection in place (absent = new). */
  editConnectionId?: string;
  /** Seeding a NEW connection from an existing one's fields. */
  duplicateConnectionId?: string;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** Connection editor modal state (SlashTable-style overlay, not a tab). */
  connectionModal: ConnectionModalState;
  /** True once the startup connection/table has been resolved (or skipped). */
  bootstrapped: boolean;
  /**
   * Resolve the real connection list on startup and open the first table of the
   * first connection. Works in BOTH mock and MCP: no hardcoded connection id is
   * seeded, so a fresh load never shows "Unknown or disconnected connection".
   * Idempotent — safe to call from React effects.
   */
  bootstrap: () => Promise<void>;
  openTable: (connectionId: string, schema: string, table: string) => void;
  openQuery: () => void;
  openConnection: (editConnectionId?: string, duplicateConnectionId?: string) => void;
  closeConnectionModal: () => void;
  openGraph: (
    connectionId: string,
    schema?: string,
    rootTable?: string,
    rootSchema?: string
  ) => void;
  /**
   * Open (or focus) a relationship drilldown tab. `parentPath` is the breadcrumb
   * leading up to this hop (empty for a first drilldown). `crumb` is the new hop.
   * Branching: if a relation tab already shows `parentPath`, the new hop is added
   * as a BRANCH off the matching node (the breadcrumb tree, §3) and activated,
   * rather than opening a separate tab.
   */
  openRelation: (
    connectionId: string,
    parentPath: DrilldownCrumb[],
    crumb: DrilldownCrumb
  ) => void;
  /** Truncate a relation tab's path to `index` (inclusive) — breadcrumb back-nav. */
  navigateCrumb: (tabId: string, index: number) => void;
  /** Activate a node within a relation tab's tree (click a chip), pushing history. */
  activateNode: (tabId: string, nodeId: string) => void;
  /** Remove a node (and its subtree) from a relation tab's tree (the `×` chip). */
  removeNode: (tabId: string, nodeId: string) => void;
  /** Step back/forward through a relation tab's active-node history. */
  historyBack: (tabId: string) => void;
  historyForward: (tabId: string) => void;
  setActive: (id: string) => void;
  close: (id: string) => void;
  updateSql: (id: string, sql: string) => void;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

// --- drilldown tree helpers -------------------------------------------------

/** Build a tree node from a DrilldownCrumb. */
function nodeFromCrumb(c: DrilldownCrumb): DrilldownNode {
  return {
    id: nextId("node"),
    schema: c.schema,
    table: c.table,
    relation: c.relation,
    filterColumn: c.filterColumn,
    filterValue: c.filterValue,
    // The origin crumb pins its source row; relation hops pin their filter value.
    recordKey: c.relation === "outgoing" ? c.filterValue : c.sourceKey,
    sourceTable: c.sourceTable,
    via: c.m2m?.junctionTable,
    m2m: c.m2m,
    children: [],
  };
}

/** Find a node by id anywhere in the tree. */
function findNode(node: DrilldownNode, id: string): DrilldownNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Immutably map the node with `id` through `fn`. */
function mapTree(node: DrilldownNode, id: string, fn: (n: DrilldownNode) => DrilldownNode): DrilldownNode {
  if (node.id === id) return fn(node);
  return { ...node, children: node.children.map((c) => mapTree(c, id, fn)) };
}

/** Remove the node with `id` (and its subtree) from the tree; root is never removed. */
function pruneTree(node: DrilldownNode, id: string): DrilldownNode {
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => pruneTree(c, id)),
  };
}

/** The chain of node ids from the root down to `id`, or [] if not found. */
function pathToNode(node: DrilldownNode, id: string, acc: string[] = []): string[] {
  const here = [...acc, node.id];
  if (node.id === id) return here;
  for (const c of node.children) {
    const hit = pathToNode(c, id, here);
    if (hit.length) return hit;
  }
  return [];
}

/**
 * Reconstruct the linear DrilldownCrumb path for the active node, walking the
 * tree root→active and pulling each node's filter. This is what the query layer
 * (RelationView, lib/relations.ts) consumes.
 */
function activePath(tree: DrilldownNode, activeNodeId: string): DrilldownCrumb[] {
  const ids = pathToNode(tree, activeNodeId);
  const crumbs: DrilldownCrumb[] = [];
  for (const id of ids) {
    const n = findNode(tree, id);
    if (!n) continue;
    crumbs.push({
      schema: n.schema,
      table: n.table,
      filterColumn: n.filterColumn,
      filterValue: n.filterValue,
      relation: n.relation,
      sourceKey: n.recordKey,
      sourceTable: n.sourceTable,
      m2m: n.m2m,
    });
  }
  return crumbs;
}

/** Set `activeChildId` along the chain to `activeNodeId` so the active branch is unambiguous. */
function markActiveBranch(tree: DrilldownNode, activeNodeId: string): DrilldownNode {
  const ids = pathToNode(tree, activeNodeId);
  function walk(node: DrilldownNode, depth: number): DrilldownNode {
    const nextId = ids[depth + 1];
    return {
      ...node,
      activeChildId: nextId,
      children: node.children.map((c) => (c.id === nextId ? walk(c, depth + 1) : c)),
    };
  }
  return walk(tree, ids.indexOf(tree.id));
}

/** Build a fresh tree from a parent path + new crumb (no existing tab matched). */
function buildTree(parentPath: DrilldownCrumb[], crumb: DrilldownCrumb): { tree: DrilldownNode; leafId: string } {
  const all = [...parentPath, crumb];
  const nodes = all.map(nodeFromCrumb);
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].children = [nodes[i + 1]];
    nodes[i].activeChildId = nodes[i + 1].id;
  }
  return { tree: nodes[0], leafId: nodes[nodes.length - 1].id };
}

const initialTab: Tab = {
  id: nextId("query"),
  kind: "query",
  title: "Welcome",
  sql: "-- Pick a table in the sidebar to browse data,\n-- or write SQL here and run it.\nSELECT 1;",
};

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialTab],
  activeId: initialTab.id,
  connectionModal: { open: false },
  bootstrapped: false,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    try {
      const conns = await backend.listConnections();
      if (!conns.length) return;
      // Prefer an already-connected connection; otherwise the first saved one.
      const conn = conns.find((c) => c.connected) ?? conns[0];
      const live = await backend.connect(conn.id);
      const tables = await backend.listTables(live);
      const first = tables.find((t) => t.type === "table") ?? tables[0];
      if (!first) return;
      // Only seed if the user hasn't already opened a data tab meanwhile.
      const hasData = get().tabs.some((t) => t.kind === "table" || t.kind === "relation");
      if (hasData) return;
      get().openTable(conn.id, first.schema, first.name);
    } catch {
      // Leave the welcome tab; the sidebar still lets the user pick a connection.
    }
  },

  openTable: (connectionId, schema, table) => {
    const title = `${schema}.${table}`;
    const existing = get().tabs.find(
      (t) => t.kind === "table" && t.title === title && t.connectionId === connectionId
    );
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: Tab = { id: nextId("table"), kind: "table", title, schema, table, connectionId };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openQuery: () => {
    const n = get().tabs.filter((t) => t.kind === "query").length + 1;
    const tab: Tab = {
      id: nextId("query"),
      kind: "query",
      title: `Query ${n}`,
      // Harmless starter (matches SlashTable's new-tab seed): a comment + a stub
      // the user completes. The old demo query referenced mock-only columns
      // (plan/is_active/created_at) and errored against real databases.
      sql: "-- Query public schema\nSELECT * FROM ",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openConnection: (editConnectionId?: string, duplicateConnectionId?: string) => {
    // Connection editing is a modal overlay (SlashTable-style), not a tab.
    set({ connectionModal: { open: true, editConnectionId, duplicateConnectionId } });
  },

  closeConnectionModal: () => {
    set({ connectionModal: { open: false } });
  },

  openGraph: (connectionId, schema, rootTable, rootSchema) => {
    const title = rootTable
      ? `Graph · ${rootTable}`
      : schema
        ? `Graph · ${schema}`
        : "Schema Graph";
    const existing = get().tabs.find(
      (t) =>
        t.kind === "graph" &&
        t.connectionId === connectionId &&
        t.schema === schema &&
        t.rootTable === rootTable
    );
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: Tab = {
      id: nextId("graph"),
      kind: "graph",
      title,
      connectionId,
      schema,
      rootTable,
      rootSchema: rootTable ? (rootSchema ?? schema ?? "public") : undefined,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openRelation: (connectionId, parentPath, crumb) => {
    const sigOf = (path: DrilldownCrumb[]) =>
      path
        .map((c) => `${c.schema}.${c.table}|${c.filterColumn ?? ""}=${c.filterValue ?? ""}`)
        .join(">");
    const parentSig = sigOf(parentPath);

    // Try to attach this hop as a BRANCH to an existing relation tab whose tree
    // contains a node reachable by exactly `parentPath` (the breadcrumb tree).
    const tabs = get().tabs;
    for (const t of tabs) {
      if (t.kind !== "relation" || t.connectionId !== connectionId || !t.tree) continue;
      // Find a node in the tree whose root→node path matches parentPath.
      let attachId: string | null = null;
      const stack: DrilldownNode[] = [t.tree];
      while (stack.length) {
        const n = stack.pop()!;
        if (sigOf(activePath(t.tree, n.id)) === parentSig) {
          attachId = n.id;
          break;
        }
        stack.push(...n.children);
      }
      if (attachId == null) continue;

      const attachNode = findNode(t.tree, attachId)!;
      // If a matching child branch already exists, just activate it.
      const childSig = `${crumb.schema}.${crumb.table}|${crumb.filterColumn ?? ""}=${crumb.filterValue ?? ""}`;
      const existingChild = attachNode.children.find(
        (c) => `${c.schema}.${c.table}|${c.filterColumn ?? ""}=${c.filterValue ?? ""}` === childSig
      );
      const childId = existingChild ? existingChild.id : nextId("node");
      let tree = t.tree;
      if (!existingChild) {
        const child = nodeFromCrumb(crumb);
        child.id = childId;
        tree = mapTree(tree, attachId, (n) => ({ ...n, children: [...n.children, child] }));
      }
      tree = markActiveBranch(tree, childId);
      const path = activePath(tree, childId);
      const history = [...(t.history ?? []).slice(0, (t.historyIndex ?? -1) + 1), childId];
      set((s) => ({
        tabs: s.tabs.map((x) =>
          x.id === t.id
            ? {
                ...x,
                tree,
                activeNodeId: childId,
                path,
                schema: crumb.schema,
                table: crumb.table,
                title: crumb.table,
                history,
                historyIndex: history.length - 1,
              }
            : x
        ),
        activeId: t.id,
      }));
      return;
    }

    // No existing tab to branch off → create a fresh relation tab + tree.
    const { tree, leafId } = buildTree(parentPath, crumb);
    const path = activePath(tree, leafId);
    const tab: Tab = {
      id: nextId("rel"),
      kind: "relation",
      title: crumb.table,
      schema: crumb.schema,
      table: crumb.table,
      connectionId,
      path,
      tree,
      activeNodeId: leafId,
      history: [leafId],
      historyIndex: 0,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  activateNode: (tabId, nodeId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.tree) return t;
        const node = findNode(t.tree, nodeId);
        if (!node) return t;
        const tree = markActiveBranch(t.tree, nodeId);
        const path = activePath(tree, nodeId);
        const history = [...(t.history ?? []).slice(0, (t.historyIndex ?? -1) + 1), nodeId];
        return {
          ...t,
          tree,
          activeNodeId: nodeId,
          path,
          schema: node.schema,
          table: node.table,
          title: node.table,
          history,
          historyIndex: history.length - 1,
        };
      }),
    })),

  removeNode: (tabId, nodeId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.tree) return t;
        // Removing the root collapses the whole drilldown — drop nothing here;
        // the chip for the root has no `×` in the UI, so this guards anyway.
        if (t.tree.id === nodeId) return t;
        const tree = pruneTree(t.tree, nodeId);
        // If the active node was inside the removed subtree, fall back to the
        // removed node's parent (the deepest surviving ancestor).
        let activeNodeId = t.activeNodeId;
        if (activeNodeId && !findNode(tree, activeNodeId)) {
          const chain = pathToNode(t.tree, nodeId);
          activeNodeId = chain[chain.length - 2] ?? tree.id;
        }
        const marked = activeNodeId ? markActiveBranch(tree, activeNodeId) : tree;
        const node = activeNodeId ? findNode(marked, activeNodeId) : null;
        const path = activeNodeId ? activePath(marked, activeNodeId) : t.path;
        const history = (t.history ?? []).filter((id) => findNode(marked, id));
        return {
          ...t,
          tree: marked,
          activeNodeId,
          path,
          schema: node?.schema ?? t.schema,
          table: node?.table ?? t.table,
          title: node?.table ?? t.title,
          history,
          historyIndex: history.length - 1,
        };
      }),
    })),

  historyBack: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.tree || t.history == null || t.historyIndex == null) return t;
        if (t.historyIndex <= 0) return t;
        const idx = t.historyIndex - 1;
        const nodeId = t.history[idx];
        const node = findNode(t.tree, nodeId);
        if (!node) return t;
        const tree = markActiveBranch(t.tree, nodeId);
        return {
          ...t,
          tree,
          activeNodeId: nodeId,
          path: activePath(tree, nodeId),
          schema: node.schema,
          table: node.table,
          title: node.table,
          historyIndex: idx,
        };
      }),
    })),

  historyForward: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.tree || t.history == null || t.historyIndex == null) return t;
        if (t.historyIndex >= t.history.length - 1) return t;
        const idx = t.historyIndex + 1;
        const nodeId = t.history[idx];
        const node = findNode(t.tree, nodeId);
        if (!node) return t;
        const tree = markActiveBranch(t.tree, nodeId);
        return {
          ...t,
          tree,
          activeNodeId: nodeId,
          path: activePath(tree, nodeId),
          schema: node.schema,
          table: node.table,
          title: node.table,
          historyIndex: idx,
        };
      }),
    })),

  navigateCrumb: (tabId, index) => {
    // Back-compat: activate the node at linear position `index` in the active path.
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.tree || tab.activeNodeId == null) return;
    const ids = pathToNode(tab.tree, tab.activeNodeId);
    const target = ids[index];
    if (target) get().activateNode(tabId, target);
  },

  setActive: (id) => set({ activeId: id }),

  close: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (s.activeId === id) {
        const fallback = tabs[idx] || tabs[idx - 1] || tabs[0];
        activeId = fallback ? fallback.id : null;
      }
      return { tabs, activeId };
    }),

  updateSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    })),
}));
