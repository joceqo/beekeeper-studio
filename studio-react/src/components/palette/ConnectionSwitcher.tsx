import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Database, Check } from "lucide-react";
import { BaseDialog } from "@/ui/Dialog";
import { cn } from "@/ui";
import { useUiStore } from "@/store/ui";
import { useSidebarStore } from "@/store/sidebar";
import { backend, type Connection } from "@/ipc";
import { fuzzyScore } from "@/lib/fuzzy";

/**
 * ⌘D connection switcher. A filterable list of saved connections; selecting one
 * sets it active in the sidebar store (which drives the explorer + new tabs).
 * Mirrors the command-palette interaction model (arrows + Enter + Esc).
 */
export function ConnectionSwitcher() {
  const open = useUiStore((s) => s.dbSwitcherOpen);
  const setOpen = useUiStore((s) => s.setDbSwitcherOpen);
  const activeId = useSidebarStore((s) => s.activeConnectionId);
  const setActive = useSidebarStore((s) => s.setActiveConnection);
  const toggleConnection = useSidebarStore((s) => s.toggleConnection);
  const expanded = useSidebarStore((s) => s.expandedConnections);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    backend.listConnections().then(setConnections).catch(() => setConnections([]));
  }, [open]);

  const filtered = useMemo(() => {
    return connections
      .map((c) => ({ c, score: fuzzyScore(query, `${c.name} ${c.host ?? ""} ${c.tag ?? ""}`) }))
      .filter((x): x is { c: Connection; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [connections, query]);

  useEffect(() => {
    setActiveIdx((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function select(c: Connection) {
    setActive(c.id);
    if (!expanded[c.id]) toggleConnection(c.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[active];
      if (c) select(c);
    }
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={setOpen}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            "fixed left-1/2 top-[18%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg-secondary text-md text-text-primary shadow-xl shadow-black/40 outline-none",
            "transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          )}
          initialFocus={inputRef}
          onKeyDown={onKeyDown}
        >
          <BaseDialog.Title className="sr-only">Switch Connection</BaseDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={15} className="shrink-0 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              placeholder="Switch connection…"
              className="h-11 w-full bg-transparent text-md text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          <div ref={listRef} className="max-h-80 overflow-auto p-1.5">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-text-muted">
                No connections
              </div>
            )}
            {filtered.map((c, idx) => (
              <button
                key={c.id}
                data-idx={idx}
                onMouseMove={() => setActiveIdx(idx)}
                onClick={() => select(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left font-mono outline-none",
                  idx === active ? "bg-bg-hover text-text-primary" : "text-text-secondary"
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {c.paint ? (
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.paint }} />
                  ) : (
                    <Database size={14} className={idx === active ? "text-accent" : "text-text-muted"} />
                  )}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                {c.host && <span className="truncate text-xs text-text-muted">{c.host}</span>}
                {c.id === activeId && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
