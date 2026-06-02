import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Plus, FolderPlus, X, Ban } from "lucide-react";
import type { ColumnDef } from "@/ipc";
import { Button, IconButton, Input, Select, Badge, cn } from "@/ui";
import { useFilterStore } from "@/store/filters";
import { useUiStore } from "@/store/ui";
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
  const addCondition = useFilterStore((s) => s.addCondition);

  // Stable empty root for tabs with no edits yet (kept across renders).
  const [fallback] = useState<FilterGroup>(() =>
    useFilterStore.getState().getRoot(tabId)
  );
  const root = storedRoot ?? fallback;

  const activeCount = useMemo(() => countActiveConditions(root), [root]);

  // "Add Filter" command (`f`): open the editor and seed an empty condition so
  // the user lands directly in an editable row. Only the active table's bar
  // reacts — inactive tabs are unmounted, so the signal targets the visible one.
  const openFilterSignal = useUiStore((s) => s.openFilterSignal);
  const lastSignal = useRef(openFilterSignal);
  useEffect(() => {
    if (openFilterSignal === lastSignal.current) return;
    lastSignal.current = openFilterSignal;
    setOpen(true);
    if (countActiveConditions(useFilterStore.getState().getRoot(tabId)) === 0) {
      addCondition(tabId, undefined, columns[0]?.name);
    }
  }, [openFilterSignal, tabId, columns, addCondition]);

  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary">
      <div className="flex h-8 items-center gap-2 px-2">
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs",
            activeCount > 0
              ? "text-accent hover:bg-bg-hover"
              : "text-text-muted hover:bg-bg-hover hover:text-text-primary"
          )}
          onClick={() => setOpen((o) => !o)}
          title="Filter rows"
        >
          <Filter size={13} className={activeCount > 0 ? "fill-current" : ""} />
          <span>Filter</span>
          {activeCount > 0 && (
            <Badge tone="accent" className="rounded-full bg-accent px-1.5 text-text-on-accent">
              {activeCount}
            </Badge>
          )}
        </button>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearAll(tabId)}
            title="Clear all filters"
          >
            Clear
          </Button>
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
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5 text-[11px]"
            onClick={() => addCondition(tabId, node.id, columns[0]?.name)}
            title="Add condition"
          >
            <Plus size={11} /> Condition
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5 text-[11px]"
            onClick={() => addGroup(tabId, node.id)}
            title="Add nested group"
          >
            <FolderPlus size={11} /> Group
          </Button>
          {!isRoot && (
            <IconButton
              variant="danger"
              size="sm"
              onClick={() => removeNode(tabId, node.id)}
              aria-label="Remove group"
            >
              <X size={13} />
            </IconButton>
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
      <Select
        aria-label="Filter column"
        triggerClassName="min-w-28"
        placeholder="column…"
        value={node.column || undefined}
        onValueChange={(v) => updateNode(tabId, node.id, { column: v })}
        items={columns.map((c) => ({ value: c.name, label: c.name }))}
      />

      <Select
        aria-label="Filter operator"
        triggerClassName="min-w-28"
        value={node.operator}
        onValueChange={(v) => updateNode(tabId, node.id, { operator: v as FilterOp })}
        items={OP_ORDER.map((op) => ({ value: op, label: OP_LABELS[op] }))}
      />

      {showNone ? null : showRange ? (
        <>
          <Input
            size="sm"
            className="min-w-24"
            placeholder="from"
            value={(node.value as string | undefined) ?? ""}
            onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
          />
          <span className="text-[11px] text-text-muted">and</span>
          <Input
            size="sm"
            className="min-w-24"
            placeholder="to"
            value={(node.value2 as string | undefined) ?? ""}
            onChange={(e) => updateNode(tabId, node.id, { value2: e.target.value })}
          />
        </>
      ) : showList ? (
        <Input
          size="sm"
          className="min-w-40"
          placeholder="a, b, c"
          value={listValue}
          onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
          title="Comma-separated values"
        />
      ) : (
        <Input
          size="sm"
          className="min-w-24"
          placeholder="value"
          value={(node.value as string | undefined) ?? ""}
          onChange={(e) => updateNode(tabId, node.id, { value: e.target.value })}
        />
      )}

      <IconButton
        variant="danger"
        size="sm"
        className="ml-auto"
        onClick={() => removeNode(tabId, node.id)}
        aria-label="Remove condition"
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}
