/**
 * studio-react design-system primitives. Built on Base UI headless components
 * + class-variance-authority, themed off the CSS tokens in src/index.css.
 * Toasts via Sonner; drawers via Vaul. Import from "@/ui".
 */
export { cn } from "@/lib/cn";

export { Button, buttonVariants, type ButtonProps } from "./Button";
export { IconButton, iconButtonVariants, type IconButtonProps } from "./IconButton";
export { Input, inputVariants, type InputProps } from "./Input";
export { Textarea, type TextareaProps } from "./Textarea";
export { Select, type SelectProps, type SelectOption } from "./Select";
export { Combobox, type ComboboxProps, type ComboboxOption } from "./Combobox";
export { Popover, type PopoverProps } from "./Popover";
export {
  Menu,
  ContextMenu,
  AnchoredMenu,
  type MenuProps,
  type ContextMenuProps,
  type AnchoredMenuProps,
  type MenuEntry,
  type MenuItemDef,
} from "./Menu";
export { Tooltip, TooltipProvider, type TooltipProps } from "./Tooltip";
export { Tabs, type TabsProps, type TabItem } from "./Tabs";
export { Switch, type SwitchProps } from "./Switch";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentItem,
} from "./SegmentedControl";
export { Dialog, type DialogProps } from "./Dialog";
export { Drawer, type DrawerProps } from "./Drawer";
export { Badge, Chip, badgeVariants, type BadgeProps, type ChipProps } from "./Badge";
export { Kbd } from "./Kbd";
export { Toaster, notify } from "./Toaster";
