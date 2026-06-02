import { Dialog, Switch, SegmentedControl, Button } from "@/ui";
import { useUiStore } from "@/store/ui";
import { useThemeStore } from "@/store/theme";
import { useUiScaleStore } from "@/store/uiScale";

/**
 * Minimal settings dialog (⌘,). A placeholder for the persisted settings store
 * SlashTable carries; for now it exposes the three settings already wired in
 * this fork: theme, UI scale, and a vim-mode stub (persisted, not yet consumed
 * by the editor).
 */
export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const vimMode = useUiStore((s) => s.vimMode);
  const setVimMode = useUiStore((s) => s.setVimMode);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.set);

  const scale = useUiScaleStore((s) => s.scale);
  const zoomIn = useUiScaleStore((s) => s.zoomIn);
  const zoomOut = useUiScaleStore((s) => s.zoomOut);
  const reset = useUiScaleStore((s) => s.reset);

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Settings">
      <div className="flex flex-col gap-4">
        <Row label="Theme" hint="Color scheme for the whole app.">
          <SegmentedControl
            value={theme}
            onValueChange={(v) => setTheme(v as "dark" | "light")}
            items={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </Row>

        <Row label="UI Scale" hint="Zoom the entire interface.">
          <div className="flex items-center gap-1.5">
            <Button variant="subtle" size="sm" onClick={zoomOut} aria-label="Zoom out">
              −
            </Button>
            <span className="w-12 text-center font-mono text-md tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <Button variant="subtle" size="sm" onClick={zoomIn} aria-label="Zoom in">
              +
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
        </Row>

        <Row label="Vim Mode" hint="Vim keybindings in the SQL editor (stub).">
          <Switch checked={vimMode} onCheckedChange={setVimMode} aria-label="Vim mode" />
        </Row>
      </div>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-md text-text-primary">{label}</div>
        {hint && <div className="mt-0.5 text-sm text-text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
