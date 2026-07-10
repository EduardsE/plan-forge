import { Html } from "@react-three/drei";
import { Copy, RotateCw, Trash2 } from "lucide-react";
import type { FurnitureItem } from "#/lib/model";
import { formatFootprintCm, furnitureDisplayName } from "#/lib/model";

/**
 * The in-scene selection UI from mockup screen 1a: a white name pill over a
 * dark toolbar chip (rotate / duplicate / delete + a live mono dimensions
 * readout) with a cyan leader line dropping toward the selected item. All
 * colors and metrics are lifted from the mockup's inline styles.
 */

/** Gap between the item's top face and the leader line's lower end. */
const CHIP_CLEARANCE = 0.12;

/** Shared by the furniture chip and the opening chip (plan-openings.tsx). */
export const ACTION_BUTTON_CLASS =
	"pointer-events-auto flex size-[30px] items-center justify-center rounded-lg bg-white/[0.06] transition-colors hover:bg-white/[0.14]";

interface SelectionChipProps {
	item: FurnitureItem;
	/**
	 * Where the leader line points, world coords. Defaults to the item's top
	 * face (the 3D lens); the 2D plan hangs the chip off the footprint's
	 * screen-top edge instead, since height doesn't project there.
	 */
	anchor?: [number, number, number];
	onRotate: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}

export function SelectionChip({
	item,
	anchor,
	onRotate,
	onDuplicate,
	onDelete,
}: SelectionChipProps) {
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
			<div className="pointer-events-none flex -translate-x-1/2 -translate-y-full flex-col items-center">
				<div className="mb-1.5 whitespace-nowrap rounded-full border border-[rgba(34,211,238,0.5)] bg-white/90 px-3 py-[5px] font-semibold text-[#0f766e] text-[12.5px] shadow-[0_8px_20px_rgba(15,27,61,0.12)]">
					{furnitureDisplayName(item.catalogId)}
				</div>
				<div className="flex items-center gap-1.5 rounded-[13px] border border-[rgba(94,234,212,0.25)] bg-[rgba(13,22,48,0.94)] px-3 py-[9px] shadow-[0_16px_40px_rgba(13,22,48,0.35),0_0_22px_rgba(45,212,238,0.18)]">
					<button
						type="button"
						aria-label="Rotate 90°"
						className={`${ACTION_BUTTON_CLASS} text-[#9fb2d8]`}
						onClick={onRotate}
					>
						<RotateCw size={17} strokeWidth={1.6} />
					</button>
					<button
						type="button"
						aria-label="Duplicate"
						className={`${ACTION_BUTTON_CLASS} text-[#9fb2d8]`}
						onClick={onDuplicate}
					>
						<Copy size={17} strokeWidth={1.6} />
					</button>
					<button
						type="button"
						aria-label="Delete"
						className={`${ACTION_BUTTON_CLASS} text-[#f2a6a6]`}
						onClick={onDelete}
					>
						<Trash2 size={17} strokeWidth={1.6} />
					</button>
					<div className="mx-[3px] h-[22px] w-px bg-white/[0.14]" />
					<span className="whitespace-nowrap font-mono text-[#7ee9e1] text-[12.5px]">
						{formatFootprintCm(item.footprint)}
					</span>
				</div>
				<div className="h-[26px] w-[1.5px] bg-gradient-to-b from-[rgba(45,212,238,0.8)] to-transparent" />
			</div>
		</Html>
	);
}
