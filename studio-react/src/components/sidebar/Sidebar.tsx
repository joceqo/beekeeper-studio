import { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Search,
  Database,
  Table2,
  Eye,
  Layers,
  PanelLeftClose,
  Plus,
  Workflow,
} from "lucide-react";
import { backend, type Connection, type TableSummary } from "@/ipc";
import { useSidebarStore } from "@/store/sidebar";
import { useTabsStore } from "@/store/tabs";
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
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const activeConnectionId = useSidebarStore((s) => s.activeConnectionId);
  const setActiveConnection = useSidebarStore((s) => s.setActiveConnection);
  const expanded = useSidebarStore((s) => s.expandedConnections);
  const toggleConnection = useSidebarStore((s) => s.toggleConnection);

  const openTable = useTabsStore((s) => s.openTable);
  const openConnection = useTabsStore((s) => s.openConnection);
  const openGraph = useTabsStore((s) => s.openGraph);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    backend.listConnections().then((conns) => {
      setConnections(conns);
      // If the active connection isn't in the list (e.g. real MCP ids differ
      // from the mock defaults), select the first one so tables can load.
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
    // connectionId before listTables fires — otherwise the first call can go
    // out with an unresolved id and fail.
    backend
      .connect(activeConnectionId)
      .then((liveId) => backend.listTables(liveId))
      .then((t) => {
        if (!cancelled) setTables(t);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-secondary py-2">
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

  const filtered = tables.filter((t) =>
    `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col border-r border-border bg-bg-secondary">
      {/* CONNECTIONS */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
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
        {connections.map((c) => {
          const isActive = c.id === activeConnectionId;
          const isOpen = expanded[c.id];
          return (
            <div key={c.id}>
              <button
                className={cn(
                  "flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-md hover:bg-bg-hover",
                  isActive && "bg-bg-active"
                )}
                onClick={() => {
                  setActiveConnection(c.id);
                  toggleConnection(c.id);
                }}
              >
                {isOpen ? (
                  <ChevronDown size={13} className="text-text-muted" />
                ) : (
                  <ChevronRight size={13} className="text-text-muted" />
                )}
                <Database
                  size={13}
                  className={cn(isActive ? "text-accent" : "text-text-muted")}
                />
                <span className="truncate">{c.name}</span>
                {c.tag && (
                  <Badge tone={TAG_TONE[c.tagColor ?? "neutral"]} className="ml-auto">
                    {c.tag}
                  </Badge>
                )}
                <span
                  className={cn(
                    "ml-auto h-1.5 w-1.5 shrink-0 rounded-full",
                    c.connected ? "bg-success" : "bg-bg-tertiary",
                    c.tag && "ml-1.5"
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>

      {/* TABLES */}
      <div className="mt-3 flex items-center justify-between px-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Tables
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
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {filtered.map((t) => (
          <button
            key={`${t.schema}.${t.name}`}
            className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-md hover:bg-bg-hover"
            onClick={() => activeConnectionId && openTable(activeConnectionId, t.schema, t.name)}
          >
            <TableIcon type={t.type} />
            <span className="truncate text-text-secondary">{t.name}</span>
            {t.schema !== "public" && (
              <span className="ml-auto text-xs text-text-muted">{t.schema}</span>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-2 py-3 text-xs text-text-muted">No tables match.</div>
        )}
      </div>
    </div>
  );
}
