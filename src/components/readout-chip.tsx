import { useSyncExternalStore } from "react";
import {
	type CameraReadoutStore,
	formatOrbitReadout,
	formatPlanReadout,
} from "#/lib/camera";
import type { ViewMode } from "#/lib/view-mode";

interface ReadoutChipProps {
	mode: ViewMode;
	/** Live camera state; when absent the chip falls back to static text. */
	cameraReadout?: CameraReadoutStore;
}

/**
 * Static fallback text, verbatim from the mockup's bottom-right chip per
 * screen. draw and objects stay static — their chips describe the snapping
 * tool state, not the camera (Phase 3 flows will own those).
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
export function ReadoutChip({ mode, cameraReadout }: ReadoutChipProps) {
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
