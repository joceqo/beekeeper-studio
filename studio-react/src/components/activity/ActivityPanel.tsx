import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  ACTIVITY_CATEGORIES,
  useActivityStore,
  type ActivityCategory,
} from "@/store/activity";
import { cn } from "@/lib/cn";
import { ActivityLogTable } from "./ActivityLogTable";

export function ActivityPanel() {
  const collapsed = useActivityStore((s) => s.collapsed);
  const height = useActivityStore((s) => s.height);
  const active = useActivityStore((s) => s.activeCategory);
  const unseen = useActivityStore((s) => s.unseen);
  const setCategory = useActivityStore((s) => s.setCategory);
  const toggleCollapsed = useActivityStore((s) => s.toggleCollapsed);
  const setHeight = useActivityStore((s) => s.setHeight);
  const clear = useActivityStore((s) => s.clear);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => setHeight(startH + (startY - ev.clientY));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg-secondary">
      {!collapsed && (
        <div
          className="h-1 cursor-row-resize bg-transparent hover:bg-accent/40"
          onMouseDown={startResize}
        />
      )}
      {/* header / tab bar */}
      <div className="flex h-8 items-center gap-0.5 px-1.5">
        <button
          onClick={toggleCollapsed}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
          title={collapsed ? "Expand activity" : "Collapse activity"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Activity
        </span>
        {ACTIVITY_CATEGORIES.map((c: ActivityCategory) => {
          const isActive = c === active;
          const count = unseen[c];
          return (
            <button
              key={c}
              onClick={() => {
                setCategory(c);
                if (collapsed) toggleCollapsed();
              }}
              className={cn(
                "relative flex h-8 items-center gap-1.5 px-2.5 text-md",
                isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {c}
              {count > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-text-on-accent">
                  {count}
                </span>
              )}
              {isActive && <span className="absolute inset-x-1 bottom-0 h-0.5 bg-accent" />}
            </button>
          );
        })}
        <button
          onClick={clear}
          className="ml-auto flex items-center gap-1 rounded-sm px-2 py-1 text-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
          title="Clear current category"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      {!collapsed && (
        <div style={{ height }} className="border-t border-border">
          <ActivityLogTable />
        </div>
      )}
    </div>
  );
}
