import { useCallback, useEffect, useMemo, useState } from "react";
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
  type ColorMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { RefreshCw, AlertTriangle, Key, Link2 } from "lucide-react";
import { backend, type SchemaGraph, type SchemaGraphNode } from "@/ipc";
import { useThemeStore } from "@/store/theme";

interface Props {
  connectionId: string;
  schema?: string;
}

const NODE_WIDTH = 230;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const NODE_PAD = 8;

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
  [key: string]: unknown;
}

type TableNode = Node<TableNodeData, "table">;

const handleStyle = {
  width: 7,
  height: 7,
  background: "var(--color-accent)",
  border: "1px solid var(--color-bg-secondary)",
};

/** Custom node: header (schema-qualified name) + a row per column. Each
 * key/FK column exposes source+target handles on both sides so edges can
 * attach at the right row regardless of layout direction. */
function TableNodeView({ data }: NodeProps<TableNode>) {
  const qualified =
    data.schema && data.schema !== "public"
      ? `${data.schema}.${data.table}`
      : data.table;

  return (
    <div
      className="schema-node"
      data-join={data.isJoinTable || undefined}
      style={{ width: NODE_WIDTH }}
    >
      <div className="schema-node__header" style={{ height: HEADER_HEIGHT }}>
        <span className="schema-node__title">{qualified}</span>
        {data.isJoinTable && <span className="schema-node__badge">join</span>}
      </div>
      <div className="schema-node__body" style={{ paddingBlock: NODE_PAD / 2 }}>
        {data.columns.length === 0 && (
          <div className="schema-node__row schema-node__row--empty" style={{ height: ROW_HEIGHT }}>
            …
          </div>
        )}
        {data.columns.map((c) => {
          const hasHandle = c.primaryKey || c.isForeignKey;
          const handleId = `${c.name}`;
          return (
            <div key={c.name} className="schema-node__row" style={{ height: ROW_HEIGHT }}>
              {hasHandle && (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${handleId}__l`}
                    style={handleStyle}
                  />
                  <Handle
                    type="source"
                    position={Position.Left}
                    id={`${handleId}__l`}
                    style={handleStyle}
                  />
                  <Handle
                    type="target"
                    position={Position.Right}
                    id={`${handleId}__r`}
                    style={handleStyle}
                  />
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${handleId}__r`}
                    style={handleStyle}
                  />
                </>
              )}
              {c.primaryKey ? (
                <Key size={10} className="shrink-0 text-warning" />
              ) : c.isForeignKey ? (
                <Link2 size={10} className="shrink-0 text-accent" />
              ) : (
                <span className="inline-block w-[10px] shrink-0" />
              )}
              <span className="schema-node__col-name">{c.name}</span>
              {c.dataType && <span className="schema-node__col-type">{c.dataType}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNodeView };

/** Height a node occupies given its column count (used by the layout engine). */
function nodeHeight(node: SchemaGraphNode): number {
  return HEADER_HEIGHT + Math.max(node.columns.length, 1) * ROW_HEIGHT + NODE_PAD;
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

/** Build React Flow nodes/edges with a dagre directed (left-to-right) layout. */
function buildGraph(graph: SchemaGraph): { nodes: TableNode[]; edges: Edge[] } {
  // FK source columns per table — used both for the column icon and the M2M heuristic.
  const fkByTable = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const k = keyOf(e.fromSchema, e.fromTable);
    if (!fkByTable.has(k)) fkByTable.set(k, new Set());
    fkByTable.get(k)!.add(e.fromColumn);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 110, marginx: 24, marginy: 24 });

  for (const n of graph.nodes) {
    g.setNode(keyOf(n.schema, n.table), {
      width: NODE_WIDTH,
      height: nodeHeight(n),
    });
  }
  for (const e of graph.edges) {
    const from = keyOf(e.fromSchema, e.fromTable);
    const to = keyOf(e.toSchema, e.toTable);
    if (g.hasNode(from) && g.hasNode(to) && from !== to) g.setEdge(from, to);
  }
  dagre.layout(g);

  const nodes: TableNode[] = graph.nodes.map((n) => {
    const k = keyOf(n.schema, n.table);
    const fkCols = fkByTable.get(k) ?? new Set<string>();
    const pos = g.node(k);
    const h = nodeHeight(n);
    return {
      id: k,
      type: "table",
      // dagre returns center coords; React Flow wants top-left.
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - h / 2 },
      data: {
        schema: n.schema,
        table: n.table,
        isJoinTable: detectJoinTable(n, fkCols),
        columns: n.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          primaryKey: c.primaryKey,
          isForeignKey: fkCols.has(c.name),
        })),
      },
    };
  });

  const nodePos = new Map(nodes.map((n) => [n.id, n.position.x]));

  const edges: Edge[] = graph.edges.map((e, i) => {
    const from = keyOf(e.fromSchema, e.fromTable);
    const to = keyOf(e.toSchema, e.toTable);
    // Pick which side of each node the handle sits on, based on relative x,
    // so edges run the shortest path and visibly connect the right rows.
    const fromLeft = (nodePos.get(from) ?? 0) > (nodePos.get(to) ?? 0);
    // A foreign key is N -> 1: many rows in `from` reference one row in `to`.
    return {
      id: `e${i}`,
      source: from,
      target: to,
      sourceHandle: `${e.fromColumn}__${fromLeft ? "l" : "r"}`,
      targetHandle: `${e.toColumn}__${fromLeft ? "r" : "l"}`,
      type: "smoothstep",
      label: "N:1",
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-accent)" },
      style: { stroke: "var(--color-accent)", strokeWidth: 1.5, opacity: 0.7 },
      labelStyle: { fill: "var(--color-text-muted)", fontSize: 9 },
      labelBgStyle: { fill: "var(--color-bg-primary)", opacity: 0.85 },
    };
  });

  return { nodes, edges };
}

export function SchemaGraphView({ connectionId, schema }: Props) {
  const themeMode = useThemeStore((s) => s.theme);
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backend
      .getSchemaGraph(connectionId, schema)
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [connectionId, schema]);

  useEffect(load, [load]);

  const built = useMemo(() => (graph ? buildGraph(graph) : null), [graph]);

  useEffect(() => {
    if (built) {
      setNodes(built.nodes);
      setEdges(built.edges);
    }
  }, [built, setNodes, setEdges]);

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

      <div className="relative min-h-0 flex-1 bg-bg-primary">
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
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
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
