import { useStatusStore } from "@/store/status";

const VERSION = "v5.8.0";

export function StatusBar() {
  const { elapsedMs, loaded, total } = useStatusStore();
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-xs text-text-muted">
      <span>Free — Personal Use</span>
      <div className="flex items-center gap-3">
        <span className="font-mono">
          {(elapsedMs / 1000).toFixed(2)}s · {loaded} loaded / ~{total} total
        </span>
        <span>{VERSION}</span>
      </div>
    </div>
  );
}
