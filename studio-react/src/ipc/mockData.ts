import type {
  CellValue,
  ColumnDef,
  Connection,
  Schema,
  TableSummary,
} from "./types";

export const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "mlc-local",
    name: "mlc local",
    kind: "postgres",
    host: "127.0.0.1:5432",
    connected: true,
  },
  {
    id: "mlc-remote",
    name: "mlc remote",
    kind: "postgres",
    host: "db.mlc.nexenture.fr:5432",
    tag: "PRD",
    tagColor: "danger",
    connected: false,
  },
  {
    id: "clicky",
    name: "CLICKY",
    kind: "mysql",
    host: "clicky.internal:3306",
    connected: false,
  },
];

export const MOCK_SCHEMAS: Schema[] = [
  { name: "public", tableCount: 6 },
  { name: "analytics", tableCount: 3 },
  { name: "auth", tableCount: 2 },
];

export const MOCK_TABLES: TableSummary[] = [
  { schema: "public", name: "users", type: "table", rowEstimate: 299 },
  { schema: "public", name: "campaigns", type: "table", rowEstimate: 1820 },
  { schema: "public", name: "reports", type: "table", rowEstimate: 4502 },
  { schema: "public", name: "graph", type: "table", rowEstimate: 64 },
  { schema: "public", name: "events", type: "table", rowEstimate: 99213 },
  { schema: "public", name: "active_users", type: "view", rowEstimate: 0 },
  { schema: "analytics", name: "daily_rollup", type: "materialized-view", rowEstimate: 365 },
  { schema: "analytics", name: "sessions", type: "table", rowEstimate: 50231 },
  { schema: "analytics", name: "pageviews", type: "table", rowEstimate: 882104 },
  { schema: "auth", name: "tokens", type: "table", rowEstimate: 1204 },
  { schema: "auth", name: "roles", type: "table", rowEstimate: 8 },
];

export const USERS_COLUMNS: ColumnDef[] = [
  { name: "id", dataType: "int4", nullable: false, primaryKey: true, default: "nextval(...)" },
  { name: "email", dataType: "varchar(255)", nullable: false, primaryKey: false },
  { name: "username", dataType: "varchar(64)", nullable: false, primaryKey: false },
  { name: "full_name", dataType: "text", nullable: true, primaryKey: false },
  { name: "is_active", dataType: "bool", nullable: false, primaryKey: false, default: "true" },
  { name: "plan", dataType: "varchar(32)", nullable: false, primaryKey: false, default: "'free'" },
  { name: "created_at", dataType: "timestamptz", nullable: false, primaryKey: false, default: "now()" },
];

const FIRST = ["alex", "jordan", "sam", "casey", "riley", "morgan", "taylor", "jamie", "drew", "quinn", "avery", "parker", "reese", "sky", "noor"];
const LAST = ["lee", "patel", "garcia", "kim", "nguyen", "smith", "rossi", "dubois", "haddad", "okoro", "silva", "wong", "ferrari", "novak", "ahmed"];
const PLANS = ["free", "pro", "team", "enterprise"];

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function buildUsersRows(count: number): CellValue[][] {
  const r = rng(42);
  const rows: CellValue[][] = [];
  const base = Date.UTC(2024, 0, 1);
  for (let i = 1; i <= count; i++) {
    const f = FIRST[Math.floor(r() * FIRST.length)];
    const l = LAST[Math.floor(r() * LAST.length)];
    const uname = `${f}.${l}${i}`;
    const created = new Date(base + Math.floor(r() * 500) * 86400000);
    rows.push([
      i,
      `${uname}@example.com`,
      uname,
      `${f[0].toUpperCase()}${f.slice(1)} ${l[0].toUpperCase()}${l.slice(1)}`,
      r() > 0.18,
      PLANS[Math.floor(r() * PLANS.length)],
      created.toISOString().replace("T", " ").slice(0, 19),
    ]);
  }
  return rows;
}
