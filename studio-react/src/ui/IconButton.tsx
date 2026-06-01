import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Square icon-only button for chrome (toolbars, rails, tab close, panels).
 * Replaces the ad-hoc `.grid-toolbar-btn` / `.rail-btn` CSS classes.
 */
export const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-accent",
  {
    variants: {
      variant: {
        ghost:
          "text-text-muted hover:bg-bg-hover hover:text-text-primary",
        subtle:
          "border border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        primary: "bg-accent text-text-on-accent hover:bg-accent-hover",
        danger:
          "text-text-muted hover:bg-bg-hover hover:text-danger",
      },
      size: {
        sm: "h-5 w-5",
        md: "h-6 w-6",
        lg: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, variant, size, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
