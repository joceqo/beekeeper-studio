/**
 * Full-size hover preview for an `image_url` cell. Rendered inside the
 * `.gdg-wrapper` (position: relative) and offset from the hovered cell's bounds
 * (which Glide reports relative to the grid). Clamped to stay on-screen-ish by
 * flipping above the cell when near the bottom edge.
 */
export function ImagePreviewCard({ url, x, y }: { url: string; x: number; y: number }) {
  // Offset below-right of the cell; CSS keeps it from overflowing the grid.
  const left = Math.max(8, x);
  const top = y + 28;
  return (
    <div
      className="pointer-events-none absolute z-50 max-w-[260px] overflow-hidden rounded-md border border-border bg-bg-surface p-1 shadow-lg shadow-black/40"
      style={{ left, top, transform: top > 320 ? "translateY(calc(-100% - 56px))" : undefined }}
    >
      <img
        src={url}
        alt=""
        className="block max-h-[240px] max-w-[252px] rounded-sm object-contain"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="truncate px-1 pt-1 font-mono text-[10px] text-text-muted">{url}</div>
    </div>
  );
}
