import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactElement;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Token-themed modal dialog (Base UI) with backdrop + close affordance. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <BaseDialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-secondary p-5 text-md text-text-primary shadow-xl shadow-black/40 outline-none",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-all",
            className
          )}
        >
          {(title || onOpenChange) && (
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                {title && (
                  <BaseDialog.Title className="text-lg font-semibold text-text-primary">
                    {title}
                  </BaseDialog.Title>
                )}
                {description && (
                  <BaseDialog.Description className="mt-1 text-sm text-text-muted">
                    {description}
                  </BaseDialog.Description>
                )}
              </div>
              <BaseDialog.Close render={<IconButton aria-label="Close" />}>
                <X size={14} />
              </BaseDialog.Close>
            </div>
          )}
          {children}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export { BaseDialog };
