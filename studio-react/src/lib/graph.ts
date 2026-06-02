import type { GetSchemaGraphOptions, SchemaGraph, SchemaGraphEdge } from "@/ipc";

/** Stable node key for a (schema, table) pair. */
export const graphKey = (schema: string, table: string): string => `${schema}.${table}`;

/** The two node keys an FK edge connects (child end first, parent end second). */
const edgeEnds = (e: SchemaGraphEdge): [string, string] => [
  graphKey(e.fromSchema, e.fromTable),
  graphKey(e.toSchema, e.toTable),
];

/**
 * Direct FK neighbors of a node, treating edges as undirected: a table's parents
 * (outgoing FKs) and its children (incoming FKs) are both one hop away.
 */
export function neighborKeys(edges: SchemaGraphEdge[], key: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    const [from, to] = edgeEnds(e);
    if (from === key && to !== key) out.add(to);
    else if (to === key && from !== key) out.add(from);
  }
  return out;
}

/**
 * Breadth-first set of node keys within `depth` FK-hops of `rootKey` (inclusive
 * of the root). Edges are followed in both directions so a focused table pulls
 * in both its parents and its children. `depth` is clamped to >= 0.
 */
export function reachableKeys(
  edges: SchemaGraphEdge[],
  rootKey: string,
  depth: number
): Set<string> {
  const visited = new Set<string>([rootKey]);
  let frontier: string[] = [rootKey];
  const maxDepth = Math.max(0, Math.floor(depth));
  for (let d = 0; d < maxDepth; d++) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const n of neighborKeys(edges, k)) {
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return visited;
}

/**
 * Induce the subgraph on a set of node keys: keep the listed nodes and every
 * edge whose both endpoints are in the set.
 */
export function inducedSubgraph(graph: SchemaGraph, keys: Set<string>): SchemaGraph {
  return {
    nodes: graph.nodes.filter((n) => keys.has(graphKey(n.schema, n.table))),
    edges: graph.edges.filter((e) => {
      const [from, to] = edgeEnds(e);
      return keys.has(from) && keys.has(to);
    }),
  };
}

/** Depth-limited subgraph rooted at one table: BFS by FK from the root, cap depth. */
export function subgraphFromRoot(
  graph: SchemaGraph,
  rootKey: string,
  depth: number
): SchemaGraph {
  return inducedSubgraph(graph, reachableKeys(graph.edges, rootKey, depth));
}

/** The key of the focus root in `options`, or null when the graph isn't focused. */
export function rootKeyOf(options?: GetSchemaGraphOptions): string | null {
  if (!options?.rootTable) return null;
  return graphKey(options.rootSchema ?? options.schema ?? "public", options.rootTable);
}

/**
 * Apply a {@link GetSchemaGraphOptions} focus to an already-built full graph:
 * when a `rootTable` is given, return the depth-limited subgraph around it
 * (default depth 1); otherwise return the graph unchanged. Lets a client build
 * the whole graph as before and narrow it consistently.
 */
export function focusGraph(full: SchemaGraph, options?: GetSchemaGraphOptions): SchemaGraph {
  const rootKey = rootKeyOf(options);
  if (!rootKey) return full;
  return subgraphFromRoot(full, rootKey, options?.depth ?? 1);
}

/**
 * Union two graphs: nodes deduped by key (first wins), edges deduped by their
 * endpoints + columns. Used to grow the visible graph when a node is expanded.
 */
export function mergeGraphs(a: SchemaGraph, b: SchemaGraph): SchemaGraph {
  const nodes = [...a.nodes];
  const seenNodes = new Set(nodes.map((n) => graphKey(n.schema, n.table)));
  for (const n of b.nodes) {
    const k = graphKey(n.schema, n.table);
    if (!seenNodes.has(k)) {
      seenNodes.add(k);
      nodes.push(n);
    }
  }
  const edgeId = (e: SchemaGraphEdge) =>
    `${graphKey(e.fromSchema, e.fromTable)}.${e.fromColumn}->` +
    `${graphKey(e.toSchema, e.toTable)}.${e.toColumn}`;
  const edges = [...a.edges];
  const seenEdges = new Set(edges.map(edgeId));
  for (const e of b.edges) {
    const id = edgeId(e);
    if (!seenEdges.has(id)) {
      seenEdges.add(id);
      edges.push(e);
    }
  }
  return { nodes, edges };
}
