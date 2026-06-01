import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, Key, Link2 } from "lucide-react";
import { backend, type SchemaGraph, type SchemaGraphNode } from "@/ipc";

interface Props {
  connectionId: string;
  schema?: string;
}

const NODE_WIDTH = 220;
const COL_GAP = 110;
const ROW_GAP = 36;
const NODE_HEADER = 30;
const ROW_HEIGHT = 20;
const NODE_PAD = 8;
const MARGIN = 32;

interface Placed {
  node: SchemaGraphNode;
  key: string;
  level: number;
  x: number;
  y: number;
  height: number;
}

const keyOf = (schema: string, table: string) => `${schema}.${table}`;

/**
 * Assign each table a column ("level") by longest dependency depth: a table that
 * references others sits to the right of what it references. Cycles are broken by
 * the visited guard. Tables sharing a level stack vertically.
 */
function computeLevels(graph: SchemaGraph): Map<string, number> {
  const adj = new Map<string, string[]>(); // from -> [to]
  for (const n of graph.nodes) adj.set(keyOf(n.schema, n.table), []);
  for (const e of graph.edges) {
    const from = keyOf(e.fromSchema, e.fromTable);
    const to = keyOf(e.toSchema, e.toTable);
    if (adj.has(from) && adj.has(to) && from !== to) adj.get(from)!.push(to);
  }
  const level = new Map<string, number>();
  const depth = (k: string, stack: Set<string>): number => {
    if (level.has(k)) return level.get(k)!;
    if (stack.has(k)) return 0;
    stack.add(k);
    let max = 0;
    for (const to of adj.get(k) ?? []) max = Math.max(max, depth(to, stack) + 1);
    stack.delete(k);
    level.set(k, max);
    return max;
  };
  for (const k of adj.keys()) depth(k, new Set());
  return level;
}

function layout(graph: SchemaGraph): { placed: Placed[]; width: number; height: number } {
  const levels = computeLevels(graph);
  const byLevel = new Map<number, SchemaGraphNode[]>();
  for (const n of graph.nodes) {
    const lvl = levels.get(keyOf(n.schema, n.table)) ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(n);
  }

  const placed: Placed[] = [];
  let maxX = 0;
  let maxY = 0;
  const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const lvl of sortedLevels) {
    const nodes = byLevel.get(lvl)!.sort((a, b) => a.table.localeCompare(b.table));
    const x = MARGIN + lvl * (NODE_WIDTH + COL_GAP);
    let y = MARGIN;
    for (const node of nodes) {
      const height = NODE_HEADER + Math.max(node.columns.length, 1) * ROW_HEIGHT + NODE_PAD;
      placed.push({ node, key: keyOf(node.schema, node.table), level: lvl, x, y, height });
      y += height + ROW_GAP;
      maxY = Math.max(maxY, y);
    }
    maxX = Math.max(maxX, x + NODE_WIDTH);
  }
  return { placed, width: maxX + MARGIN, height: maxY + MARGIN };
}

export function SchemaGraphView({ connectionId, schema }: Props) {
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    backend
      .getSchemaGraph(connectionId, schema)
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [connectionId, schema]);

  const { placed, width, height } = useMemo(
    () => (graph ? layout(graph) : { placed: [], width: 0, height: 0 }),
    [graph]
  );

  const placedByKey = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const p of placed) m.set(p.key, p);
    return m;
  }, [placed]);

  // Center the scroll on first render of a graph.
  useLayoutEffect(() => {
    if (scrollRef.current && graph) scrollRef.current.scrollTo({ top: 0, left: 0 });
  }, [graph]);

  const edges = graph?.edges ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-2">
        <button className="grid-toolbar-btn" onClick={load} title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <Link2 size={13} className="text-text-muted" />
        <span className="font-mono text-xs text-text-muted">
          {schema ? `${schema} schema graph` : "schema graph"}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {graph ? `${graph.nodes.length} tables · ${graph.edges.length} relations` : "—"}
        </span>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-bg-primary">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertTriangle size={22} className="text-danger" />
            <div className="text-md text-text-primary">Could not load schema graph</div>
            <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
            <button
              className="mt-2 rounded-sm border border-border px-3 py-1 text-sm text-text-secondary hover:bg-bg-hover"
              onClick={load}
            >
              Retry
            </button>
          </div>
        ) : loading && !graph ? (
          <div className="flex h-full items-center justify-center gap-2 text-md text-text-muted">
            <RefreshCw size={14} className="animate-spin" /> Building schema graph…
          </div>
        ) : graph && graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-md text-text-muted">
            No tables in this schema.
          </div>
        ) : graph ? (
          <div className="relative" style={{ width, height }}>
            {/* edges */}
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={width}
              height={height}
            >
              {edges.map((e, i) => {
                const from = placedByKey.get(keyOf(e.fromSchema, e.fromTable));
                const to = placedByKey.get(keyOf(e.toSchema, e.toTable));
                if (!from || !to) return null;
                const involved =
                  hovered === from.key || hovered === to.key || hovered === null;
                // Connect the right edge of `from` to the left edge of `to`
                // (or reverse if `to` is to the left).
                const fromRight = from.x + NODE_WIDTH;
                const fromY = from.y + NODE_HEADER / 2 + 6;
                const toY = to.y + NODE_HEADER / 2 + 6;
                let x1: number, x2: number;
                if (to.x >= fromRight) {
                  x1 = fromRight;
                  x2 = to.x;
                } else if (from.x >= to.x + NODE_WIDTH) {
                  x1 = from.x;
                  x2 = to.x + NODE_WIDTH;
                } else {
                  x1 = fromRight;
                  x2 = to.x + NODE_WIDTH;
                }
                const midX = (x1 + x2) / 2;
                const d = `M ${x1} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${x2} ${toY}`;
                return (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={hovered && involved ? 2 : 1.25}
                    strokeOpacity={involved ? 0.85 : 0.18}
                  />
                );
              })}
            </svg>

            {/* nodes */}
            {placed.map((p) => {
              const fk = new Set(
                edges
                  .filter((e) => e.fromSchema === p.node.schema && e.fromTable === p.node.table)
                  .map((e) => e.fromColumn)
              );
              return (
                <div
                  key={p.key}
                  className="absolute rounded-md border border-border bg-bg-secondary shadow-sm"
                  style={{ left: p.x, top: p.y, width: NODE_WIDTH }}
                  onMouseEnter={() => setHovered(p.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className="flex items-center gap-1.5 rounded-t-md border-b border-border bg-bg-surface px-2 font-mono text-xs font-semibold text-text-primary"
                    style={{ height: NODE_HEADER }}
                  >
                    <span className="truncate">{p.node.table}</span>
                    {p.node.schema !== "public" && (
                      <span className="ml-auto text-text-muted">{p.node.schema}</span>
                    )}
                  </div>
                  <div className="py-1">
                    {p.node.columns.length === 0 && (
                      <div className="px-2 text-xs text-text-muted" style={{ height: ROW_HEIGHT }}>
                        …
                      </div>
                    )}
                    {p.node.columns.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center gap-1.5 px-2 text-xs"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {c.primaryKey ? (
                          <Key size={10} className="shrink-0 text-warning" />
                        ) : fk.has(c.name) ? (
                          <Link2 size={10} className="shrink-0 text-accent" />
                        ) : (
                          <span className="inline-block w-[10px]" />
                        )}
                        <span className="truncate font-mono text-text-secondary">{c.name}</span>
                        {c.dataType && (
                          <span className="ml-auto truncate font-mono text-[10px] text-text-muted">
                            {c.dataType}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
