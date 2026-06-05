import { X, Plus, Table2, FileCode, Database, Workflow, Spline } from "lucide-react";
import { useTabsStore, type Tab } from "@/store/tabs";
import { useCommands } from "@/lib/commands";
import { cn, IconButton, Menu } from "@/ui";

function TabIcon({ kind }: { kind: Tab["kind"] }) {
  if (kind === "query") return <FileCode size={12} />;
  if (kind === "connection") return <Database size={12} />;
  if (kind === "graph") return <Workflow size={12} />;
  if (kind === "relation") return <Spline size={12} />;
  return <Table2 size={12} />;
}

export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const close = useTabsStore((s) => s.close);
  const { run } = useCommands();

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <div className="flex min-w-0 items-center overflow-x-auto">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "group relative flex h-8 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-md transition-colors duration-100 ease-out",
                active
                  ? "bg-bg-primary text-text-primary"
                  : "bg-bg-secondary text-text-muted hover:bg-bg-hover hover:text-text-secondary"
              )}
            >
              {active && (
                <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />
              )}
              <span className={cn("shrink-0", active ? "text-accent" : "text-text-muted")}>
                <TabIcon kind={t.kind} />
              </span>
              <span className="truncate font-mono">{t.title}</span>
              <IconButton
                size="sm"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
                className="-mr-1 ml-auto text-text-muted opacity-0 hover:bg-bg-tertiary hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </IconButton>
            </div>
          );
        })}
      </div>
      <Menu
        align="start"
        trigger={
          <IconButton
            size="lg"
            aria-label="New tab"
            className="ml-0.5 h-8 w-8 shrink-0 rounded-none text-text-muted"
          >
            <Plus size={15} />
          </IconButton>
        }
        items={[
          {
            label: "Explorer Tab",
            kbd: "⌘⇧E",
            icon: <Table2 size={14} />,
            onSelect: () => run("core.new-explorer-tab"),
          },
          {
            label: "Graph Tab",
            kbd: "⌘⇧G",
            icon: <Workflow size={14} />,
            onSelect: () => run("core.schema-graph"),
          },
          {
            label: "SQL Tab",
            kbd: "⌘T",
            icon: <FileCode size={14} />,
            onSelect: () => run("core.new-sql-tab"),
          },
        ]}
      />
    </div>
  );
}
