import { useEffect, useState } from "react";
import { Sun, Moon, Settings, Command, Database, Loader2, ChevronsUpDown } from "lucide-react";
import { TabStrip } from "./TabStrip";
import { useThemeStore } from "@/store/theme";
import { useUiStore } from "@/store/ui";
import { useSidebarStore } from "@/store/sidebar";
import { backend, type Connection } from "@/ipc";
import { IconButton, Tooltip, cn } from "@/ui";

/** Active connection / database indicator (SlashTable's "name / db ⌘d"). */
function ConnectionIndicator() {
  const activeId = useSidebarStore((s) => s.activeConnectionId);
  const connectedIds = useSidebarStore((s) => s.connectedIds);
  const connectingIds = useSidebarStore((s) => s.connectingIds);
  const revision = useSidebarStore((s) => s.connectionsRevision);
  const openSwitcher = useUiStore((s) => s.setDbSwitcherOpen);

  const [conns, setConns] = useState<Connection[]>([]);
  useEffect(() => {
    backend.listConnections().then(setConns).catch(() => {});
  }, [revision, activeId]);

  const active = conns.find((c) => c.id === activeId);
  const connecting = activeId != null && connectingIds.has(activeId);
  const connected = activeId != null && connectedIds.has(activeId);

  return (
    <button
      onClick={() => openSwitcher(true)}
      title="Switch connection  ⌘D"
      className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-md hover:bg-bg-hover"
    >
      {connecting ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-text-muted" />
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            connected ? "bg-success" : "bg-text-muted/40"
          )}
        />
      )}
      <Database size={13} className="shrink-0 text-text-muted" />
      <span className="max-w-[220px] truncate font-mono">
        {active ? (
          <>
            <span className="text-text-primary">{active.name}</span>
            {active.database && <span className="text-text-muted"> / {active.database}</span>}
          </>
        ) : (
          <span className="text-text-muted">No connection</span>
        )}
      </span>
      <ChevronsUpDown size={12} className="shrink-0 text-text-muted" />
    </button>
  );
}

export function TitleBar() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const openPalette = useUiStore((s) => s.setPaletteOpen);
  const openSettings = useUiStore((s) => s.setSettingsOpen);

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-bg-secondary">
      {/* macOS traffic-light inset */}
      <div className="flex w-[74px] shrink-0 items-center gap-2 pl-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      </div>

      <ConnectionIndicator />

      <TabStrip />

      <div className="flex shrink-0 items-center gap-0.5 px-2">
        <Tooltip content="Command palette  ⌘K">
          <IconButton size="lg" onClick={() => openPalette(true)} aria-label="Command palette">
            <Command size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip content={theme === "dark" ? "Switch to light" : "Switch to dark"}>
          <IconButton size="lg" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
        </Tooltip>
        <Tooltip content="Settings  ⌘,">
          <IconButton size="lg" onClick={() => openSettings(true)} aria-label="Settings">
            <Settings size={15} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
