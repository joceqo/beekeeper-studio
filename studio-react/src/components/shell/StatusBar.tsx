import { useEffect, useState } from "react";
import { BrainCircuit, AlertTriangle } from "lucide-react";
import { useStatusStore } from "@/store/status";
import { useActivityStore } from "@/store/activity";
import { useLayoutStore } from "@/store/layout";
import { backend, type McpStatus } from "@/ipc";
import { Popover, Button, cn } from "@/ui";

const VERSION = "v5.8.0";

/** Copy text to the clipboard (best-effort, async). */
function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

/** A labeled key/value row in the MCP popover. */
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono tabular-nums text-text-primary">{children}</span>
    </div>
  );
}

function McpPopover() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const setCategory = useActivityStore((s) => s.setCategory);
  const activityCollapsed = useLayoutStore((s) => s.activityCollapsed);
  const toggle = useLayoutStore((s) => s.toggle);

  // Poll the live status only while the popover is open (plus once on open).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = () =>
      backend
        .getMcpStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [open]);

  const running = status?.running ?? false;
  const config = status?.url
    ? JSON.stringify({ beekeeper: { type: "http", url: status.url } }, null, 2)
    : "";

  const trigger = (
    <button
      title="MCP Server"
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
    >
      <BrainCircuit size={13} />
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          running ? "bg-success" : "bg-text-muted/40"
        )}
      />
    </button>
  );

  return (
    <Popover trigger={trigger} side="top" align="end" className="w-72" open={open} onOpenChange={setOpen}>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        MCP Server
      </div>
      <StatRow label="Port">{status?.url ? `${status.port ?? "—"}` : "—"}</StatRow>
      <StatRow label="Requests">
        {status?.requests ?? 0} total
        {status && status.errors > 0 && (
          <span className="text-danger"> · {status.errors} err</span>
        )}
      </StatRow>
      <StatRow label="Last call">
        {status?.lastCall ? `${status.lastCall.name} · ${status.lastCall.durationMs}ms` : "—"}
      </StatRow>

      {status && status.writeConnections.length > 0 && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-border bg-bg-primary/40 px-2 py-1.5 text-text-secondary">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
          <span>
            {status.writeConnections.length} connection
            {status.writeConnections.length > 1 ? "s" : ""} allow writes
            <span className="block font-mono text-text-muted">
              {status.writeConnections.join(", ")}
            </span>
          </span>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={!config}
          onClick={() => copy(config)}
        >
          Copy config
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            setCategory("MCP");
            if (activityCollapsed) toggle("activity");
            setOpen(false);
          }}
        >
          View logs
        </Button>
      </div>
    </Popover>
  );
}

export function StatusBar() {
  const { elapsedMs, loaded, total } = useStatusStore();
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-xs text-text-muted">
      <span>Free — Personal Use</span>
      <div className="flex items-center gap-2.5">
        <span className="font-mono tabular-nums">
          {(elapsedMs / 1000).toFixed(2)}s · {loaded} loaded / ~{total} total
        </span>
        <span className="h-3 w-px bg-border" />
        <McpPopover />
        <span className="h-3 w-px bg-border" />
        <span className="font-mono text-text-muted/80">{VERSION}</span>
      </div>
    </div>
  );
}
