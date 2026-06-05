import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
  type ColorMode,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk-api";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";
import {
  RefreshCw,
  AlertTriangle,
  Key,
  Link2,
  Pin,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import {
  backend,
  type SchemaGraph,
  type SchemaGraphNode,
  type TableSummary,
} from "@/ipc";
import { graphKey, mergeGraphs } from "@/lib/graph";
import { formatRowEstimate } from "@/lib/explorer";
import { useThemeStore } from "@/store/theme";
import { IconButton, Button, Tooltip, Input } from "@/ui";

interface Props {
  connectionId: string;
  schema?: string;
  /** When set, the graph opens focused on this table (depth 1) instead of
   * dumping the whole schema; clicking a node expands its FK neighbors. */
  rootTable?: string;
  rootSchema?: string;
}

const NODE_WIDTH = 240;
/** Layout grid (SlashTable's GRAPH_GRID); node positions snap up to it. */
const GRAPH_GRID = 20;
const snapUp = (n: number) => Math.ceil(n / GRAPH_GRID) * GRAPH_GRID;
const HEADER_HEIGHT = 40; // --graph-header (GRAPH_GRID * 2)
const ROW_HEIGHT = 20; // --graph-row (GRAPH_GRID)
const NODE_PAD = 8;
/** Default visible columns when a card is collapsed: PK + FK rows (else first few). */
function visibleCols(columns: NodeColumn[], expanded: boolean): NodeColumn[] {
  if (expanded) return columns;
  const keys = columns.filter((c) => c.primaryKey || c.isForeignKey);
  return keys.length ? keys : columns.slice(0, Math.min(3, columns.length));
}

const keyOf = (schema: string, table: string) => `${schema}.${table}`;

/** A column rendered inside a table node, with a left/right Handle so edges
 * attach to the exact row. Only key/foreign-key columns get handles. */
interface NodeColumn {
  name: string;
  dataType?: string;
  primaryKey?: boolean;
  isForeignKey: boolean;
}

interface TableNodeData {
  schema: string;
  table: string;
  columns: NodeColumn[];
  /** Detected M2M join table (see heuristic below). */
  isJoinTable: boolean;
  /** The focus root in a depth-from-focus graph (pinned, highlighted). */
  isRoot: boolean;
  /** Whether the card shows all columns (true) or just key/FK rows (false). */
  expanded: boolean;
  /** Toggle this card's expanded state (keyed by `schema.table`). */
  onToggleExpand: (key: string) => void;
  /** Estimated row count for the subtitle (`~N rows · schema`). */
  rowEstimate?: number;
  [key: string]: unknown;
}

type TableNode = Node<TableNodeData, "table">;

// Hidden card-edge handles — used when an edge's FK/PK column isn't among the
// card's visible rows (the graph payload only carries representative columns).
const cardHandleStyle = {
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  opacity: 0,
  border: "none",
  background: "transparent",
} as const;

/**
 * SlashTable-style table card: a header (name + `~N rows · schema`), a row per
 * visible column (PK/FK key icon + name + type), and a `N more / Collapse`
 * footer. Collapsed shows only PK/FK rows; expanded shows every column.
 */
const TableNodeView = memo(function TableNodeView({ data }: NodeProps<TableNode>) {
  const key = keyOf(data.schema, data.table);
  const visible = visibleCols(data.columns, data.expanded);
  const defaultCount = visibleCols(data.columns, false).length;
  const hidden = data.columns.length - visible.length;
  const showFooter = data.expanded ? data.columns.length > defaultCount : hidden > 0;
  const rows = data.rowEstimate != null ? formatRowEstimate(data.rowEstimate) : "";
  const subtitle = `${rows ? `~${rows} rows · ` : ""}${data.schema}`;

  return (
    <div
      className="graph-table-node"
      data-join={data.isJoinTable || undefined}
      data-root={data.isRoot || undefined}
      style={{ width: NODE_WIDTH }}
    >
      {/* Fallback card-edge handles for columns not shown as rows. */}
      <Handle type="target" position={Position.Left} id="card__l" style={cardHandleStyle} />
      <Handle type="source" position={Position.Left} id="card__l" style={cardHandleStyle} />
      <Handle type="target" position={Position.Right} id="card__r" style={cardHandleStyle} />
      <Handle type="source" position={Position.Right} id="card__r" style={cardHandleStyle} />

      <div className="graph-table-header" style={{ height: HEADER_HEIGHT }}>
        <span className="graph-table-title">
          {data.isRoot && <Pin size={11} className="shrink-0 text-accent" />}
          {data.table}
          {data.isJoinTable && <span className="graph-join-badge">join</span>}
        </span>
        <span className="graph-table-subtitle">{subtitle}</span>
      </div>

      {visible.map((c) => {
        const hasHandle = c.primaryKey || c.isForeignKey;
        return (
          <div key={c.name} className="graph-row" style={{ height: ROW_HEIGHT }}>
            {hasHandle && (
              <>
                <Handle className="graph-handle" type="target" position={Position.Left} id={`${c.name}__l`} />
                <Handle className="graph-handle" type="source" position={Position.Left} id={`${c.name}__l`} />
                <Handle className="graph-handle" type="target" position={Position.Right} id={`${c.name}__r`} />
                <Handle className="graph-handle" type="source" position={Position.Right} id={`${c.name}__r`} />
              </>
            )}
            {c.primaryKey ? (
              <Key size={11} className="shrink-0 text-warning" />
            ) : c.isForeignKey ? (
              <Link2 size={11} className="shrink-0 text-accent" />
            ) : (
              <span className="inline-block w-[11px] shrink-0" />
            )}
            <span className="graph-col-name">{c.name}</span>
            {c.dataType && <span className="graph-col-type">{c.dataType}</span>}
          </div>
        );
      })}

      {showFooter && (
        <button
          type="button"
          className="graph-table-footer"
          style={{ height: ROW_HEIGHT }}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleExpand(key);
          }}
        >
          {data.expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{data.expanded ? "Collapse" : `${hidden} more`}</span>
        </button>
      )}
    </div>
  );
});

const nodeTypes = { table: TableNodeView };

/** Height a node occupies — header + visible rows + optional footer. Must match
 * what TableNodeView renders so ELK reserves the right space. */
function nodeHeight(cols: NodeColumn[], expanded: boolean): number {
  const vis = visibleCols(cols, expanded).length;
  const defaultCount = visibleCols(cols, false).length;
  const showFooter = expanded ? cols.length > defaultCount : cols.length - vis > 0;
  return HEADER_HEIGHT + vis * ROW_HEIGHT + (showFooter ? ROW_HEIGHT : 0) + NODE_PAD;
}

/** Full column list for a node: the describeTable result when fetched, else the
 * graph payload's representative columns. */
function resolveCols(
  node: SchemaGraphNode,
  fkCols: Set<string>,
  fullCols: Map<string, NodeColumn[]>
): NodeColumn[] {
  const full = fullCols.get(keyOf(node.schema, node.table));
  if (full) return full;
  return node.columns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    primaryKey: c.primaryKey,
    isForeignKey: fkCols.has(c.name),
  }));
}

/**
 * M2M join-table heuristic, mirroring SlashTable's SQL detection
 * (`fk_col_count >= 2 AND non_keyed_count == 0`). We approximate "non-keyed"
 * as columns that are neither a primary key nor a foreign key.
 *
 * NOTE: the graph payload only carries `primaryKey` per column plus FK edges.
 * It does NOT distinguish composite-PK membership, so this is a best-effort
 * heuristic: a table whose every column is either a PK or an FK, with 2+ FK
 * columns, is treated as a join table.
 */
function detectJoinTable(node: SchemaGraphNode, fkColumns: Set<string>): boolean {
  if (node.columns.length === 0) return false;
  const fkCount = node.columns.filter((c) => fkColumns.has(c.name)).length;
  const nonKeyed = node.columns.filter(
    (c) => !c.primaryKey && !fkColumns.has(c.name)
  ).length;
  return fkCount >= 2 && nonKeyed === 0;
}

// ELK runs in a Web Worker so layout never blocks the UI thread (this is the
// key to a smooth graph on large schemas — it's what SlashTable does).
const elk = new ELK({ workerFactory: () => new ElkWorker() });

/**
 * ELK "layered" layout options — copied verbatim from SlashTable's graph: an
 * ER-style global arrangement (related tables in adjacent layers, orthogonal
 * edges, crossings minimized) with node spacing on the 20px grid.
 */
const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.spacing.nodeNodeBetweenLayers": "140",
  "elk.spacing.nodeNode": String(GRAPH_GRID * 2),
};

/** Lay the schema graph out with ELK (async) → React Flow nodes/edges.
 * `rootKey` (when given) marks the pinned focus node. */
async function layoutGraph(
  graph: SchemaGraph,
  rootKey: string | null,
  cardOpen: Set<string>,
  onToggleExpand: (key: string) => void,
  estimates: Map<string, number>,
  fullCols: Map<string, NodeColumn[]>
): Promise<{ nodes: TableNode[]; edges: Edge[] }> {
  // FK source columns per table — used both for the column icon and the M2M heuristic.
  const fkByTable = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const k = keyOf(e.fromSchema, e.fromTable);
    if (!fkByTable.has(k)) fkByTable.set(k, new Set());
    fkByTable.get(k)!.add(e.fromColumn);
  }

  const ids = new Set(graph.nodes.map((n) => keyOf(n.schema, n.table)));
  const laid = await elk.layout({
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: graph.nodes.map((n) => {
      const k = keyOf(n.schema, n.table);
      return {
        id: k,
        width: NODE_WIDTH,
        height: nodeHeight(resolveCols(n, fkByTable.get(k) ?? new Set(), fullCols), cardOpen.has(k)),
        // Pin the focus root to the first layer so it anchors the left edge.
        layoutOptions:
          k === rootKey ? { "elk.layered.layering.layerConstraint": "FIRST" } : undefined,
      };
    }),
    edges: graph.edges
      .map((e, i) => ({
        id: `elk${i}`,
        sources: [keyOf(e.fromSchema, e.fromTable)],
        targets: [keyOf(e.toSchema, e.toTable)],
      }))
      // ELK rejects self-loops and dangling endpoints.
      .filter(
        (e) =>
          e.sources[0] !== e.targets[0] && ids.has(e.sources[0]) && ids.has(e.targets[0])
      ),
  });

  const pos = new Map<string, { x: number; y: number }>();
  // Snap to the layout grid (SlashTable's snapUp) for crisp alignment.
  for (const c of laid.children ?? []) pos.set(c.id, { x: snapUp(c.x ?? 0), y: snapUp(c.y ?? 0) });

  const nodes: TableNode[] = graph.nodes.map((n) => {
    const k = keyOf(n.schema, n.table);
    const fkCols = fkByTable.get(k) ?? new Set<string>();
    const p = pos.get(k) ?? { x: 0, y: 0 };
    return {
      id: k,
      type: "table",
      position: { x: p.x, y: p.y }, // ELK returns top-left coords directly
      data: {
        schema: n.schema,
        table: n.table,
        isJoinTable: detectJoinTable(n, fkCols),
        isRoot: k === rootKey,
        expanded: cardOpen.has(k),
        onToggleExpand,
        rowEstimate: estimates.get(k),
        columns: resolveCols(n, fkCols, fullCols),
      },
    };
  });

  const nodeX = new Map(nodes.map((n) => [n.id, n.position.x]));
  // Which column rows each card actually renders, so an edge can fall back to a
  // card-edge handle when its FK/PK column isn't shown as a row.
  const visByNode = new Map(
    nodes.map((n) => [n.id, new Set(visibleCols(n.data.columns, n.data.expanded).map((c) => c.name))])
  );

  const edges: Edge[] = graph.edges.map((e, i) => {
    const from = keyOf(e.fromSchema, e.fromTable);
    const to = keyOf(e.toSchema, e.toTable);
    // Side of each node the handle sits on, from relative x (shortest path).
    const fromLeft = (nodeX.get(from) ?? 0) > (nodeX.get(to) ?? 0);
    const srcSide = fromLeft ? "l" : "r";
    const tgtSide = fromLeft ? "r" : "l";
    const sourceHandle = visByNode.get(from)?.has(e.fromColumn)
      ? `${e.fromColumn}__${srcSide}`
      : `card__${srcSide}`;
    const targetHandle = visByNode.get(to)?.has(e.toColumn)
      ? `${e.toColumn}__${tgtSide}`
      : `card__${tgtSide}`;
    return {
      id: `e${i}`,
      source: from,
      target: to,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
      // Subtle gray orthogonal edges (SlashTable style), no label.
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-border)", width: 12, height: 12 },
      style: { stroke: "var(--color-border)", strokeWidth: 1.5 },
    };
  });

  return { nodes, edges };
}

export function SchemaGraphView({ connectionId, schema, rootTable, rootSchema }: Props) {
  const themeMode = useThemeStore((s) => s.theme);
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keys already fetched (FK-neighbor expansion), so a node is only fetched once.
  const [fetched, setFetched] = useState<Set<string>>(new Set());
  // Cards currently showing their columns (expanded) vs header-only (collapsed).
  const [cardOpen, setCardOpen] = useState<Set<string>>(new Set());
  // The starting table chosen in the picker (when no rootTable prop was given).
  const [picked, setPicked] = useState<{ schema: string; table: string } | null>(null);
  // Per-table row estimates for the card subtitle (`~N rows · schema`).
  const [estimates, setEstimates] = useState<Map<string, number>>(new Map());
  // Full column lists per table (describeTable) — the graph payload only carries
  // a few representative columns, so cards would otherwise look truncated.
  const [fullCols, setFullCols] = useState<Map<string, NodeColumn[]>>(new Map());

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rfRef = useRef<ReactFlowInstance<TableNode, Edge> | null>(null);
  const prevGraph = useRef<SchemaGraph | null>(null);

  // Effective focus root: the prop, else the table picked in the starting picker.
  const rootTbl = rootTable ?? picked?.table ?? null;
  const rootSch = rootTable ? rootSchema ?? schema : picked?.schema ?? schema;
  const focused = !!rootTbl;
  const needsPick = !rootTbl;
  const rootKey = useMemo(
    () => (rootTbl ? graphKey(rootSch ?? "public", rootTbl) : null),
    [rootTbl, rootSch]
  );

  // Toggle a card's expanded state (stable ref so the memoized node holds).
  const toggleCard = useCallback((key: string) => {
    setCardOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const load = useCallback(() => {
    // No starting table chosen yet — show the picker, don't fetch.
    if (!rootTbl) {
      setGraph(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setFetched(rootKey ? new Set([rootKey]) : new Set());
    setCardOpen(rootKey ? new Set([rootKey]) : new Set());
    backend
      .getSchemaGraph(connectionId, { schema: rootSch, rootTable: rootTbl, rootSchema: rootSch, depth: 1 })
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [connectionId, rootSch, rootTbl, rootKey]);

  useEffect(load, [load]);

  // Row estimates for card subtitles (one cheap listTables call per connection).
  useEffect(() => {
    let cancelled = false;
    backend
      .connect(connectionId)
      .then((id) => backend.listTables(id))
      .then((tables) => {
        if (cancelled) return;
        setEstimates(
          new Map(
            tables
              .filter((t) => t.rowEstimate != null && t.rowEstimate > 0)
              .map((t) => [`${t.schema}.${t.name}`, t.rowEstimate as number])
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  // Fetch the FULL column list for each table in the graph (describeTable), so
  // cards show every column + an accurate "N more" — not just the few the graph
  // payload returns. Each table is fetched once.
  useEffect(() => {
    if (!graph) return;
    const todo = graph.nodes.filter((n) => !fullCols.has(keyOf(n.schema, n.table)));
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      const liveId = await backend.connect(connectionId);
      const entries = await Promise.all(
        todo.map(async (n): Promise<[string, NodeColumn[]] | null> => {
          try {
            const d = await backend.describeTable(liveId, n.table, n.schema);
            const fkSet = new Set(d.foreignKeys.map((f) => f.column));
            return [
              keyOf(n.schema, n.table),
              d.columns.map((c) => ({
                name: c.name,
                dataType: c.dataType,
                primaryKey: c.primaryKey,
                isForeignKey: fkSet.has(c.name),
              })),
            ];
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const fresh = entries.filter((e): e is [string, NodeColumn[]] => e !== null);
      if (fresh.length) setFullCols((prev) => new Map([...prev, ...fresh]));
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, connectionId, fullCols]);

  // Focused mode: clicking a node pulls in its FK neighbors (depth 1) and merges
  // them into the visible graph. Each node is fetched at most once.
  const onNodeClick = useCallback<NodeMouseHandler<TableNode>>(
    (_event, node) => {
      if (!focused) return;
      const key = graphKey(node.data.schema, node.data.table);
      if (fetched.has(key)) return;
      setFetched((prev) => new Set(prev).add(key));
      backend
        .getSchemaGraph(connectionId, {
          schema,
          rootTable: node.data.table,
          rootSchema: node.data.schema,
          depth: 1,
        })
        .then((more) => setGraph((cur) => (cur ? mergeGraphs(cur, more) : more)))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [focused, fetched, connectionId, schema]
  );

  // ELK layout is async; recompute on graph / root / card-expand changes. Only
  // re-fit the viewport when the graph itself changed (not on a card toggle).
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    const shouldFit = graph !== prevGraph.current;
    prevGraph.current = graph;
    layoutGraph(graph, rootKey, cardOpen, toggleCard, estimates, fullCols)
      .then((res) => {
        if (cancelled) return;
        setNodes(res.nodes);
        setEdges(res.edges);
        if (shouldFit) {
          // RF's initial fitView runs before the async nodes arrive — fit now.
          requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 200 }));
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [graph, rootKey, cardOpen, toggleCard, estimates, fullCols, setNodes, setEdges]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-2">
        <Tooltip content="Refresh">
          <IconButton onClick={load} aria-label="Refresh">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </IconButton>
        </Tooltip>
        {focused ? <Pin size={13} className="text-accent" /> : <Link2 size={13} className="text-text-muted" />}
        <span className="font-mono text-xs text-text-muted">
          {rootTbl ? `${rootTbl} · depth 1` : "schema graph"}
        </span>
        {!rootTable && picked && (
          <Button variant="subtle" size="sm" onClick={() => setPicked(null)}>
            Change table
          </Button>
        )}
        {graph && graph.nodes.length > 0 && (
          <>
            <Button
              variant="subtle"
              size="sm"
              onClick={() =>
                setCardOpen(new Set(graph.nodes.map((n) => keyOf(n.schema, n.table))))
              }
            >
              Expand all
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setCardOpen(new Set())}>
              Collapse all
            </Button>
          </>
        )}
        <span className="ml-auto text-xs text-text-muted">
          {graph ? `${graph.nodes.length} tables · ${graph.edges.length} relations` : "—"}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg-primary">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertTriangle size={22} className="text-danger" />
            <div className="text-md text-text-primary">Could not load schema graph</div>
            <div className="max-w-xl font-mono text-xs text-text-muted">{error}</div>
            <Button variant="subtle" size="sm" className="mt-2" onClick={load}>
              Retry
            </Button>
          </div>
        ) : needsPick ? (
          <StartTablePicker
            connectionId={connectionId}
            schema={schema}
            onPick={(t) => setPicked({ schema: t.schema, table: t.name })}
          />
        ) : loading && !graph ? (
          <div className="flex h-full items-center justify-center gap-2 text-md text-text-muted">
            <RefreshCw size={14} className="animate-spin" /> Building schema graph…
          </div>
        ) : graph && graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-md text-text-muted">
            No tables in this schema.
          </div>
        ) : graph ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onInit={(inst) => (rfRef.current = inst)}
            nodeTypes={nodeTypes}
            onlyRenderVisibleElements
            colorMode={themeMode as ColorMode}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : null}
      </div>
    </div>
  );
}

/** SlashTable-style "Select a starting table" picker: a searchable table list
 * with row estimates. Choosing one opens the graph focused on that table. */
function StartTablePicker({
  connectionId,
  schema,
  onPick,
}: {
  connectionId: string;
  schema?: string;
  onPick: (t: TableSummary) => void;
}) {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    backend
      .connect(connectionId)
      .then((id) => backend.listTables(id, schema))
      .then((t) => !cancelled && setTables(t))
      .catch(() => !cancelled && setTables([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? tables.filter((t) => t.name.toLowerCase().includes(needle)) : tables;
  }, [tables, q]);

  return (
    <div className="flex h-full items-start justify-center overflow-auto p-8">
      <div className="mt-10 w-full max-w-xl">
        <h2 className="mb-4 text-center text-lg font-semibold text-text-primary">
          Select a starting table
        </h2>
        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tables…"
            className="pl-9"
          />
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-bg-secondary">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-md text-text-muted">
              <RefreshCw size={14} className="animate-spin" /> Loading tables…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-md text-text-muted">No tables match.</div>
          ) : (
            filtered.map((t) => {
              const rows = formatRowEstimate(t.rowEstimate);
              return (
                <button
                  key={`${t.schema}.${t.name}`}
                  onClick={() => onPick(t)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left font-mono text-md text-text-secondary transition-colors duration-100 ease-out hover:bg-bg-hover hover:text-text-primary"
                >
                  <span className="truncate">{t.name}</span>
                  {rows && <span className="shrink-0 text-xs text-text-muted">~{rows} rows</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
