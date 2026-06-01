import * as React from "react";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { ContextMenu as BaseContextMenu } from "@base-ui-components/react/context-menu";
import { cn } from "@/lib/cn";
import { Kbd } from "./Kbd";

export interface MenuItemDef {
  type?: "item";
  label: React.ReactNode;
  icon?: React.ReactNode;
  kbd?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
}
export interface MenuSeparatorDef {
  type: "separator";
}
export type MenuEntry = MenuItemDef | MenuSeparatorDef;

const popupClass =
  "z-50 min-w-44 rounded-md border border-border bg-bg-secondary p-1 text-md text-text-primary shadow-lg shadow-black/30 outline-none";

function MenuItems({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((entry, i) => {
        if (entry.type === "separator") {
          return <div key={i} className="my-1 h-px bg-border" />;
        }
        return (
          <BaseMenu.Item
            key={i}
            disabled={entry.disabled}
            onClick={entry.onSelect}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1 outline-none data-[highlighted]:bg-bg-hover data-[disabled]:opacity-40",
              entry.danger
                ? "text-danger data-[highlighted]:text-danger"
                : "text-text-primary"
            )}
          >
            {entry.icon && (
              <span className="flex w-4 shrink-0 justify-center text-text-muted">
                {entry.icon}
              </span>
            )}
            <span className="flex-1">{entry.label}</span>
            {entry.kbd && <Kbd>{entry.kbd}</Kbd>}
          </BaseMenu.Item>
        );
      })}
    </>
  );
}

export interface MenuProps {
  trigger: React.ReactElement;
  items: MenuEntry[];
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

/** Dropdown menu anchored to a trigger element. */
export function Menu({ trigger, items, side = "bottom", align = "start" }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={4}>
          <BaseMenu.Popup className={popupClass}>
            <MenuItems items={items} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface ContextMenuProps {
  items: MenuEntry[];
  children: React.ReactNode;
  className?: string;
}

/** Right-click context menu wrapping its children as the trigger area. */
export function ContextMenu({ items, children, className }: ContextMenuProps) {
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className={className}>{children}</BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner>
          <BaseContextMenu.Popup className={popupClass}>
            {items.map((entry, i) => {
              if (entry.type === "separator") {
                return <div key={i} className="my-1 h-px bg-border" />;
              }
              return (
                <BaseContextMenu.Item
                  key={i}
                  disabled={entry.disabled}
                  onClick={entry.onSelect}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-sm px-2 py-1 outline-none data-[highlighted]:bg-bg-hover data-[disabled]:opacity-40",
                    entry.danger
                      ? "text-danger data-[highlighted]:text-danger"
                      : "text-text-primary"
                  )}
                >
                  {entry.icon && (
                    <span className="flex w-4 shrink-0 justify-center text-text-muted">
                      {entry.icon}
                    </span>
                  )}
                  <span className="flex-1">{entry.label}</span>
                  {entry.kbd && <Kbd>{entry.kbd}</Kbd>}
                </BaseContextMenu.Item>
              );
            })}
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
