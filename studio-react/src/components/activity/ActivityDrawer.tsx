import { useCallback, useRef } from "react";
import { useLayoutStore } from "@/store/layout";
import { ActivityLogTable } from "./ActivityLogTable";

/**
 * The Activity log body — a full-width overlay that opens above the always-on
 * ActivityPanel tab bar (SlashTable's bottom log dock: `absolute left-0 right-0`).
 * Its height is user-resizable via a drag handle on its top edge, persisted in
 * the layout store. Rendered by App.tsx only when the drawer is open.
 */
export function ActivityDrawer() {
  const height = useLayoutStore((s) => s.activityHeight);
  const setActivityHeight = useLayoutStore((s) => s.setActivityHeight);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag.current) return;
      // Dragging up (smaller clientY) grows the drawer.
      setActivityHeight(drag.current.startH + (drag.current.startY - e.clientY));
    },
    [setActivityHeight]
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      drag.current = { startY: e.clientY, startH: height };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [height, onPointerMove, endDrag]
  );

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col border-t border-border bg-bg-secondary shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{ height }}
    >
      {/* top resize handle */}
      <div
        onPointerDown={onPointerDown}
        className="group absolute inset-x-0 -top-0.5 h-1 cursor-row-resize"
        aria-label="Resize activity log"
      >
        <span className="absolute inset-x-0 top-0.5 h-px bg-transparent group-hover:bg-accent" />
      </div>
      <div className="min-h-0 flex-1">
        <ActivityLogTable />
      </div>
    </div>
  );
}
