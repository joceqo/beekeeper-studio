import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export interface SelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

const triggerVariants = cva(
  "inline-flex items-center justify-between gap-1.5 rounded-sm border border-border bg-bg-primary text-text-primary outline-none transition-colors duration-100 ease-out hover:bg-bg-hover focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent/40 data-[popup-open]:border-accent disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-sm",
        md: "h-7 px-2.5 text-md",
      },
    },
    defaultVariants: { size: "sm" },
  }
);

export interface SelectProps<T extends string = string>
  extends VariantProps<typeof triggerVariants> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  items: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional fixed trigger width; otherwise sizes to content. */
  triggerClassName?: string;
  "aria-label"?: string;
}

/**
 * Headless Base UI Select wrapped with token-themed parts. Drop-in for a
 * native `<select>` — pass `items`, control with `value`/`onValueChange`.
 */
export function Select<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  items,
  placeholder = "Select…",
  disabled,
  size,
  className,
  triggerClassName,
  ...rest
}: SelectProps<T>) {
  return (
    <BaseSelect.Root
      value={value as never}
      defaultValue={defaultValue as never}
      onValueChange={(v: unknown) => onValueChange?.(v as T)}
      disabled={disabled}
      items={items as never}
    >
      <BaseSelect.Trigger
        aria-label={rest["aria-label"]}
        className={cn(triggerVariants({ size }), triggerClassName, className)}
      >
        <BaseSelect.Value>
          {(val: unknown) => {
            const found = items.find((i) => i.value === val);
            return found ? found.label : <span className="text-text-muted">{placeholder}</span>;
          }}
        </BaseSelect.Value>
        <BaseSelect.Icon className="text-text-muted">
          <ChevronsUpDown size={12} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50 outline-none">
          <BaseSelect.Popup className="max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-auto rounded-md border border-border bg-bg-secondary p-1 text-md text-text-primary shadow-lg shadow-black/30 outline-none">
            {items.map((item) => (
              <BaseSelect.Item
                key={item.value}
                value={item.value}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1 outline-none data-[highlighted]:bg-bg-hover data-[selected]:text-accent"
              >
                <BaseSelect.ItemIndicator className="flex w-3 shrink-0 justify-center">
                  <Check size={12} />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText className="flex-1">{item.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
