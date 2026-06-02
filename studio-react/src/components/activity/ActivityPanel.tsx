import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  ACTIVITY_CATEGORIES,
  useActivityStore,
  type ActivityCategory,
} from "@/store/activity";
import { useLayoutStore } from "@/store/layout";
import { cn, IconButton, Button, Badge } from "@/ui";
import { ActivityLogTable } from "./ActivityLogTable";

/**
 * The Activity log. It lives in a collapsible Panel (vertical group in
 * App.tsx); the panel owns sizing + collapse, so this component no longer
 * hand-rolls a height/resize. The collapse toggle drives the panel via the
 * layout store's imperative API.
 */
export function ActivityPanel() {
  const active = useActivityStore((s) => s.activeCategory);
  const unseen = useActivityStore((s) => s.unseen);
  const setCategory = useActivityStore((s) => s.setCategory);
  const clear = useActivityStore((s) => s.clear);

  const collapsed = useLayoutStore((s) => s.activityCollapsed);
  const toggle = useLayoutStore((s) => s.toggle);
  const expandActivity = () => {
    if (collapsed) toggle("activity");
  };

  return (
    <div className="flex h-full flex-col border-t border-border bg-bg-secondary">
      {/* header / tab bar */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 px-1.5">
        <IconButton
          onClick={() => toggle("activity")}
          aria-label={collapsed ? "Expand activity" : "Collapse activity"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </IconButton>
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
                expandActivity();
              }}
              className={cn(
                "relative flex h-8 items-center gap-1.5 px-2.5 text-md",
                isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {c}
              {count > 0 && (
                <Badge tone="accent" className="rounded-full bg-accent px-1 text-[9px] text-text-on-accent">
                  {count}
                </Badge>
              )}
              {isActive && <span className="absolute inset-x-1 bottom-0 h-0.5 bg-accent" />}
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={clear}
          title="Clear current category"
        >
          <Trash2 size={12} />
          Clear
        </Button>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 border-t border-border">
          <ActivityLogTable />
        </div>
      )}
    </div>
  );
}
