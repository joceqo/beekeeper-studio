import { create } from "zustand";

export type TabKind = "table" | "query" | "connection" | "graph";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** for table tabs */
  schema?: string;
  table?: string;
  connectionId?: string;
  /** for query tabs, persisted editor text */
  sql?: string;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  openTable: (connectionId: string, schema: string, table: string) => void;
  openQuery: () => void;
  openConnection: () => void;
  openGraph: (connectionId: string, schema?: string) => void;
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
