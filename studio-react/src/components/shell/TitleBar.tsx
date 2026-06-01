import { Sun, Moon, Settings } from "lucide-react";
import { TabStrip } from "./TabStrip";
import { useThemeStore } from "@/store/theme";

export function TitleBar() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-bg-secondary">
      {/* macOS traffic-light inset */}
      <div className="flex w-[74px] shrink-0 items-center gap-2 pl-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      </div>

      <TabStrip />

      <div className="flex shrink-0 items-center gap-0.5 px-2">
        <button
          onClick={toggle}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
          title="Settings"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
