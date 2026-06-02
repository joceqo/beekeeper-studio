import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { BaseDialog } from "@/ui/Dialog";
import { Kbd, cn } from "@/ui";
import { useUiStore } from "@/store/ui";
import { useCommands, type CommandDef, type CommandGroup } from "@/lib/commands";
import { fuzzyScore } from "@/lib/fuzzy";

const GROUP_ORDER: CommandGroup[] = [
  "Navigate",
  "Connection",
  "Tabs",
  "View",
  "Table",
  "App",
];

/**
 * ⌘K command palette. A modal (Base UI Dialog) with a fuzzy-filtered, grouped
 * command list; arrow keys move the highlight, Enter runs, Esc closes. Each row
 * shows the command label + its `Kbd` shortcut. Disabled (out-of-context)
 * commands are hidden. Styled with the design tokens; labels in mono to match
 * SlashTable's command surfaces.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const { commands, run } = useCommands();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset query + selection whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Filter (hide out-of-context commands) + fuzzy-rank, then group.
  const filtered = useMemo(() => {
    const scored = commands
      .filter((c) => c.enabled !== false && c.id !== "core.palette")
      .map((c) => ({ cmd: c, score: fuzzyScore(query, c.label) }))
      .filter((x): x is { cmd: CommandDef; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.cmd);
  }, [commands, query]);

  // A flat, render-ordered list (grouped) used for keyboard navigation.
  const ordered = useMemo(() => {
    if (query.trim()) return filtered; // search ignores grouping, ranks by score
    const byGroup = new Map<CommandGroup, CommandDef[]>();
    for (const c of filtered) {
      const arr = byGroup.get(c.group) ?? [];
      arr.push(c);
      byGroup.set(c.group, arr);
    }
    const out: CommandDef[] = [];
    for (const g of GROUP_ORDER) out.push(...(byGroup.get(g) ?? []));
    return out;
  }, [filtered, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, ordered.length - 1)));
  }, [ordered.length]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = ordered[active];
      if (cmd) {
        setOpen(false);
        // Defer so the dialog has closed before the command (which may open
        // another overlay) runs.
        requestAnimationFrame(() => run(cmd.id));
      }
    }
  }

  // Render either a flat ranked list (when searching) or grouped sections.
  const showGroups = !query.trim();

  return (
    <BaseDialog.Root open={open} onOpenChange={setOpen}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            "fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg-secondary text-md text-text-primary shadow-xl shadow-black/40 outline-none",
            "transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          )}
          initialFocus={inputRef}
          onKeyDown={onKeyDown}
        >
          <BaseDialog.Title className="sr-only">Command Palette</BaseDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={15} className="shrink-0 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Type a command…"
              className="h-11 w-full bg-transparent text-md text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          <div ref={listRef} className="max-h-80 overflow-auto p-1.5">
            {ordered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-text-muted">
                No matching commands
              </div>
            )}

            {showGroups
              ? GROUP_ORDER.map((group) => {
                  const items = ordered.filter((c) => c.group === group);
                  if (items.length === 0) return null;
                  return (
                    <div key={group} className="mb-1">
                      <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {group}
                      </div>
                      {items.map((cmd) => (
                        <Row
                          key={cmd.id}
                          cmd={cmd}
                          idx={ordered.indexOf(cmd)}
                          active={ordered.indexOf(cmd) === active}
                          onHover={setActive}
                          onRun={(id) => {
                            setOpen(false);
                            requestAnimationFrame(() => run(id));
                          }}
                        />
                      ))}
                    </div>
                  );
                })
              : ordered.map((cmd, idx) => (
                  <Row
                    key={cmd.id}
                    cmd={cmd}
                    idx={idx}
                    active={idx === active}
                    onHover={setActive}
                    onRun={(id) => {
                      setOpen(false);
                      requestAnimationFrame(() => run(id));
                    }}
                  />
                ))}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

function Row({
  cmd,
  idx,
  active,
  onHover,
  onRun,
}: {
  cmd: CommandDef;
  idx: number;
  active: boolean;
  onHover: (idx: number) => void;
  onRun: (id: string) => void;
}) {
  const Icon = cmd.icon;
  return (
    <button
      data-idx={idx}
      onMouseMove={() => onHover(idx)}
      onClick={() => onRun(cmd.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left font-mono outline-none",
        active ? "bg-bg-hover text-text-primary" : "text-text-secondary"
      )}
    >
      {Icon && (
        <span className={cn("flex w-4 shrink-0 justify-center", active ? "text-accent" : "text-text-muted")}>
          <Icon size={14} />
        </span>
      )}
      <span className="flex-1 truncate">{cmd.label}</span>
      {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
    </button>
  );
}
