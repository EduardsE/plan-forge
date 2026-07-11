import { useEffect, useState } from "react";
import { CatalogThumbnail } from "#/components/catalog-thumbnails";
import { type CatalogItem, formatSizeCm } from "#/lib/model";

/**
 * The tilted card that rides along under the cursor during a placement drag
 * (mockup screen 1d's "floating dragged card"). Pure DOM, pointer-events
 * none — the in-scene ghost is what actually tracks the floor.
 *
 * This layer also owns the session-cancel paths that don't need the floor:
 * Escape, pointer cancellation, and releasing the pointer anywhere that is
 * not the workspace canvas (the ghost handles on-canvas releases, so the
 * two never both act on the same pointerup).
 */

export interface PlacementDragLayerProps {
  item: CatalogItem;
  /** Pointer position when the drag started (viewport coordinates). */
  origin: { x: number; y: number };
  onCancel: () => void;
}

export function PlacementDragLayer({
  item,
  origin,
  onCancel,
}: PlacementDragLayerProps) {
  const [position, setPosition] = useState(origin);

  useEffect(() => {
    const handleMove = (event: PointerEvent) =>
      setPosition({ x: event.clientX, y: event.clientY });
    const handleUp = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLCanvasElement)) onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", handleKeyDown);
    // No text selection while the button is held down over the page.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [onCancel]);

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="w-[150px] rounded-[12px] bg-white p-[9px]"
        style={{
          // Card rides up-left of the cursor, like the mockup's arrow
          // sitting at the card's bottom-right corner.
          transform:
            "translate(calc(-100% + 18px), calc(-100% + 14px)) rotate(-4deg)",
          border: "1px solid rgba(58, 91, 240, 0.55)",
          boxShadow: "var(--shadow-drag)",
        }}
      >
        <CatalogThumbnail catalogId={item.id} className="h-[78px]" />
        <div className="mt-2 font-semibold text-[13px] text-[var(--ink-900)]">
          {item.name}
        </div>
        <div className="mt-px font-mono text-[11px] text-[var(--ink-400)]">
          {formatSizeCm(item.footprint)}
        </div>
      </div>
    </div>
  );
}
