import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/** Token-themed on/off switch (Base UI). */
export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  id,
  ...rest
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-border bg-bg-tertiary outline-none transition-colors data-[checked]:border-accent data-[checked]:bg-accent focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50",
        className
      )}
    >
      <BaseSwitch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-text-primary transition-transform data-[checked]:translate-x-[14px] data-[checked]:bg-text-on-accent" />
    </BaseSwitch.Root>
  );
}
