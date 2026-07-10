import { outlineBounds, type Point, wallsOf } from "#/lib/model";

/**
 * Pure placement math for dragging a catalog item onto the floor (mockup
 * screen 1d): the ghost footprint's snapped center plus the wall-distance
 * guides drawn beside it. Rendering lives in the placement-ghost component.
 *
 * Scope: guides and snapping only consider axis-aligned walls (draw mode
 * snaps to 90°, so real outlines are axis-aligned in practice); walls at
 * other angles are ignored. The item is treated as unrotated — rotation
 * happens after the drop, via the selection toolbar.
 */

/** Wall-snap capture distance, meters (world units, zoom-independent). */
export const SNAP_TOLERANCE = 0.3;
/** Ghost centers quantize to this grid, meters (same as draw mode). */
export const PLACEMENT_GRID = 0.05;
/** Gaps below this read as flush — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const AXIS_EPSILON = 1e-6;

export interface PlacementGuide {
	/** Axis the distance is measured along. */
	axis: "x" | "y";
	/** On the wall's interior face, at the ghost's center on the other axis. */
	from: Point;
	/** On the ghost's near edge. */
	to: Point;
	/** Clearance between wall face and ghost edge, meters (> 0). */
	distance: number;
}

export interface PlacementSnap {
	center: Point;
	/** At most one guide per axis, to that axis's nearest wall. */
	guides: PlacementGuide[];
}

interface AxisWall {
	/** Wall line's coordinate on the measured axis. */
	coord: number;
	/** Wall segment's extent along the other axis. */
	spanMin: number;
	spanMax: number;
}

function quantize(value: number, grid: number): number {
	return Math.round(value / grid) * grid;
}

/** Walls perpendicular to `axis` (vertical walls for "x", horizontal for "y"). */
function axisWalls(outline: Point[], axis: "x" | "y"): AxisWall[] {
	const across = axis === "x" ? "y" : "x";
	const walls: AxisWall[] = [];
	for (const wall of wallsOf(outline)) {
		if (Math.abs(wall.start[axis] - wall.end[axis]) > AXIS_EPSILON) continue;
		const a = wall.start[across];
		const b = wall.end[across];
		if (Math.abs(a - b) < AXIS_EPSILON) continue;
		walls.push({
			coord: wall.start[axis],
			spanMin: Math.min(a, b),
			spanMax: Math.max(a, b),
		});
	}
	return walls;
}

interface NearestWall {
	coord: number;
	/** Signed clearance from the ghost edge facing the wall to the wall face. */
	gap: number;
	/** Which side of the ghost the wall is on. */
	side: -1 | 1;
}

function nearestWall(
	walls: AxisWall[],
	center: number,
	across: number,
	half: number,
): NearestWall | null {
	let best: NearestWall | null = null;
	for (const wall of walls) {
		if (across < wall.spanMin || across > wall.spanMax) continue;
		const side: -1 | 1 = wall.coord <= center ? -1 : 1;
		const gap =
			side === -1 ? center - half - wall.coord : wall.coord - (center + half);
		if (best === null || Math.abs(gap) < Math.abs(best.gap)) {
			best = { coord: wall.coord, gap, side };
		}
	}
	return best;
}

/**
 * Snap one axis of the ghost center: quantize happened upstream; here the
 * center clamps inside the room's bounds and sticks flush to the nearest
 * wall when the gap is within tolerance.
 */
function snapAxis(
	walls: AxisWall[],
	center: number,
	across: number,
	half: number,
	clampMin: number | null,
	clampMax: number | null,
	tolerance: number,
): number {
	let snapped = center;
	if (clampMin !== null && clampMax !== null) {
		// A room narrower than the item centers it on that axis.
		snapped =
			clampMin > clampMax
				? (clampMin + clampMax) / 2
				: Math.min(Math.max(snapped, clampMin), clampMax);
	}
	const wall = nearestWall(walls, snapped, across, half);
	if (wall && Math.abs(wall.gap) <= tolerance) {
		snapped = wall.side === -1 ? wall.coord + half : wall.coord - half;
	}
	return snapped;
}

function guideFor(
	walls: AxisWall[],
	axis: "x" | "y",
	center: Point,
	half: number,
): PlacementGuide | null {
	const across = axis === "x" ? center.y : center.x;
	const wall = nearestWall(
		walls,
		axis === "x" ? center.x : center.y,
		across,
		half,
	);
	if (!wall || wall.gap < FLUSH_EPSILON) return null;
	const edge =
		(axis === "x" ? center.x : center.y) + (wall.side === -1 ? -half : half);
	const point = (along: number): Point =>
		axis === "x" ? { x: along, y: across } : { x: across, y: along };
	return {
		axis,
		from: point(wall.coord),
		to: point(edge),
		distance: wall.gap,
	};
}

/**
 * Where a catalog footprint dragged to `cursor` actually lands: the center
 * quantizes to the placement grid, clamps inside the room's bounding box,
 * and sticks flush to the nearest axis-aligned wall within `tolerance`;
 * `guides` carry the per-axis wall clearances left to render.
 */
export function snapPlacement(
	outline: Point[],
	size: { width: number; depth: number },
	cursor: Point,
	tolerance: number = SNAP_TOLERANCE,
	grid: number = PLACEMENT_GRID,
): PlacementSnap {
	const halfW = size.width / 2;
	const halfD = size.depth / 2;
	const bounds = outlineBounds(outline);
	const vertical = axisWalls(outline, "x");
	const horizontal = axisWalls(outline, "y");

	const quantized = {
		x: quantize(cursor.x, grid),
		y: quantize(cursor.y, grid),
	};
	const center: Point = {
		x: snapAxis(
			vertical,
			quantized.x,
			quantized.y,
			halfW,
			bounds ? bounds.min.x + halfW : null,
			bounds ? bounds.max.x - halfW : null,
			tolerance,
		),
		y: 0,
	};
	center.y = snapAxis(
		horizontal,
		quantized.y,
		center.x,
		halfD,
		bounds ? bounds.min.y + halfD : null,
		bounds ? bounds.max.y - halfD : null,
		tolerance,
	);

	const guides: PlacementGuide[] = [];
	const guideX = guideFor(vertical, "x", center, halfW);
	if (guideX) guides.push(guideX);
	const guideY = guideFor(horizontal, "y", center, halfD);
	if (guideY) guides.push(guideY);
	return { center, guides };
}
