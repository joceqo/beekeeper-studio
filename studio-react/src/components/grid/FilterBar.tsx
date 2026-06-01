import { useMemo, useState } from "react";
import { Filter, Plus, FolderPlus, X, Ban } from "lucide-react";
import type { ColumnDef } from "@/ipc";
import { useFilterStore } from "@/store/filters";
import {
  LIST_OPS,
  NO_VALUE_OPS,
  OP_LABELS,
  OP_ORDER,
  RANGE_OPS,
  countActiveConditions,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
} from "@/lib/filters";

interface Props {
  tabId: string;
  columns: ColumnDef[];
}

/**
 * Filter affordance + nested AND/OR editor rendered above the grid. Collapsed by
 * default (just a "Filter" chip with an active-count badge); expands to a tree
 * editor. Each condition row is column-select → operator-select → value
 * input(s); groups expose AND·OR toggle, negate, add-condition, add-group, and
 * remove. The active filter is held per tab in {@link useFilterStore} and the
 * compiled WHERE re-drives the grid via TableView/RelationView.
 */
export function FilterBar({ tabId, columns }: Props) {
  const [open, setOpen] = useState(false);
  const storedRoot = useFilterStore((s) => s.byTab[tabId]);
  const clearAll = useFilterStore((s) => s.clearAll);

  // Stable empty root for tabs with no edits yet (kept across renders).
  const [fallback] = useState<FilterGroup>(() =>
    useFilterStore.getState().getRoot(tabId)
  );
  const root = storedRoot ?? fallback;

  const activeCount = useMemo(() => countActiveConditions(root), [root]);

  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary">
      <div className="flex h-8 items-center gap-2 px-2">
        <button
          className={
            "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs " +
            (activeCount > 0
              ? "text-accent hover:bg-bg-hover"
              : "text-text-muted hover:bg-bg-hover hover:text-text-primary")
          }
          onClick={() => setOpen((o) => !o)}
          title="Filter rows"
        >
          <Filter size={13} className={activeCount > 0 ? "fill-current" : ""} />
          <span>Filter</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-medium text-text-on-accent">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            className="rounded-sm px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
            onClick={() => clearAll(tabId)}
            title="Clear all filters"
          >
            Clear
          </button>
        )}

        {!open && activeCount === 0 && (
          <span className="text-xs text-text-muted">No filters</span>
        )}
      </div>

      {open && (
        <div className="max-h-64 overflow-auto border-t border-border px-2 py-2">
          <GroupEditor tabId={tabId} node={root} columns={columns} isRoot />
        </div>
      )}
    </div>
  );
}

/** Recursive group editor: combinator/negate header + children + add buttons. */
function GroupEditor({
  tabId,
  node,
  columns,
  isRoot = false,
}: {
  tabId: string;
  node: FilterGroup;
  columns: ColumnDef[];
  isRoot?: boolean;
}) {
  const addCondition = useFilterStore((s) => s.addCondition);
  const addGroup = useFilterStore((s) => s.addGroup);
  const toggleCombinator = useFilterStore((s) => s.toggleCombinator);
  const toggleNegate = useFilterStore((s) => s.toggleNegate);
  const removeNode = useFilterStore((s) => s.removeNode);

  return (
    <div
      className={
        "rounded-md " +
        (isRoot ? "" : "border border-border bg-bg-primary/40 p-2")
      }
    >
      <div className="flex items-center gap-1.5">
        <button
          className="rounded-sm border border-border px-2 py-0.5 font-mono text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          onClick={() => toggleCombinator(tabId, node.id)}
          title="Toggle AND / OR for this group"
        >
          {node.combinator}
        </button>
        <button
          className={
            "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] " +
            (node.negate
              ? "border-danger text-danger"
              : "border-border text-text-muted hover:bg-bg-hover hover:text-text-primary")
          }
          onClick={() => toggleNegate(tabId, node.id)}
          title="Negate this group (NOT)"
        >
          <Ban size={11} /> NOT
        </button>

        <span className="ml-1 text-[11px] text-text-muted">
          {node.children.length === 0
            ? "empty group"
            : `${node.children.length} item${node.children.length === 1 ? "" : "s"}`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
            onClick={() => addCondition(tabId, node.id, columns[0]?.name)}
            title="Add condition"
          >
            <Plus size={11} /> Condition
          </button>
          <button
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
            onClick={() => addGroup(tabId, node.id)}
            title="Add nested group"
          >
            <FolderPlus size={11} /> Group
          </button>
          {!isRoot && (
            <button
              className="rounded-sm p-0.5 text-text-muted hover:bg-bg-hover hover:text-danger"
              onClick={() => removeNode(tabId, node.id)}
              title="Remove group"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {node.children.map((child) => (
            <NodeEditor key={child.id} tabId={tabId} node={child} columns={columns} />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeEditor({
  tabId,
  node,
  columns,
}: {
  tabId: string;
  node: FilterNode;
  columns: ColumnDef[];
}) {
  if (node.kind === "group") {
    return <GroupEditor tabId={tabId} node={node} columns={columns} />;
  }
  return <ConditionEditor tabId={tabId} node={node} columns={columns} />;
}

function ConditionEditor({
  tabId,
  node,
  columns,
}: {
  tabId: string;
  node: FilterCondition;
  columns: ColumnDef[];
}) {
  const updateNode = useFilterStore((s) => s.updateNode);
  const removeNode = useFilterStore((s) => s.removeNode);

  const showNone = NO_VALUE_OPS.has(node.operator);
  const showRange = RANGE_OPS.has(node.operator);
  const showList = LIST_OPS.has(node.operator);

  const listValue = Array.isArray(node.value)
    ? (node.value as unknown[]).join(", ")
    : (node.value as string | undefined) ?? "";

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-sm bg-bg-primary/30 px-1.5 py-1">
      <select
        className="filter-select"
        value={node.column}
        onChange={(e) => updateNode(tabId, node.id, { column: e.target.value })}
      >
        {!node.column && <option value="">column…</option>}
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        className="filter-select"
        value={node.operator}
        onChange={(e) =>
          updateNode(tabId, node.id, { operator: e.target.value as FilterOp })
        }
      >
        {OP_ORDER.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      {showNone ? null : showRange ? (
        <>
          <input
            className="filter-input"
            placeholder="from"
            value={(node.value as string | undefined) ?? ""}
            onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
          />
          <span className="text-[11px] text-text-muted">and</span>
          <input
            className="filter-input"
            placeholder="to"
            value={(node.value2 as string | undefined) ?? ""}
            onChange={(e) => updateNode(tabId, node.id, { value2: e.target.value })}
          />
        </>
      ) : showList ? (
        <input
          className="filter-input min-w-40"
          placeholder="a, b, c"
          value={listValue}
          onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
          title="Comma-separated values"
        />
      ) : (
        <input
          className="filter-input"
          placeholder="value"
          value={(node.value as string | undefined) ?? ""}
          onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
        />
      )}

      <button
        className="ml-auto rounded-sm p-0.5 text-text-muted hover:bg-bg-hover hover:text-danger"
        onClick={() => removeNode(tabId, node.id)}
        title="Remove condition"
      >
        <X size={13} />
      </button>
    </div>
  );
}
