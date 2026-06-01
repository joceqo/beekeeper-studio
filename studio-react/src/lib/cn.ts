import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with clsx (conditional/variadic) and tailwind-merge
 * (de-dupes conflicting Tailwind utilities, e.g. `px-2 px-3` → `px-3`).
 * Shared by every primitive in `src/ui` and by feature components.
 *
 * Re-exported from `@/ui` as `cn`; this module is the single source.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
