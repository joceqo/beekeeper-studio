import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const inputVariants = cva(
  "w-full rounded-sm border border-border bg-bg-primary text-text-primary outline-none transition-colors duration-100 ease-out placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-sm",
        md: "h-7 px-2.5 text-md",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, size, ...props }, ref) {
    return (
      <input ref={ref} className={cn(inputVariants({ size }), className)} {...props} />
    );
  }
);
