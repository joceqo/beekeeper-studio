import { Toaster as SonnerToaster, toast } from "sonner";
import { useThemeStore } from "@/store/theme";

/**
 * App-root toast host. Sonner is themed to the CSS tokens via the
 * `--normal-*` custom properties it reads. Mount once in App.
 */
export function Toaster() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          fontSize: "var(--text-md)",
          borderRadius: "var(--radius-md)",
        },
      }}
    />
  );
}

/** Route all app notifications through Sonner. */
export const notify = toast;
