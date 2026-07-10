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
				className="w-[158px] rounded-[14px] bg-white p-2.5"
				style={{
					// Card rides up-left of the cursor, like the mockup's arrow
					// sitting at the card's bottom-right corner.
					transform:
						"translate(calc(-100% + 18px), calc(-100% + 14px)) rotate(-4deg)",
					border: "1.5px solid rgba(34, 211, 238, 0.7)",
					boxShadow:
						"0 34px 70px rgba(15, 27, 61, 0.30), 0 0 26px rgba(34, 211, 238, 0.25)",
				}}
			>
				<CatalogThumbnail catalogId={item.id} />
				<div className="mt-[9px] font-semibold text-[13.5px] text-[#22304F]">
					{item.name}
				</div>
				<div className="font-mono text-[11px] text-[#8A97B1]">
					{formatSizeCm(item.footprint)}
				</div>
			</div>
		</div>
	);
}
