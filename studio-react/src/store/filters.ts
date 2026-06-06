import { create } from "zustand";
import {
  makeCondition,
  makeGroup,
  type FilterCondition,
  type Combinator,
  type FilterGroup,
  type FilterNode,
} from "@/lib/filters";

/**
 * Per-tab nested AND/OR filter tree (root is always a group). Mirrors
 * SlashTable's per-tab filter store: a tree edited by the FilterBar and
 * compiled to a read-only WHERE that re-drives the grid.
 *
 * Persisted to localStorage so an open tab's filter survives reloads. The root
 * node id is regenerated per session is irrelevant; the tree shape is what we
 * store.
 */

const STORAGE_KEY = "studio-react.filters";

function freshRoot(): FilterGroup {
  return makeGroup("AND");
}

function load(): Record<string, FilterGroup> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FilterGroup>) : {};
  } catch {
    return {};
  }
}

function persist(byTab: Record<string, FilterGroup>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byTab));
  } catch {
    /* ignore */
  }
}

/** Recursively replace the node with id `targetId` using `fn` (immutably). */
function mapNode(
  node: FilterNode,
  targetId: string,
  fn: (n: FilterNode) => FilterNode
): FilterNode {
  if (node.id === targetId) return fn(node);
  if (node.kind === "group") {
    return {
      ...node,
      children: node.children.map((c) => mapNode(c, targetId, fn)),
    };
  }
  return node;
}

/** Recursively remove the node with id `targetId` from any group's children. */
function removeNodeFrom(node: FilterNode, targetId: string): FilterNode {
  if (node.kind !== "group") return node;
  return {
    ...node,
    children: node.children
      .filter((c) => c.id !== targetId)
      .map((c) => removeNodeFrom(c, targetId)),
  };
}

/** Append `child` to the group identified by `parentId`. */
function addChild(node: FilterNode, parentId: string, child: FilterNode): FilterNode {
  if (node.kind !== "group") return node;
  if (node.id === parentId) {
    return { ...node, children: [...node.children, child] };
  }
  return {
    ...node,
    children: node.children.map((c) => addChild(c, parentId, child)),
  };
}

interface FilterState {
  byTab: Record<string, FilterGroup>;
  /** Get the root group for a tab (lazily initialised, not persisted until edited). */
  getRoot: (tabId: string) => FilterGroup;
  /** Add a condition leaf to the given group (defaults to the root). */
  addCondition: (tabId: string, parentId?: string, column?: string) => FilterCondition;
  /** Add a nested group to the given group (defaults to the root). */
  addGroup: (tabId: string, parentId?: string) => void;
  /** Patch a node's fields (condition column/operator/value or group fields). */
  updateNode: (tabId: string, nodeId: string, patch: Partial<FilterNode>) => void;
  /** Flip a group's combinator AND<->OR. */
  toggleCombinator: (tabId: string, nodeId: string) => void;
  /** Flip a group's negate flag. */
  toggleNegate: (tabId: string, nodeId: string) => void;
  /** Remove a node (and its subtree). Removing the root resets it. */
  removeNode: (tabId: string, nodeId: string) => void;
  /** Reset a tab's filter to an empty root group. */
  clearAll: (tabId: string) => void;
  /**
   * Seed a tab's filter from a single equality condition (used by drilldown,
   * `fk = value`). Replaces the existing tree. No-op if a tree already exists.
   */
  seedEquals: (tabId: string, column: string, value: unknown) => void;
}

function commit(
  set: (fn: (s: FilterState) => Partial<FilterState>) => void,
  tabId: string,
  fn: (root: FilterGroup) => FilterGroup
) {
  set((s) => {
    const root = s.byTab[tabId] ?? freshRoot();
    const next = fn(root);
    const byTab = { ...s.byTab, [tabId]: next };
    persist(byTab);
    return { byTab };
  });
}

export const useFilterStore = create<FilterState>((set, get) => ({
  byTab: load(),

  getRoot: (tabId) => get().byTab[tabId] ?? freshRoot(),

  addCondition: (tabId, parentId, column) => {
    const condition = makeCondition(column ?? "");
    commit(set, tabId, (root) => {
      const target = parentId ?? root.id;
      return addChild(root, target, condition) as FilterGroup;
    });
    return condition;
  },

  addGroup: (tabId, parentId) =>
    commit(set, tabId, (root) => {
      const target = parentId ?? root.id;
      return addChild(root, target, makeGroup("AND")) as FilterGroup;
    }),

  updateNode: (tabId, nodeId, patch) =>
    commit(
      set,
      tabId,
      (root) =>
        mapNode(root, nodeId, (n) => ({ ...n, ...patch }) as FilterNode) as FilterGroup
    ),

  toggleCombinator: (tabId, nodeId) =>
    commit(
      set,
      tabId,
      (root) =>
        mapNode(root, nodeId, (n) =>
          n.kind === "group"
            ? { ...n, combinator: (n.combinator === "AND" ? "OR" : "AND") as Combinator }
            : n
        ) as FilterGroup
    ),

  toggleNegate: (tabId, nodeId) =>
    commit(
      set,
      tabId,
      (root) =>
        mapNode(root, nodeId, (n) =>
          n.kind === "group" ? { ...n, negate: !n.negate } : n
        ) as FilterGroup
    ),

  removeNode: (tabId, nodeId) =>
    commit(set, tabId, (root) => {
      if (root.id === nodeId) return freshRoot();
      return removeNodeFrom(root, nodeId) as FilterGroup;
    }),

  clearAll: (tabId) => commit(set, tabId, () => freshRoot()),

  seedEquals: (tabId, column, value) =>
    commit(set, tabId, (root) => {
      if (root.children.length > 0) return root;
      const cond = makeCondition(column);
      cond.operator = "equals";
      cond.value = value;
      return { ...root, children: [cond] };
    }),
}));
