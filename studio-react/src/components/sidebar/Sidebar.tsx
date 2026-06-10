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
  Star,
  Container,
} from "lucide-react";
import {
  backend,
  type Connection,
  type ConnectionConfig,
  type DockerContainer,
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

/** Short engine label shown as a neutral badge when a connection has no custom tag. */
const KIND_BADGE: Record<Connection["kind"], string> = {
  postgres: "PG",
  mysql: "MYSQL",
  sqlite: "SQLITE",
  sqlserver: "MSSQL",
};

/**
 * The backend client key + fallback credentials for one-click connecting a
 * Docker container. Credentials detected from the container env (DockerContainer
 * username/password/database) take precedence over these.
 */
const DOCKER_DEFAULTS: Record<
  Connection["kind"],
  { client: string; username: string; password: string; database: string }
> = {
  postgres: { client: "postgresql", username: "postgres", password: "postgres", database: "postgres" },
  mysql: { client: "mysql", username: "root", password: "", database: "" },
  sqlite: { client: "sqlite", username: "", password: "", database: "" },
  sqlserver: { client: "sqlserver", username: "sa", password: "", database: "" },
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
    onToggleFavorite: (t: TableSummary) => void;
    isFavorite: (t: TableSummary) => boolean;
  }
): MenuEntry[] {
  const qualified = `${t.schema}.${t.name}`;
  const favorite = actions.isFavorite(t);
  return [
    { label: "Open in New Tab", onSelect: () => actions.onOpenTable(t) },
    { label: "Open Schema Graph", onSelect: () => actions.onOpenGraph(t) },
    {
      label: favorite ? "Remove Favorite" : "Add Favorite",
      icon: <Star size={13} className={favorite ? "fill-current text-accent" : undefined} />,
      onSelect: () => actions.onToggleFavorite(t),
    },
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
  const tableFavorites = useSidebarStore((s) => s.tableFavorites);
  const toggleTableFavorite = useSidebarStore((s) => s.toggleTableFavorite);
  const isTableFavorite = useSidebarStore((s) => s.isTableFavorite);
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
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
  /** Container ids currently being connected (shows a spinner on the row). */
  const [connectingDocker, setConnectingDocker] = useState<Set<string>>(new Set());
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

  // Detect running Docker DB containers (best-effort; empty when Docker is off).
  useEffect(() => {
    let cancelled = false;
    backend
      .listDockerContainers()
      .then((c) => !cancelled && setDockerContainers(c))
      .catch(() => !cancelled && setDockerContainers([]));
    return () => {
      cancelled = true;
    };
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

  // All detected containers render in the Docker section (SlashTable-style); a
  // container that maps to a saved connection (same host:port) is tagged with
  // that connection so clicking activates it instead of creating a duplicate.
  const dockerToShow = useMemo(() => {
    const byHost = new Map(connections.map((c) => [c.host, c] as const));
    return dockerContainers.map((dc) => ({
      container: dc,
      match: byHost.get(`${dc.host}:${dc.port}`) ?? null,
    }));
  }, [dockerContainers, connections]);

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
  const favoriteTables = useMemo(
    () => tables.filter((t) => isTableFavorite(activeConnectionId, t.schema, t.name)),
    [tables, activeConnectionId, tableFavorites, isTableFavorite]
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

  /**
   * One-click connect a detected Docker container: reuse an existing saved
   * connection on the same host:port, otherwise create one using credentials
   * detected from the container env (falling back to the engine defaults),
   * then connect + open its first table. Auth failures surface as a toast.
   */
  const connectDockerContainer = async (dc: DockerContainer) => {
    const hostKey = `${dc.host}:${dc.port}`;
    const existing = connections.find((c) => c.host === hostKey);
    setConnectingDocker((s) => new Set(s).add(dc.id));
    try {
      let targetId: string;
      if (existing) {
        targetId = existing.id;
      } else {
        const defaults = DOCKER_DEFAULTS[dc.kind];
        let base: ConnectionConfig = {};
        try {
          base = await backend.newConnection();
        } catch {
          /* mock backends may not provide defaults */
        }
        const config: ConnectionConfig = {
          ...base,
          name: dc.name,
          connectionType: defaults.client,
          host: dc.host,
          port: dc.port,
          defaultDatabase: dc.database ?? (defaults.database || null),
          username: dc.username ?? (defaults.username || null),
          password: dc.password ?? (defaults.password || null),
        };
        const saved = await backend.saveConnection(config);
        refreshConnections();
        targetId = saved.id;
      }
      setActiveConnection(targetId);
      if (!expanded[targetId]) toggleConnection(targetId);
      // Connect explicitly (the active-connection effect only fires on change,
      // so re-clicking an already-active row must still retry the connection).
      let liveId: string;
      try {
        liveId = await backend.connect(targetId);
      } catch (e) {
        // A linked connection may hold stale credentials (e.g. saved before
        // container-env detection existed). Repair from the container env
        // once and retry; if that also fails, surface the original flow's error.
        if (!existing || dc.username == null) throw e;
        const config = await backend.getConnectionConfig(targetId);
        if (!config) throw e;
        await backend.saveConnection({
          ...config,
          username: dc.username,
          password: dc.password ?? config.password,
          defaultDatabase: dc.database ?? config.defaultDatabase,
        });
        refreshConnections();
        liveId = await backend.connect(targetId);
        notify.info(`${existing.name}: credentials updated from the container env`);
      }
      markConnected(targetId);
      const dbTables = await backend.listTables(liveId);
      const first = dbTables.find((t) => t.type === "table") ?? dbTables[0];
      if (first) openTable(targetId, first.schema, first.name);
      notify.success(`Connected to ${dc.name}`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectingDocker((s) => {
        const next = new Set(s);
        next.delete(dc.id);
        return next;
      });
    }
  };

  const renderDockerContainer = ({
    container: dc,
    match,
  }: {
    container: DockerContainer;
    match: Connection | null;
  }) => {
    const connecting = connectingDocker.has(dc.id);
    const matchConnected = match ? connectedIds.has(match.id) : false;
    const hostPort = dc.port != null ? `${dc.host}:${dc.port}` : dc.host;
    const menu: MenuEntry[] = [
      { label: "Connect", onSelect: () => void connectDockerContainer(dc) },
      ...(match
        ? [
            {
              label: "Edit Linked Connection…",
              icon: <Pencil size={13} />,
              onSelect: () => openConnection(match.id),
            } satisfies MenuEntry,
          ]
        : []),
      { type: "separator" },
      { label: "Copy Host", onSelect: () => copyToClipboard(hostPort, hostPort) },
    ];
    return (
      <ContextMenu key={dc.id} items={menu}>
      <button
        title={`${dc.image} · ${dc.status}${match ? ` · linked to ${match.name}` : ""}`}
        disabled={connecting}
        className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left font-mono text-md text-text-secondary transition-colors duration-100 ease-out hover:bg-bg-hover disabled:opacity-60"
        onClick={() => void connectDockerContainer(dc)}
      >
        <Container size={13} className="shrink-0 text-docker" />
        <span className="truncate">{dc.name}</span>
        <Badge tone="neutral" className="font-mono uppercase tracking-wide text-docker">
          Docker
        </Badge>
        {dc.port != null && (
          <span className="shrink-0 text-xs tabular-nums text-text-muted">:{dc.port}</span>
        )}
        {connecting ? (
          <Loader2 size={12} className="ml-auto shrink-0 animate-spin text-text-muted" />
        ) : (
          <span
            className={cn(
              "ml-auto h-1.5 w-1.5 shrink-0 rounded-full",
              // green when its saved connection is live, docker-blue when it's a
              // known-but-idle connection, hollow when not yet saved.
              matchConnected ? "bg-success" : match ? "bg-docker/60" : "bg-text-muted/40"
            )}
          />
        )}
      </button>
      </ContextMenu>
    );
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
        {/* Custom env tag (mock) takes priority; otherwise a neutral engine badge. */}
        <Badge
          tone={c.tag ? TAG_TONE[c.tagColor ?? "neutral"] : "neutral"}
          className="ml-auto font-mono uppercase tracking-wide"
        >
          {c.tag ?? KIND_BADGE[c.kind]}
        </Badge>
        {connectingIds.has(c.id) ? (
          <Loader2 size={12} className="ml-1.5 shrink-0 animate-spin text-text-muted" />
        ) : (
          <span
            className={cn(
              "ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              connectedIds.has(c.id) ? "bg-success" : "bg-text-muted/40"
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

      {/* DOCKER (auto-detected running DB containers) */}
      {dockerToShow.length > 0 &&
        (() => {
          const id = "docker-section";
          const open = !explorerCollapsed[id];
          return (
            <>
              <div className="mt-3 flex items-center justify-between px-3 pb-1">
                <button
                  className="flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-wide text-text-muted transition-colors duration-100 ease-out hover:text-text-secondary"
                  onClick={() => toggleGroup(id)}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Container size={12} className="text-docker" />
                  Docker
                </button>
                <span className="font-mono text-xs tabular-nums text-text-muted">
                  {dockerToShow.length}
                </span>
              </div>
              {open && <div className="px-1.5">{dockerToShow.map(renderDockerContainer)}</div>}
            </>
          );
        })()}

      {/* FAVORITES */}
      <div className="mt-3 flex items-center justify-between px-3 pb-1">
        <span className="font-sans text-xs font-semibold uppercase tracking-wide text-text-muted">
          Favorites
        </span>
        <span className="font-mono text-xs tabular-nums text-text-muted">
          {favoriteTables.length || ""}
        </span>
      </div>
      <div className="px-1.5">
        {favoriteTables.length > 0 ? (
          favoriteTables.map((t) => (
            <FavoriteTableRow
              key={`${t.schema}.${t.name}`}
              table={t}
              activeTable={activeTable}
              onOpenTable={(table) =>
                activeConnectionId && openTable(activeConnectionId, table.schema, table.name)
              }
              onOpenGraph={(table) =>
                activeConnectionId && openGraph(activeConnectionId, table.schema, table.name, table.schema)
              }
              onToggleFavorite={(table) =>
                activeConnectionId &&
                toggleTableFavorite(activeConnectionId, table.schema, table.name)
              }
              isFavorite={(table) =>
                isTableFavorite(activeConnectionId, table.schema, table.name)
              }
            />
          ))
        ) : (
          <div className="px-2 py-1 font-sans text-xs text-text-muted">
            No favorites.
          </div>
        )}
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
                      onToggleFavorite={(t) =>
                        activeConnectionId &&
                        toggleTableFavorite(activeConnectionId, t.schema, t.name)
                      }
                      isFavorite={(t) =>
                        isTableFavorite(activeConnectionId, t.schema, t.name)
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
  onToggleFavorite,
  isFavorite,
}: {
  node: ExplorerNode;
  collapsedMap: Record<string, boolean>;
  activeTable: { schema: string; table: string } | null;
  onToggleGroup: (id: string) => void;
  onOpenTable: (t: TableSummary) => void;
  onOpenGraph: (t: TableSummary) => void;
  onToggleFavorite: (t: TableSummary) => void;
  isFavorite: (t: TableSummary) => boolean;
}) {
  const isActiveTable = (t: TableSummary) =>
    !!activeTable && activeTable.schema === t.schema && activeTable.table === t.name;
  if (node.kind === "table") {
    const t = node.table;
    const rows = formatRowEstimate(t.rowEstimate);
    const active = isActiveTable(t);
    return (
      <ContextMenu items={tableMenu(t, { onOpenTable, onOpenGraph, onToggleFavorite, isFavorite })}>
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
          {isFavorite(t) && <Star size={11} className="shrink-0 fill-current text-accent" />}
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
                items={tableMenu(child.table, {
                  onOpenTable,
                  onOpenGraph,
                  onToggleFavorite,
                  isFavorite,
                })}
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
                  {isFavorite(child.table) && (
                    <Star size={11} className="shrink-0 fill-current text-accent" />
                  )}
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

function FavoriteTableRow({
  table,
  activeTable,
  onOpenTable,
  onOpenGraph,
  onToggleFavorite,
  isFavorite,
}: {
  table: TableSummary;
  activeTable: { schema: string; table: string } | null;
  onOpenTable: (t: TableSummary) => void;
  onOpenGraph: (t: TableSummary) => void;
  onToggleFavorite: (t: TableSummary) => void;
  isFavorite: (t: TableSummary) => boolean;
}) {
  const active =
    !!activeTable && activeTable.schema === table.schema && activeTable.table === table.name;
  const rows = formatRowEstimate(table.rowEstimate);
  return (
    <ContextMenu items={tableMenu(table, { onOpenTable, onOpenGraph, onToggleFavorite, isFavorite })}>
      <button
        className={cn(
          "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md transition-colors duration-100 ease-out hover:bg-bg-hover",
          active && "bg-accent-subtle"
        )}
        onClick={() => onOpenTable(table)}
      >
        <Star size={12} className="shrink-0 fill-current text-accent" />
        <span className={cn("truncate", active ? "text-text-primary" : "text-text-secondary")}>
          {table.name}
        </span>
        <span className="shrink-0 text-xs text-text-muted">{table.schema}</span>
        {rows && <span className="ml-auto text-xs tabular-nums text-text-muted">{rows}</span>}
      </button>
    </ContextMenu>
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
