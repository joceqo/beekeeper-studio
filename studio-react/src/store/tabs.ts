import { create } from "zustand";

export type TabKind = "table" | "query" | "connection" | "graph" | "relation";

/** Relationship direction for a drilldown step. */
export type RelationKind = "incoming" | "outgoing";

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
}

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** for table + relation tabs */
  schema?: string;
  table?: string;
  connectionId?: string;
  /** for query tabs, persisted editor text */
  sql?: string;
  /** for relation (drilldown) tabs: the breadcrumb path of hops. */
  path?: DrilldownCrumb[];
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  openTable: (connectionId: string, schema: string, table: string) => void;
  openQuery: () => void;
  openConnection: () => void;
  openGraph: (connectionId: string, schema?: string) => void;
  /**
   * Open (or focus) a relationship drilldown tab. `parentPath` is the breadcrumb
   * leading up to this hop (empty for a first drilldown). `crumb` is the new hop.
   */
  openRelation: (
    connectionId: string,
    parentPath: DrilldownCrumb[],
    crumb: DrilldownCrumb
  ) => void;
  /** Truncate a relation tab's path to `index` (inclusive) — breadcrumb back-nav. */
  navigateCrumb: (tabId: string, index: number) => void;
  setActive: (id: string) => void;
  close: (id: string) => void;
  updateSql: (id: string, sql: string) => void;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

const initialTab: Tab = {
  id: nextId("table"),
  kind: "table",
  title: "public.users",
  schema: "public",
  table: "users",
  connectionId: "mlc-local",
};
const secondTab: Tab = {
  id: nextId("table"),
  kind: "table",
  title: "public.graph",
  schema: "public",
  table: "graph",
  connectionId: "mlc-local",
};

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialTab, secondTab],
  activeId: initialTab.id,

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
      sql: "SELECT id, email, username, plan\nFROM public.users\nWHERE is_active = true\nORDER BY created_at DESC\nLIMIT 50;",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openConnection: () => {
    const existing = get().tabs.find((t) => t.kind === "connection");
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: Tab = { id: nextId("conn"), kind: "connection", title: "New Connection" };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openGraph: (connectionId, schema) => {
    const title = schema ? `Graph · ${schema}` : "Schema Graph";
    const existing = get().tabs.find(
      (t) => t.kind === "graph" && t.connectionId === connectionId && t.schema === schema
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
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openRelation: (connectionId, parentPath, crumb) => {
    const path = [...parentPath, crumb];
    // Dedupe by the full path signature so re-clicking focuses the same tab.
    const sig = JSON.stringify(path);
    const existing = get().tabs.find(
      (t) => t.kind === "relation" && t.connectionId === connectionId && JSON.stringify(t.path) === sig
    );
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const title = `${crumb.table}`;
    const tab: Tab = {
      id: nextId("rel"),
      kind: "relation",
      title,
      schema: crumb.schema,
      table: crumb.table,
      connectionId,
      path,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  navigateCrumb: (tabId, index) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab || !tab.path || index >= tab.path.length - 1) return s;
      const path = tab.path.slice(0, index + 1);
      const last = path[path.length - 1];
      return {
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, path, schema: last.schema, table: last.table, title: last.table }
            : t
        ),
      };
    }),

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
