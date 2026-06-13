import { useCallback, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { TitleBar } from "@/components/shell/TitleBar";
import { MainContent } from "@/components/shell/MainContent";
import { StatusBar } from "@/components/shell/StatusBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { ActivityDrawer } from "@/components/activity/ActivityDrawer";
import { DetailHostProvider, useDetailHost } from "@/components/shell/DetailDock";
import { useLayoutStore } from "@/store/layout";
import { useTabsStore } from "@/store/tabs";
import { useCommands } from "@/lib/commands";
import { useGlobalKeybindings } from "@/lib/keymap";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { ConnectionSwitcher } from "@/components/palette/ConnectionSwitcher";
import { SettingsDialog } from "@/components/palette/SettingsDialog";
import { ConnectionModal } from "@/components/connection/ConnectionModal";
import { TooltipProvider, Toaster } from "@/ui";

/** Thin resize handle styled with the design tokens: subtle line, accent on hover/drag. */
function HResize() {
  return (
    <PanelResizeHandle className="group relative w-px shrink-0 bg-border outline-none data-[resize-handle-state=drag]:bg-accent">
      <span className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/40 group-data-[resize-handle-state=drag]:bg-accent/40" />
    </PanelResizeHandle>
  );
}

/**
 * Mounts the global keybinding listener once, dispatching matched commands to
 * the command registry, and renders the command-driven overlays (palette,
 * connection switcher, settings). Kept as its own component so the keybinding
 * hook can read the live command list + active-tab context.
 */
function CommandLayer() {
  const { run } = useCommands();
  const activeId = useTabsStore((s) => s.activeId);
  const tabs = useTabsStore((s) => s.tabs);
  const isTableTab = tabs.find((t) => t.id === activeId)?.kind === "table";

  const getContext = useCallback(() => ({ tableTab: isTableTab }), [isTableTab]);
  useGlobalKeybindings({ run, getContext });

  return (
    <>
      <CommandPalette />
      <ConnectionSwitcher />
      <SettingsDialog />
      <ConnectionModal />
    </>
  );
}

export default function App() {
  const bootstrap = useTabsStore((s) => s.bootstrap);

  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const detailCollapsed = useLayoutStore((s) => s.detailCollapsed);
  const activityCollapsed = useLayoutStore((s) => s.activityCollapsed);
  const registerPanel = useLayoutStore((s) => s.registerPanel);
  const setCollapsed = useLayoutStore((s) => s.setCollapsed);

  // The detail dock Panel content element; views portal their DetailPanel here.
  const [detailHost, setDetailHost] = useDetailHost();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const sidebarRef = useCallback(
    (r: ImperativePanelHandle | null) => registerPanel("sidebar", r),
    [registerPanel]
  );
  const detailRef = useCallback(
    (r: ImperativePanelHandle | null) => registerPanel("detail", r),
    [registerPanel]
  );

  return (
    <TooltipProvider delay={300}>
      <DetailHostProvider host={detailHost}>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary text-text-primary">
          <TitleBar />

          {/* content area: sidebar | main | detail (detail full-height). The
              activity log opens as a full-width overlay anchored to the bottom
              of this region, above the always-visible activity tab bar. */}
          <div className="relative min-h-0 flex-1">
            <PanelGroup
              direction="horizontal"
              autoSaveId="studio-react.layout.horizontal"
              className="h-full"
            >
              <Panel
                id="sidebar"
                order={1}
                ref={sidebarRef}
                collapsible
                collapsedSize={3}
                defaultSize={sidebarCollapsed ? 3 : 18}
                minSize={12}
                maxSize={32}
                onCollapse={() => setCollapsed("sidebar", true)}
                onExpand={() => setCollapsed("sidebar", false)}
              >
                <Sidebar />
              </Panel>

              <HResize />

              <Panel id="main" order={2} minSize={30}>
                <MainContent />
              </Panel>

              <HResize />

              <Panel
                id="detail"
                order={3}
                ref={detailRef}
                collapsible
                collapsedSize={0}
                defaultSize={detailCollapsed ? 0 : 22}
                minSize={14}
                maxSize={40}
                onCollapse={() => setCollapsed("detail", true)}
                onExpand={() => setCollapsed("detail", false)}
              >
                <div ref={setDetailHost} className="h-full" />
              </Panel>
            </PanelGroup>

            {!activityCollapsed && <ActivityDrawer />}
          </div>

          {/* full-width activity tab bar — always visible, toggles the drawer */}
          <ActivityPanel />

          <StatusBar />
        </div>
        <CommandLayer />
      </DetailHostProvider>
      <Toaster />
    </TooltipProvider>
  );
}
