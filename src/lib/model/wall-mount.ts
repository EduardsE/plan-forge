import { catalogItemById } from "./catalog";
import { wallsOf } from "./geometry";
import type { Point } from "./types";

/**
 * Pure geometry for wall-mounted furniture (picture frames, clocks): the wall
 * frames a mount can anchor to, and the plan transform a mount resolves into.
 * Rendering-agnostic like the rest of the model — placement snapping (nearest
 * wall, offset clamping, guide pills) lives in `src/lib/mount-place.ts`.
 *
 * A mount stores a host wall index, a near-edge offset along it (like
 * `Opening`), and a vertical `elevation`. `deriveMountTransform` turns that
 * into the item's plan `position` (pushed into the room by half its depth, so
 * its back sits flush on the interior wall face) and `rotation` (its width
 * axis aligned to the wall direction).
 */

const EPS = 1e-9;

/** A wall reduced to the frame a mount needs: no holes, no thickness. */
export interface WallFrame {
	/** Plan position of the wall's start corner. */
	start: Point;
	/** Unit direction along the wall, start → end. */
	dir: Point;
	/** Unit normal pointing away from the room interior. */
	outward: Point;
	length: number;
}

/** A `WallFrame` tagged with its outline wall index (the mount's `wallIndex`). */
export interface MountFrame extends WallFrame {
	index: number;
}

/** Twice the signed area; its sign encodes the outline winding. */
function signedDoubleArea(outline: Point[]): number {
	let sum = 0;
	for (let i = 0; i < outline.length; i++) {
		const a = outline[i];
		const b = outline[(i + 1) % outline.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
}

/**
 * The wall frames of a closed outline, indexed by wall index. Mirrors the
 * outward-normal derivation in `buildWallSolids` (interior on the wall's left
 * for the sample's winding) so a mount and the 3D wall agree on which way is
 * "into the room". Degenerate outlines (< 3 corners) yield no frames.
 */
export function wallFrames(outline: Point[]): MountFrame[] {
	if (outline.length < 3) return [];
	const winding = Math.sign(signedDoubleArea(outline)) || 1;
	const frames: MountFrame[] = [];
	for (const wall of wallsOf(outline)) {
		const dx = wall.end.x - wall.start.x;
		const dy = wall.end.y - wall.start.y;
		const length = Math.hypot(dx, dy);
		if (length < EPS) continue;
		const dir = { x: dx / length, y: dy / length };
		// `+ 0` folds the -0 the sign flips produce on axis-aligned walls.
		const outward = { x: dir.y * winding + 0, y: -dir.x * winding + 0 };
		frames.push({ index: wall.index, start: wall.start, dir, outward, length });
	}
	return frames;
}

/** Center elevations for a freshly mounted item, by catalog id (meters). */
const MOUNT_ELEVATIONS: Record<string, number> = {
	"picture-frame": 1.5,
	"wall-clock": 1.9,
};
export const DEFAULT_MOUNT_ELEVATION = 1.5;

/** The default center height a fresh wall mount hangs at, by catalog id. */
export function defaultMountElevation(catalogId: string): number {
	return MOUNT_ELEVATIONS[catalogId] ?? DEFAULT_MOUNT_ELEVATION;
}

/** Whether a catalog item mounts to a wall (the "wall-items" category). */
export function isWallItem(catalogId: string): boolean {
	return catalogItemById(catalogId)?.category === "wall-items";
}

/**
 * The plan `position` and `rotation` a mount resolves to on `frame`: the item
 * centered `offset + width/2` along the wall, pushed `depth/2` into the room
 * so its back sits on the interior face, with its width axis turned to the
 * wall direction. `rotation` matches the renderers' `rotation-y` convention
 * (positive degrees take +x toward -y in plan coords).
 */
export function deriveMountTransform(
	frame: WallFrame,
	offset: number,
	footprint: { width: number; depth: number },
): { position: Point; rotation: number } {
	const centerAlong = offset + footprint.width / 2;
	const inward = footprint.depth / 2;
	const position = {
		x: frame.start.x + frame.dir.x * centerAlong - frame.outward.x * inward,
		y: frame.start.y + frame.dir.y * centerAlong - frame.outward.y * inward,
	};
	const deg = (Math.atan2(-frame.dir.y, frame.dir.x) * 180) / Math.PI;
	const rotation = ((deg % 360) + 360) % 360;
	return { position, rotation };
}
