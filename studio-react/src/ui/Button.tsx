import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Button variants, themed off the CSS tokens in src/index.css.
 * - primary: accent fill (the main call to action)
 * - ghost:   transparent until hover (toolbar / chrome buttons)
 * - subtle:  bordered neutral surface (secondary actions)
 * - danger:  destructive accent
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium outline-none transition-colors duration-100 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-accent",
  {
    variants: {
      variant: {
        primary: "bg-accent text-text-on-accent hover:bg-accent-hover",
        ghost:
          "text-text-muted hover:bg-bg-hover hover:text-text-primary",
        subtle:
          "border border-border bg-bg-secondary text-text-primary hover:bg-bg-hover",
        danger: "bg-danger text-text-on-accent hover:opacity-90",
      },
      size: {
        sm: "h-6 px-2 text-sm",
        md: "h-7 px-3 text-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
