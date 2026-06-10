import { useEffect, useState } from "react";
import { BrainCircuit, Database, Copy } from "lucide-react";
import { useStatusStore } from "@/store/status";
import { useActivityStore } from "@/store/activity";
import { useLayoutStore } from "@/store/layout";
import { backend, type McpStatus } from "@/ipc";
import { Popover, Button, cn, notify } from "@/ui";
import { copyText } from "@/lib/clipboard";

const VERSION = "v5.8.2";

/** Copy text to the clipboard and report the outcome. */
function copy(text: string) {
  copyText(text).then((ok) =>
    ok ? notify.success("Copied MCP config") : notify.error("Copy failed")
  );
}

/** A labeled key/value row in the MCP popover. */
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="font-mono text-[15px] tabular-nums text-text-primary">
        {children}
      </span>
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
    ? JSON.stringify({ beetable: { type: "http", url: status.url } }, null, 2)
    : "";
  // Full host:port (e.g. 127.0.0.1:27500), matching SlashTable's MCP panel.
  const hostPort = status?.url ? new URL(status.url).host : "—";

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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        MCP Server
      </div>
      <div className="divide-y divide-border/60">
        <StatRow label="Port">{hostPort}</StatRow>
        <StatRow label="Requests">
          {status?.requests ?? 0} total
          {status && status.errors > 0 && (
            <span className="text-danger"> · {status.errors} err</span>
          )}
        </StatRow>
        <StatRow label="Last call">
          {status?.lastCall
            ? `${status.lastCall.name} · ${status.lastCall.durationMs}ms`
            : "—"}
        </StatRow>
      </div>

      {status && status.writeConnections.length > 0 && (
        <div className="mt-2 border-t border-border pt-2.5">
          <div className="flex items-center gap-1.5 text-warning">
            <Database size={13} className="shrink-0" />
            <span>
              {status.writeConnections.length} connection
              {status.writeConnections.length === 1 ? " allows" : "s allow"} writes
            </span>
          </div>
          <div className="mt-1 font-mono text-text-secondary">
            {status.writeConnections.join(", ")}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-col border-t border-border pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={!config}
          onClick={() => copy(config)}
        >
          Copy config
          <Copy size={13} className="text-text-muted" />
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
