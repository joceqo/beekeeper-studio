import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Trash2,
  Loader2,
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
import { useUiStore } from "@/store/ui";
import {
  buildExplorerTree,
  formatRowEstimate,
  type ExplorerNode,
} from "@/lib/explorer";
import {
  cn,
  IconButton,
  Tooltip,
  Badge,
  ContextMenu,
  notify,
  type BadgeProps,
  type MenuEntry,
} from "@/ui";

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

/** Copy text to the clipboard with a confirmation toast. */
function copyToClipboard(text: string, label: string) {
  const done = () => notify.success(`Copied ${label}`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => notify.error("Copy failed"));
  } else {
    done();
  }
}

/** Right-click menu for a table row (matches SlashTable's table context menu). */
function tableMenu(
  t: TableSummary,
  actions: {
    onOpenTable: (t: TableSummary) => void;
    onOpenGraph: (t: TableSummary) => void;
  }
): MenuEntry[] {
  const qualified = `${t.schema}.${t.name}`;
  return [
    { label: "Open in New Tab", onSelect: () => actions.onOpenTable(t) },
    { label: "Open Schema Graph", onSelect: () => actions.onOpenGraph(t) },
    { type: "separator" },
    { label: "Copy Name", onSelect: () => copyToClipboard(t.name, t.name) },
    { label: "Copy Qualified Name", onSelect: () => copyToClipboard(qualified, qualified) },
  ];
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
  const connectionsRevision = useSidebarStore((s) => s.connectionsRevision);
  const refreshConnections = useSidebarStore((s) => s.refreshConnections);
  const connectedIds = useSidebarStore((s) => s.connectedIds);
  const connectingIds = useSidebarStore((s) => s.connectingIds);
  const markConnected = useSidebarStore((s) => s.markConnected);
  const markDisconnected = useSidebarStore((s) => s.markDisconnected);
  const markConnecting = useSidebarStore((s) => s.markConnecting);
  const clearConnecting = useSidebarStore((s) => s.clearConnecting);

  const openTable = useTabsStore((s) => s.openTable);
  const openConnection = useTabsStore((s) => s.openConnection);
  const openGraph = useTabsStore((s) => s.openGraph);
  const tabsList = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeId);

  // The table currently open in the active tab — highlighted in the explorer.
  // Only when that tab belongs to the connection currently being viewed, so a
  // same-named table in another connection isn't highlighted after switching.
  const activeTable = useMemo(() => {
    const tab = tabsList.find((t) => t.id === activeTabId);
    return tab?.kind === "table" &&
      tab.schema &&
      tab.table &&
      tab.connectionId === activeConnectionId
      ? { schema: tab.schema, table: tab.table }
      : null;
  }, [tabsList, activeTabId, activeConnectionId]);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [search, setSearch] = useState("");

  // Focus the search input when a command requests it (⇧T / Focus Explorer Search).
  const focusSearchSignal = useUiStore((s) => s.focusSearchSignal);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSearchSignal === 0) return;
    // Defer to let the sidebar expand (if it was collapsed) before focusing.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [focusSearchSignal]);

  useEffect(() => {
    backend.listConnections().then((conns) => {
      setConnections(conns);
      if (conns.length && !conns.some((c) => c.id === activeConnectionId)) {
        setActiveConnection(conns[0].id);
        toggleConnection(conns[0].id);
      }
    });
    // Re-fetch when a connection is saved (connectionsRevision bump).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsRevision]);

  useEffect(() => {
    if (!activeConnectionId) return;
    let cancelled = false;
    // BUG FIX: await connect so the saved connection id resolves to the live
    // connectionId before listTables/listSchemas fire.
    markConnecting(activeConnectionId);
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
          markConnected(activeConnectionId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
          setSchemas([]);
          markDisconnected(activeConnectionId);
        }
      })
      .finally(() => {
        if (!cancelled) clearConnecting(activeConnectionId);
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

  const removeConnection = async (c: Connection) => {
    if (!window.confirm(`Delete connection "${c.name}"? This cannot be undone.`)) return;
    try {
      await backend.removeConnection(c.id);
      refreshConnections();
      notify.success(`Deleted ${c.name}`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  };

  const renderConnection = (c: Connection) => {
    const isActive = c.id === activeConnectionId;
    const isOpen = expanded[c.id];
    const menu: MenuEntry[] = [
      { label: "Edit…", icon: <Pencil size={13} />, onSelect: () => openConnection(c.id) },
      { type: "separator" },
      {
        label: "Delete",
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => void removeConnection(c),
      },
    ];
    return (
      <ContextMenu key={c.id} items={menu}>
      <button
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left font-mono text-md transition-colors duration-100 ease-out hover:bg-bg-hover",
          isActive
            ? "bg-accent-subtle text-text-primary"
            : "text-text-secondary"
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
          <Badge
            tone={TAG_TONE[c.tagColor ?? "neutral"]}
            className="ml-auto font-mono uppercase tracking-wide"
          >
            {c.tag}
          </Badge>
        )}
        {connectingIds.has(c.id) ? (
          <Loader2
            size={12}
            className={cn("shrink-0 animate-spin text-text-muted", c.tag ? "ml-1.5" : "ml-auto")}
          />
        ) : (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              connectedIds.has(c.id) ? "bg-success" : "bg-text-muted/40",
              c.tag ? "ml-1.5" : "ml-auto"
            )}
          />
        )}
      </button>
      </ContextMenu>
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
            <IconButton size="sm" aria-label="New connection" onClick={() => openConnection()}>
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
                className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary transition-colors duration-100 ease-out hover:bg-bg-hover hover:text-text-primary"
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
                <span className="ml-auto text-xs tabular-nums text-text-muted">{items.length}</span>
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
        <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-primary px-2 py-1 transition-colors duration-100 ease-out focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40">
          <Search size={12} className="text-text-muted" />
          <input
            ref={searchRef}
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
                className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary transition-colors duration-100 ease-out hover:bg-bg-hover hover:text-text-primary"
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
                <span className="ml-auto text-xs tabular-nums text-text-muted">{sch.tableCount}</span>
              </button>
              {open && (
                <div className="pl-3">
                  {sch.nodes.map((node) => (
                    <ExplorerNodeRow
                      key={node.kind === "group" ? node.id : `${node.table.schema}.${node.table.name}`}
                      node={node}
                      collapsedMap={explorerCollapsed}
                      activeTable={activeTable}
                      onToggleGroup={toggleGroup}
                      onOpenTable={(t) =>
                        activeConnectionId && openTable(activeConnectionId, t.schema, t.name)
                      }
                      onOpenGraph={(t) =>
                        activeConnectionId && openGraph(activeConnectionId, t.schema, t.name, t.schema)
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
  activeTable,
  onToggleGroup,
  onOpenTable,
  onOpenGraph,
}: {
  node: ExplorerNode;
  collapsedMap: Record<string, boolean>;
  activeTable: { schema: string; table: string } | null;
  onToggleGroup: (id: string) => void;
  onOpenTable: (t: TableSummary) => void;
  onOpenGraph: (t: TableSummary) => void;
}) {
  const isActiveTable = (t: TableSummary) =>
    !!activeTable && activeTable.schema === t.schema && activeTable.table === t.name;
  if (node.kind === "table") {
    const t = node.table;
    const rows = formatRowEstimate(t.rowEstimate);
    const active = isActiveTable(t);
    return (
      <ContextMenu items={tableMenu(t, { onOpenTable, onOpenGraph })}>
        <button
          className={cn(
            "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md transition-colors duration-100 ease-out hover:bg-bg-hover",
            active && "bg-accent-subtle"
          )}
          onClick={() => onOpenTable(t)}
        >
          <TableIcon type={t.type} />
          <span className={cn("truncate", active ? "text-text-primary" : "text-text-secondary")}>
            {t.name}
          </span>
          {rows && <span className="ml-auto text-xs tabular-nums text-text-muted">{rows}</span>}
        </button>
      </ContextMenu>
    );
  }

  const open = !collapsedMap[node.id];
  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md text-text-secondary transition-colors duration-100 ease-out hover:bg-bg-hover hover:text-text-primary"
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
        <span className="ml-auto text-xs tabular-nums text-text-muted">{node.children.length}</span>
      </button>
      {open && (
        <div className="pl-3">
          {node.children.map((child) => {
            const rows = formatRowEstimate(child.table.rowEstimate);
            const active = isActiveTable(child.table);
            return (
              <ContextMenu
                key={`${child.table.schema}.${child.table.name}`}
                items={tableMenu(child.table, { onOpenTable, onOpenGraph })}
              >
                <button
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md transition-colors duration-100 ease-out hover:bg-bg-hover",
                    active && "bg-accent-subtle"
                  )}
                  onClick={() => onOpenTable(child.table)}
                >
                  <TableIcon type={child.table.type} />
                  <span className={cn("truncate", active ? "text-text-primary" : "text-text-secondary")}>
                    {child.table.name}
                  </span>
                  {rows && <span className="ml-auto text-xs tabular-nums text-text-muted">{rows}</span>}
                </button>
              </ContextMenu>
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
