import { TitleBar } from "@/components/shell/TitleBar";
import { MainContent } from "@/components/shell/MainContent";
import { StatusBar } from "@/components/shell/StatusBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { useSidebarStore } from "@/store/sidebar";
import { TooltipProvider, Toaster } from "@/ui";

export default function App() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const width = useSidebarStore((s) => s.width);
  const setWidth = useSidebarStore((s) => s.setWidth);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => setWidth(startW + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary text-text-primary">
        <TitleBar />

        {/* sidebar + main */}
        <div className="flex min-h-0 flex-1">
          <div
            className="shrink-0"
            style={{ width: collapsed ? undefined : width }}
          >
            <Sidebar />
          </div>
          {!collapsed && (
            <div
              className="w-px shrink-0 cursor-col-resize bg-border hover:bg-accent"
              onMouseDown={startResize}
            />
          )}
          <div className="min-w-0 flex-1 bg-bg-primary">
            <MainContent />
          </div>
        </div>

        <ActivityPanel />
        <StatusBar />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
