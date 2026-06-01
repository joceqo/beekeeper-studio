import { Combobox as BaseCombobox } from "@base-ui-components/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ComboboxOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ComboboxProps<T extends string = string> {
  value?: T | null;
  onValueChange?: (value: T | null) => void;
  items: ComboboxOption<T>[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Typeahead combobox (Base UI). Filters `items` by their `label` as the user
 * types; selecting an item commits its value. Token-themed.
 */
export function Combobox<T extends string = string>({
  value,
  onValueChange,
  items,
  placeholder = "Search…",
  emptyText = "No matches",
  className,
  disabled,
  ...rest
}: ComboboxProps<T>) {
  return (
    <BaseCombobox.Root
      items={items as never}
      value={value as never}
      onValueChange={(v: unknown) => onValueChange?.((v as T | null) ?? null)}
      disabled={disabled}
      itemToStringLabel={(item: unknown) => (item as ComboboxOption<T>)?.label ?? ""}
    >
      <div
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-sm border border-border bg-bg-primary px-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40",
          className
        )}
      >
        <BaseCombobox.Input
          placeholder={placeholder}
          aria-label={rest["aria-label"]}
          className="w-full bg-transparent text-md text-text-primary outline-none placeholder:text-text-muted"
        />
        <BaseCombobox.Icon className="text-text-muted">
          <ChevronsUpDown size={12} />
        </BaseCombobox.Icon>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="z-50">
          <BaseCombobox.Popup className="max-h-72 w-[var(--anchor-width)] overflow-auto rounded-md border border-border bg-bg-secondary p-1 text-md text-text-primary shadow-lg shadow-black/30 outline-none">
            <BaseCombobox.Empty className="px-2 py-2 text-sm text-text-muted">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: ComboboxOption<T>) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1 outline-none data-[highlighted]:bg-bg-hover data-[selected]:text-accent"
                >
                  <BaseCombobox.ItemIndicator className="flex w-3 shrink-0 justify-center">
                    <Check size={12} />
                  </BaseCombobox.ItemIndicator>
                  <span className="flex-1">{item.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
