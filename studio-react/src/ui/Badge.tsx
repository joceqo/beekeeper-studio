import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Small status/label pill used for env tags, relation chips, semantic
 * indicators, and counts. `tone` covers the token palette.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1 py-px text-xs font-medium leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-bg-tertiary text-text-secondary",
        accent: "bg-accent-subtle text-accent",
        danger: "bg-danger/15 text-danger",
        warning: "bg-warning/15 text-warning",
        success: "bg-success/15 text-success",
        info: "bg-info/15 text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Chip = badge with a removable affordance slot (relation/filter chips). */
export interface ChipProps extends BadgeProps {
  onRemove?: () => void;
}

export function Chip({ className, tone, children, onRemove, ...props }: ChipProps) {
  return (
    <span
      className={cn(badgeVariants({ tone }), "gap-1 px-1.5 py-0.5", className)}
      {...props}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 rounded-sm p-0.5 opacity-70 hover:bg-black/20 hover:opacity-100"
          aria-label="Remove"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      )}
    </span>
  );
}
