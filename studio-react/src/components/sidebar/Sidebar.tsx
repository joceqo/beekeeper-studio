import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Search,
  Database,
  Table2,
  Eye,
  Layers,
  PanelLeftClose,
  Folder,
  FolderOpen,
  Plus,
  Workflow,
} from "lucide-react";
import {
  backend,
  type Connection,
  type Schema,
  type TableSummary,
} from "@/ipc";
import { useSidebarStore } from "@/store/sidebar";
import { useLayoutStore } from "@/store/layout";
import { useTabsStore } from "@/store/tabs";
import {
  buildExplorerTree,
  formatRowEstimate,
  type ExplorerNode,
} from "@/lib/explorer";
import { cn, IconButton, Tooltip, Badge, type BadgeProps } from "@/ui";

const TAG_TONE: Record<NonNullable<Connection["tagColor"]>, BadgeProps["tone"]> = {
  danger: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  neutral: "neutral",
};

function TableIcon({ type }: { type: TableSummary["type"] }) {
  if (type === "view") return <Eye size={13} className="text-info" />;
  if (type === "materialized-view") return <Layers size={13} className="text-info" />;
  return <Table2 size={13} className="text-text-muted" />;
}

export function Sidebar() {
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggle = () => useLayoutStore.getState().toggle("sidebar");

  const activeConnectionId = useSidebarStore((s) => s.activeConnectionId);
  const setActiveConnection = useSidebarStore((s) => s.setActiveConnection);
  const expanded = useSidebarStore((s) => s.expandedConnections);
  const toggleConnection = useSidebarStore((s) => s.toggleConnection);
  const explorerCollapsed = useSidebarStore((s) => s.explorerCollapsed);
  const toggleGroup = useSidebarStore((s) => s.toggleGroup);

  const openTable = useTabsStore((s) => s.openTable);
  const openConnection = useTabsStore((s) => s.openConnection);
  const openGraph = useTabsStore((s) => s.openGraph);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    backend.listConnections().then((conns) => {
      setConnections(conns);
      if (conns.length && !conns.some((c) => c.id === activeConnectionId)) {
        setActiveConnection(conns[0].id);
        toggleConnection(conns[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeConnectionId) return;
    let cancelled = false;
    // BUG FIX: await connect so the saved connection id resolves to the live
    // connectionId before listTables/listSchemas fire.
    backend
      .connect(activeConnectionId)
      .then(async (liveId) => {
        const [t, s] = await Promise.all([
          backend.listTables(liveId),
          backend.listSchemas(liveId).catch(() => [] as Schema[]),
        ]);
        if (!cancelled) {
          setTables(t);
          setSchemas(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
          setSchemas([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  // Group connections into folders (folder-less connections render top-level).
  const connectionGroups = useMemo(() => groupConnections(connections), [connections]);

  // Build the explorer tree (schema folders + prefix groups, public-first).
  const schemaCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of schemas) m[s.name] = s.tableCount;
    return m;
  }, [schemas]);
  const tree = useMemo(
    () => buildExplorerTree(tables, schemaCounts, search),
    [tables, schemaCounts, search]
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-full flex-col items-center gap-1 overflow-hidden border-r border-border bg-bg-secondary py-2">
        <Tooltip content="Expand sidebar" side="right">
          <IconButton size="lg" aria-label="Expand sidebar" onClick={toggle}>
            <ChevronRight size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Connections" side="right">
          <IconButton size="lg" aria-label="Connections">
            <Database size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Tables" side="right">
          <IconButton size="lg" aria-label="Tables">
            <Table2 size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Search" side="right">
          <IconButton size="lg" aria-label="Search">
            <Search size={16} />
          </IconButton>
        </Tooltip>
      </div>
    );
  }

  const renderConnection = (c: Connection) => {
    const isActive = c.id === activeConnectionId;
    const isOpen = expanded[c.id];
    return (
      <button
        key={c.id}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left font-mono text-md hover:bg-bg-hover",
          isActive && "bg-bg-active"
        )}
        onClick={() => {
          setActiveConnection(c.id);
          toggleConnection(c.id);
        }}
      >
        {isOpen ? (
          <ChevronDown size={13} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-text-muted" />
        )}
        {/* paint dot (colored) — falls back to the engine icon tint */}
        {c.paint ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: c.paint }}
            aria-hidden
          />
        ) : (
          <Database
            size={13}
            className={cn("shrink-0", isActive ? "text-accent" : "text-text-muted")}
          />
        )}
        <span className="truncate">{c.name}</span>
        {c.tag && (
          <Badge tone={TAG_TONE[c.tagColor ?? "neutral"]} className="ml-auto font-mono">
            {c.tag}
          </Badge>
        )}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            c.connected ? "bg-success" : "bg-bg-tertiary",
            c.tag ? "ml-1.5" : "ml-auto"
          )}
        />
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-border bg-bg-secondary font-mono">
      {/* CONNECTIONS */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="font-sans text-xs font-semibold uppercase tracking-wide text-text-muted">
          Connections
        </span>
        <div className="flex items-center gap-1">
          <Tooltip content="New connection">
            <IconButton size="sm" aria-label="New connection" onClick={openConnection}>
              <Plus size={13} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Collapse sidebar">
            <IconButton size="sm" aria-label="Collapse sidebar" onClick={toggle}>
              <PanelLeftClose size={13} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <div className="px-1.5">
        {connectionGroups.loose.map(renderConnection)}
        {connectionGroups.folders.map(({ folder, items }) => {
          const id = `conn-folder:${folder}`;
          const open = !explorerCollapsed[id];
          return (
            <div key={folder}>
              <button
                className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary hover:bg-bg-hover"
                onClick={() => toggleGroup(id)}
              >
                {open ? (
                  <ChevronDown size={13} className="text-text-muted" />
                ) : (
                  <ChevronRight size={13} className="text-text-muted" />
                )}
                {open ? (
                  <FolderOpen size={13} className="text-text-muted" />
                ) : (
                  <Folder size={13} className="text-text-muted" />
                )}
                <span className="truncate">{folder}</span>
                <span className="ml-auto text-xs text-text-muted">{items.length}</span>
              </button>
              {open && <div className="pl-3">{items.map(renderConnection)}</div>}
            </div>
          );
        })}
      </div>

      {/* EXPLORER */}
      <div className="mt-3 flex items-center justify-between px-3 pb-1">
        <span className="font-sans text-xs font-semibold uppercase tracking-wide text-text-muted">
          Explorer
        </span>
        <Tooltip content="Open schema graph">
          <IconButton
            size="sm"
            aria-label="Open schema graph"
            disabled={!activeConnectionId}
            onClick={() => activeConnectionId && openGraph(activeConnectionId)}
          >
            <Workflow size={13} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="px-2 pb-2">
        <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-primary px-2 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40">
          <Search size={12} className="text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="w-full bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {tree.map((sch) => {
          const open = !explorerCollapsed[sch.id];
          return (
            <div key={sch.id}>
              <button
                className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary hover:bg-bg-hover"
                onClick={() => toggleGroup(sch.id)}
              >
                {open ? (
                  <ChevronDown size={13} className="text-text-muted" />
                ) : (
                  <ChevronRight size={13} className="text-text-muted" />
                )}
                {open ? (
                  <FolderOpen size={13} className="text-text-muted" />
                ) : (
                  <Folder size={13} className="text-text-muted" />
                )}
                <span className="truncate">{sch.schema}</span>
                <span className="ml-auto text-xs text-text-muted">{sch.tableCount}</span>
              </button>
              {open && (
                <div className="pl-3">
                  {sch.nodes.map((node) => (
                    <ExplorerNodeRow
                      key={node.kind === "group" ? node.id : `${node.table.schema}.${node.table.name}`}
                      node={node}
                      collapsedMap={explorerCollapsed}
                      onToggleGroup={toggleGroup}
                      onOpenTable={(t) =>
                        activeConnectionId && openTable(activeConnectionId, t.schema, t.name)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {tree.length === 0 && (
          <div className="px-2 py-3 font-sans text-xs text-text-muted">No tables match.</div>
        )}
      </div>
    </div>
  );
}

/** A single explorer node: either a prefix sub-folder or a table leaf. */
function ExplorerNodeRow({
  node,
  collapsedMap,
  onToggleGroup,
  onOpenTable,
}: {
  node: ExplorerNode;
  collapsedMap: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  onOpenTable: (t: TableSummary) => void;
}) {
  if (node.kind === "table") {
    const t = node.table;
    const rows = formatRowEstimate(t.rowEstimate);
    return (
      <button
        className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md hover:bg-bg-hover"
        onClick={() => onOpenTable(t)}
      >
        <TableIcon type={t.type} />
        <span className="truncate text-text-secondary">{t.name}</span>
        {rows && <span className="ml-auto text-xs text-text-muted">{rows}</span>}
      </button>
    );
  }

  const open = !collapsedMap[node.id];
  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary hover:bg-bg-hover"
        onClick={() => onToggleGroup(node.id)}
      >
        {open ? (
          <ChevronDown size={12} className="text-text-muted" />
        ) : (
          <ChevronRight size={12} className="text-text-muted" />
        )}
        {open ? (
          <FolderOpen size={12} className="text-text-muted" />
        ) : (
          <Folder size={12} className="text-text-muted" />
        )}
        <span className="truncate">{node.label}</span>
        <span className="ml-auto text-xs text-text-muted">{node.children.length}</span>
      </button>
      {open && (
        <div className="pl-3">
          {node.children.map((child) => {
            const rows = formatRowEstimate(child.table.rowEstimate);
            return (
              <button
                key={`${child.table.schema}.${child.table.name}`}
                className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md hover:bg-bg-hover"
                onClick={() => onOpenTable(child.table)}
              >
                <TableIcon type={child.table.type} />
                <span className="truncate text-text-secondary">{child.table.name}</span>
                {rows && <span className="ml-auto text-xs text-text-muted">{rows}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Split connections into folder groups + loose (folder-less) connections. */
function groupConnections(connections: Connection[]) {
  const loose: Connection[] = [];
  const folderMap = new Map<string, Connection[]>();
  for (const c of connections) {
    if (c.folder) {
      const arr = folderMap.get(c.folder) ?? [];
      arr.push(c);
      folderMap.set(c.folder, arr);
    } else {
      loose.push(c);
    }
  }
  return {
    loose,
    folders: [...folderMap.entries()].map(([folder, items]) => ({ folder, items })),
  };
}
