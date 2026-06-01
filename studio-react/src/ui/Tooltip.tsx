import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "@/lib/cn";
import { Kbd } from "./Kbd";

/** Mount once at the app root so all tooltips share open/close delays. */
export function TooltipProvider({
  children,
  delay = 300,
  closeDelay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
  closeDelay?: number;
}) {
  return (
    <BaseTooltip.Provider delay={delay} closeDelay={closeDelay}>
      {children}
    </BaseTooltip.Provider>
  );
}

export interface TooltipProps {
  content: React.ReactNode;
  /** Optional keyboard hint rendered as a <Kbd> on the right. */
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
  disabled?: boolean;
}

/**
 * Simple tooltip: wrap a single trigger element. Supports an optional `kbd`
 * shortcut hint. The trigger renders as the child element (Base UI `render`).
 */
export function Tooltip({ content, kbd, side = "top", children, disabled }: TooltipProps) {
  if (disabled || content == null) return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-bg-surface px-2 py-1 text-sm text-text-primary shadow-lg shadow-black/30"
            )}
          >
            <span>{content}</span>
            {kbd && <Kbd>{kbd}</Kbd>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
