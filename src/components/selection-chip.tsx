import { Html } from "@react-three/drei";
import type { FurnitureItem } from "#/lib/model";
import { formatFootprintCm, furnitureDisplayName } from "#/lib/model";

/**
 * The in-scene selection label (screen 2b): a small white card with a blue
 * square dot, the item name, and a mono dimensions readout. Label only —
 * the actions (rotate / clone / delete) live in the inspector panel.
 */

/** Gap between the item's top face and the label. */
const CHIP_CLEARANCE = 0.12;

/** Shared by the opening chip (plan-openings.tsx). */
export const ACTION_BUTTON_CLASS =
	"pointer-events-auto flex size-[30px] items-center justify-center rounded-lg bg-white/[0.06] transition-colors hover:bg-white/[0.14]";

interface SelectionChipProps {
	item: FurnitureItem;
	/**
	 * Where the label hangs, world coords. Defaults to the item's top face
	 * (the 3D lens); the 2D plan hangs it off the footprint's screen-top edge
	 * instead, since height doesn't project there.
	 */
	anchor?: [number, number, number];
}

export function SelectionChip({ item, anchor }: SelectionChipProps) {
	return (
		<Html
			position={
				anchor ?? [
					item.position.x,
					item.footprint.height + CHIP_CLEARANCE,
					item.position.y,
				]
			}
			style={{ pointerEvents: "none" }}
		>
			<div className="-translate-x-1/2 -translate-y-full pointer-events-none flex items-center gap-[9px] whitespace-nowrap rounded-[9px] border border-[var(--control-border)] bg-white px-3 py-[7px] shadow-[0_14px_34px_rgba(15,27,61,0.14)]">
				<span
					aria-hidden="true"
					className="h-[7px] w-[7px] rounded-[2px] bg-[var(--blue)]"
				/>
				<span className="font-semibold text-[13px] text-[var(--ink-900)]">
					{furnitureDisplayName(item.catalogId)}
				</span>
				<span className="font-mono text-[12px] text-[var(--ink-400)]">
					{formatFootprintCm(item.footprint)}
				</span>
			</div>
		</Html>
	);
}
