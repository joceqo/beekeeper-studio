import { useState } from "react";
import { ChevronRight, ArrowLeft, ArrowRight, GitBranch } from "lucide-react";
import type { DrilldownNode } from "@/store/tabs";
import { useTabsStore } from "@/store/tabs";
import { Chip, Badge, IconButton, Tooltip } from "@/ui";

interface Props {
  tabId: string;
  tree: DrilldownNode;
  activeNodeId: string | null;
  /** Whether back/forward history can step. */
  canBack: boolean;
  canForward: boolean;
}

/** The ids on the active path (root → active node). */
function activeChain(tree: DrilldownNode, activeNodeId: string | null): string[] {
  const out: string[] = [];
  let node: DrilldownNode | undefined = tree;
  while (node) {
    out.push(node.id);
    if (node.id === activeNodeId) break;
    const next: DrilldownNode | undefined = node.children.find(
      (c) => c.id === node!.activeChildId
    );
    node = next;
  }
  return out;
}

/** A chip's label: `table` plus `#<id>` when pinned to a record. */
function nodeLabel(node: DrilldownNode): string {
  return node.recordKey != null ? `${node.table} #${node.recordKey}` : node.table;
}

/**
 * Branching drilldown breadcrumb (§3). Renders the active path as a chain of
 * chips; at any node with more than one branch, the inactive siblings collapse
 * behind a count pill that expands to switch branches. The active node is
 * accent-colored; record-pinned nodes show `#<id>`; every non-root node has a
 * `×` to prune. Back/forward arrows walk the activation history.
 */
export function DrilldownBreadcrumb({ tabId, tree, activeNodeId, canBack, canForward }: Props) {
  const activate = useTabsStore((s) => s.activateNode);
  const removeNode = useTabsStore((s) => s.removeNode);
  const back = useTabsStore((s) => s.historyBack);
  const forward = useTabsStore((s) => s.historyForward);

  const chain = activeChain(tree, activeNodeId);

  // Resolve each id on the chain to its node, plus its parent (for sibling lists).
  const steps: { node: DrilldownNode; parent: DrilldownNode | null }[] = [];
  let parent: DrilldownNode | null = null;
  for (const id of chain) {
    const n: DrilldownNode | undefined =
      id === tree.id ? tree : parent ? parent.children.find((c) => c.id === id) : undefined;
    if (!n) break;
    steps.push({ node: n, parent });
    parent = n;
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Back">
        <IconButton aria-label="Back" disabled={!canBack} onClick={() => back(tabId)}>
          <ArrowLeft size={13} className={canBack ? "" : "opacity-30"} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Forward">
        <IconButton aria-label="Forward" disabled={!canForward} onClick={() => forward(tabId)}>
          <ArrowRight size={13} className={canForward ? "" : "opacity-30"} />
        </IconButton>
      </Tooltip>
      <div className="mx-1 h-4 w-px bg-border" />

      <div className="flex items-center gap-1 overflow-x-auto">
        {steps.map(({ node, parent }, i) => {
          const isActive = node.id === activeNodeId;
          const isRoot = i === 0;
          // Sibling branches off the *parent* (other than this node).
          const siblings = (parent?.children ?? []).filter((c) => c.id !== node.id);
          return (
            <div key={node.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-text-muted" />}
              <Chip
                tone={isActive ? "accent" : "neutral"}
                className="cursor-pointer font-mono"
                onClick={() => activate(tabId, node.id)}
                onRemove={isRoot ? undefined : () => removeNode(tabId, node.id)}
                title={
                  node.filterColumn
                    ? `${node.filterColumn} = ${node.filterValue}`
                    : "Origin"
                }
              >
                {nodeLabel(node)}
              </Chip>
              {siblings.length > 0 && (
                <SiblingPill tabId={tabId} siblings={siblings} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Collapsible count pill that expands sibling branches to switch into. */
function SiblingPill({ tabId, siblings }: { tabId: string; siblings: DrilldownNode[] }) {
  const [open, setOpen] = useState(false);
  const activate = useTabsStore((s) => s.activateNode);
  return (
    <span className="relative flex items-center">
      <Tooltip content={`${siblings.length} other branch${siblings.length === 1 ? "" : "es"}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center"
          aria-label="Show sibling branches"
        >
          <Badge tone="info" className="cursor-pointer gap-0.5">
            <GitBranch size={9} />
            {siblings.length}
          </Badge>
        </button>
      </Tooltip>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-sm border border-border bg-bg-surface p-1 shadow-md">
          {siblings.map((s) => (
            <button
              key={s.id}
              type="button"
              className="rounded-sm px-2 py-0.5 text-left font-mono text-xs text-text-secondary hover:bg-bg-hover"
              onClick={() => {
                activate(tabId, s.id);
                setOpen(false);
              }}
            >
              {nodeLabel(s)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
