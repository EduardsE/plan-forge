import { useSyncExternalStore } from "react";
import {
	type CameraReadoutStore,
	formatOrbitReadout,
	formatPlanReadout,
} from "#/lib/camera";
import type { Unit } from "#/lib/units";
import type { ViewMode } from "#/lib/view-mode";

interface ReadoutChipProps {
	mode: ViewMode;
	/** Live camera state; when absent the chip falls back to static text. */
	cameraReadout?: CameraReadoutStore;
	/** Active display unit; drives the draw chip's grid readout. */
	unit?: Unit;
}

/**
 * Static fallback text, verbatim from the mockup's bottom-right chip per
 * screen. The objects chip stays static — it describes the snapping tool
 * state, not the camera (the Phase 3 objects flow will own it).
 */
const READOUT_BY_MODE: Record<ViewMode, string> = {
	"3d": "orbit 38° / 62° · zoom 1.0×",
	"2d": "scale 1 : 50 · grid 0.5 m",
	draw: "snap 90° · grid 0.5 m",
	objects: "snap · walls + objects",
};

const noStore: Pick<CameraReadoutStore, "subscribe" | "getSnapshot"> = {
	subscribe: () => () => {},
	getSnapshot: () => null,
};

/**
 * Bottom-right contextual readout chip, matching the mockup's screens 1a–1d.
 * In 3D it shows the live orbit angles + zoom of the perspective camera; in
 * 2D the live plan scale of the orthographic camera.
 */
export function ReadoutChip({ mode, cameraReadout, unit }: ReadoutChipProps) {
	const store = cameraReadout ?? noStore;
	const live = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		() => null,
	);

	let text = READOUT_BY_MODE[mode];
	if (mode === "3d" && live?.kind === "orbit") {
		text = formatOrbitReadout(live);
	} else if (mode === "2d" && live?.kind === "plan") {
		text = formatPlanReadout(live);
	} else if (mode === "draw") {
		text = `snap 90° · grid ${unit === "cm" ? "50 cm" : "0.5 m"}`;
	}

	return (
		<div
			className="absolute right-10 bottom-12 rounded-[10px] px-3.5 py-2 font-mono text-[12px] text-[var(--navy-400)]"
			style={{
				background: "var(--surface-glass)",
				border: "1px solid var(--border-subtle)",
				boxShadow: "var(--shadow-md)",
				backdropFilter: "blur(12px)",
			}}
		>
			{text}
		</div>
	);
}
