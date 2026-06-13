/**
 * Saved-connection "paint" colors. Persisted on the backend as the
 * `labelColor` varchar (Beekeeper's named-color set); the renderer maps the
 * name to a CSS color for the sidebar dot and the connection-form swatches.
 *
 * `"default"` (or absent) means no paint — the engine icon tint is used instead.
 */
export interface LabelColor {
  name: string;
  /** CSS color for the dot/swatch; null = no paint. */
  hex: string | null;
}

export const LABEL_COLORS: readonly LabelColor[] = [
  { name: "default", hex: null },
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "yellow", hex: "#eab308" },
  { name: "green", hex: "#22c55e" },
  { name: "blue", hex: "#3b82f6" },
  { name: "purple", hex: "#a855f7" },
  { name: "pink", hex: "#ec4899" },
] as const;

/** Resolve a stored labelColor name to a CSS color, or undefined for none/default. */
export function paintForLabelColor(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  return LABEL_COLORS.find((c) => c.name === name)?.hex ?? undefined;
}
