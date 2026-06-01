import { create } from "zustand";

export type ActivityCategory =
  | "SQL"
  | "App"
  | "MCP"
  | "User"
  | "System"
  | "Connections";

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "SQL",
  "App",
  "MCP",
  "User",
  "System",
  "Connections",
];

export interface ActivityEntry {
  id: number;
  time: string; // HH:MM:SS.mmm
  category: ActivityCategory;
  op: string;
  connection: string;
  tables: string;
  sql: string;
  durationMs: number;
  rows: number | null;
}

const MAX = 1000;

interface ActivityState {
  collapsed: boolean;
  height: number;
  activeCategory: ActivityCategory;
  entries: ActivityEntry[];
  /** unseen-per-category counts since last viewed */
  unseen: Record<ActivityCategory, number>;
  push: (e: Omit<ActivityEntry, "id" | "time">) => void;
  clear: () => void;
  setCategory: (c: ActivityCategory) => void;
  toggleCollapsed: () => void;
  setHeight: (h: number) => void;
}

let id = 0;
function nowStamp() {
  const d = new Date();
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function seed(): ActivityEntry[] {
  const raw: Omit<ActivityEntry, "id">[] = [
    { time: "20:42:05.445", category: "User", op: "SELECT", connection: "mlc", tables: "public.users", sql: 'SELECT "users".* FROM "public"."users" ORDER BY "id" LIMIT 100', durationMs: 1742, rows: 7 },
    { time: "20:42:05.481", category: "User", op: "SELECT", connection: "mlc", tables: "public.campaigns", sql: 'SELECT * FROM "public"."campaigns" WHERE status = $1', durationMs: 1701, rows: 15 },
    { time: "20:42:06.112", category: "SQL", op: "SELECT", connection: "mlc", tables: "public.reports", sql: "SELECT count(*) FROM public.reports", durationMs: 312, rows: 1 },
    { time: "20:42:07.004", category: "MCP", op: "get_records", connection: "mlc", tables: "public.users", sql: "tool: get_records(table=users, limit=100)", durationMs: 880, rows: 100 },
    { time: "20:42:08.220", category: "Connections", op: "CONNECT", connection: "mlc local", tables: "—", sql: "Connection established (postgres 16.2)", durationMs: 64, rows: null },
    { time: "20:42:09.881", category: "System", op: "INFO", connection: "—", tables: "—", sql: "Schema cache refreshed (3 schemas, 11 tables)", durationMs: 12, rows: null },
  ];
  return raw.map((e) => ({ ...e, id: ++id }));
}

const emptyUnseen = (): Record<ActivityCategory, number> => ({
  SQL: 0,
  App: 0,
  MCP: 1,
  User: 0,
  System: 0,
  Connections: 0,
});

export const useActivityStore = create<ActivityState>((set, get) => ({
  collapsed: false,
  height: 240,
  activeCategory: "User",
  entries: seed(),
  unseen: emptyUnseen(),

  push: (e) => {
    const entry: ActivityEntry = { ...e, id: ++id, time: nowStamp() };
    set((s) => {
      const entries = [...s.entries, entry].slice(-MAX);
      const unseen = { ...s.unseen };
      if (s.activeCategory !== entry.category || s.collapsed) {
        unseen[entry.category] = (unseen[entry.category] || 0) + 1;
      }
      return { entries, unseen };
    });
  },

  clear: () => {
    const cat = get().activeCategory;
    set((s) => ({
      entries: s.entries.filter((e) => e.category !== cat),
      unseen: { ...s.unseen, [cat]: 0 },
    }));
  },

  setCategory: (c) =>
    set((s) => ({
      activeCategory: c,
      unseen: { ...s.unseen, [c]: 0 },
    })),

  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setHeight: (h) => set({ height: Math.max(120, Math.min(560, h)) }),
}));
