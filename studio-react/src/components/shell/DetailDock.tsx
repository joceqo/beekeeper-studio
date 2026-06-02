import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The detail dock is a Panel in the app-shell horizontal PanelGroup (see
 * App.tsx), but its *content* (DetailPanel) is produced by whichever view is
 * active (TableView / RelationView) since it depends on that view's local
 * page/description/selection state. Rather than lift all of that state into the
 * shell, the shell exposes a portal host and views teleport their DetailPanel
 * into it. This keeps the layout structural (a real Panel that collapses) while
 * leaving the per-view detail logic untouched.
 */

const DetailHostContext = createContext<HTMLElement | null>(null);

/** Provider mounted by the shell; `host` is the dock Panel's content element. */
export function DetailHostProvider({
  host,
  children,
}: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  return <DetailHostContext.Provider value={host}>{children}</DetailHostContext.Provider>;
}

/**
 * Renders its children into the shell's detail dock Panel. A no-op (renders
 * nothing) until the host element exists. Views wrap their DetailPanel in this.
 */
export function DetailDockPortal({ children }: { children: ReactNode }) {
  const host = useContext(DetailHostContext);
  if (!host) return null;
  return createPortal(children, host);
}

/** Small hook the shell uses to capture the dock content element via a callback ref. */
export function useDetailHost() {
  return useState<HTMLElement | null>(null);
}
