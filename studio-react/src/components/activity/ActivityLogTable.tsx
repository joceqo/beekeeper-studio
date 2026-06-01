import { useState } from "react";
import { useActivityStore, type ActivityCategory } from "@/store/activity";
import { cn } from "@/lib/cn";

const CAT_COLOR: Record<ActivityCategory, string> = {
  SQL: "bg-info/15 text-info",
  App: "bg-bg-tertiary text-text-secondary",
  MCP: "bg-accent/15 text-accent",
  User: "bg-success/15 text-success",
  System: "bg-warning/15 text-warning",
  Connections: "bg-docker/15 text-docker",
};

const COLS = "120px 64px 90px 110px 150px 1fr 70px 56px";

export function ActivityLogTable() {
  const entries = useActivityStore((s) => s.entries);
  const active = useActivityStore((s) => s.activeCategory);
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = entries.filter((e) => e.category === active).slice().reverse();

  return (
    <div className="flex h-full flex-col text-sm">
      {/* header */}
      <div
        className="grid shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted"
        style={{ gridTemplateColumns: COLS }}
      >
        <span>Time</span>
        <span>Ctg</span>
        <span>Op</span>
        <span>Connection</span>
        <span>Tables</span>
        <span>SQL</span>
        <span className="text-right">Dur</span>
        <span className="text-right">Rows</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && (
          <div className="px-3 py-4 text-xs text-text-muted">
            No {active} activity yet.
          </div>
        )}
        {rows.map((e) => {
          const isOpen = expanded === e.id;
          return (
            <div
              key={e.id}
              onClick={() => setExpanded(isOpen ? null : e.id)}
              className="cursor-pointer border-b border-border/40 hover:bg-bg-hover"
            >
              <div
                className="grid items-center gap-2 px-3 py-1"
                style={{ gridTemplateColumns: COLS }}
              >
                <span className="font-mono text-text-muted">{e.time}</span>
                <span
                  className={cn(
                    "w-fit rounded-sm px-1.5 py-px text-xs font-medium",
                    CAT_COLOR[e.category]
                  )}
                >
                  {e.category}
                </span>
                <span className="font-mono text-text-secondary">{e.op}</span>
                <span className="truncate text-text-secondary">{e.connection}</span>
                <span className="truncate font-mono text-text-muted">{e.tables}</span>
                <span
                  className={cn(
                    "font-mono text-text-secondary",
                    isOpen ? "whitespace-pre-wrap break-all" : "truncate"
                  )}
                >
                  {e.sql}
                </span>
                <span className="text-right font-mono text-text-muted">
                  {(e.durationMs / 1000).toFixed(2)}s
                </span>
                <span className="text-right font-mono text-text-secondary">
                  {e.rows ?? "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
