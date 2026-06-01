import * as React from "react";
import { ToggleGroup } from "@base-ui-components/react/toggle-group";
import { Toggle } from "@base-ui-components/react/toggle";
import { cn } from "@/lib/cn";

export interface SegmentItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  items: SegmentItem<T>[];
  className?: string;
  "aria-label"?: string;
}

/**
 * Single-select segmented control (the AI-access Hidden/Read/Write toggle).
 * Built on Base UI ToggleGroup with `multiple=false` semantics — selecting an
 * item deselects the others; the current value is always preserved.
 */
export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  items,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      value={[value]}
      aria-label={rest["aria-label"]}
      onValueChange={(group: unknown[]) => {
        // Single-select: take the newly added value; ignore deselect of the
        // active item so one option is always chosen.
        const next = group.find((g) => g !== value) as T | undefined;
        if (next) onValueChange(next);
      }}
      className={cn(
        "inline-flex rounded-md border border-border bg-bg-secondary p-0.5",
        className
      )}
    >
      {items.map((item) => (
        <Toggle
          key={item.value}
          value={item.value}
          title={item.title}
          className={cn(
            "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium outline-none transition-colors",
            "text-text-secondary hover:text-text-primary",
            "data-[pressed]:bg-accent data-[pressed]:text-text-on-accent",
            "focus-visible:ring-1 focus-visible:ring-accent"
          )}
        >
          {item.icon}
          {item.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
