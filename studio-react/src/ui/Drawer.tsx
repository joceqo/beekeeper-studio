import * as React from "react";
import { Drawer as Vaul } from "vaul";
import { cn } from "@/lib/cn";

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  side?: "bottom" | "right" | "left" | "top";
  className?: string;
}

/**
 * Token-themed sheet/drawer (Vaul). Available for any slide-in panel pattern.
 * Defaults to a bottom sheet; pass `side` for an edge drawer.
 */
export function Drawer({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  side = "bottom",
  className,
}: DrawerProps) {
  return (
    <Vaul.Root open={open} onOpenChange={onOpenChange} direction={side}>
      {trigger && <Vaul.Trigger asChild>{trigger}</Vaul.Trigger>}
      <Vaul.Portal>
        <Vaul.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Vaul.Content
          className={cn(
            "fixed z-50 flex flex-col border-border bg-bg-secondary text-text-primary outline-none",
            side === "bottom" && "inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t",
            side === "top" && "inset-x-0 top-0 max-h-[85vh] rounded-b-lg border-b",
            side === "right" && "inset-y-0 right-0 w-[420px] max-w-[90vw] border-l",
            side === "left" && "inset-y-0 left-0 w-[420px] max-w-[90vw] border-r",
            className
          )}
        >
          {side === "bottom" && (
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
          )}
          {title && (
            <Vaul.Title className="px-4 pb-2 pt-3 text-lg font-semibold">
              {title}
            </Vaul.Title>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  );
}
