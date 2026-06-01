import * as React from "react";
import { cn } from "@/lib/cn";

/** Keyboard shortcut hint, e.g. <Kbd>⌘K</Kbd>. Used inside tooltips + menus. */
export function Kbd({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-bg-tertiary px-1 font-mono text-[10px] font-medium text-text-secondary",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
