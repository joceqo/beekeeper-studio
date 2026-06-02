import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import { cn } from "@/lib/cn";

export interface TabItem {
  value: string;
  label: React.ReactNode;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  className?: string;
}

/**
 * Underlined tab bar (engine switcher etc.). The active tab is marked with an
 * accent indicator that slides via Base UI's TabsIndicator.
 */
export function Tabs({ value, onValueChange, items, className }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(v) => onValueChange(String(v))}
      className={className}
    >
      <BaseTabs.List className="relative flex gap-1 border-b border-border">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className={cn(
              "relative px-3 py-2 text-md text-text-secondary outline-none transition-colors duration-100 ease-out hover:text-text-primary data-[selected]:text-text-primary"
            )}
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] bg-accent transition-all duration-150 ease-out" />
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}

export { BaseTabs };
