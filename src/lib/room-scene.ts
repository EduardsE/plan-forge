import type { OpeningKind, Point, Room } from "#/lib/model";
import { wallsOf } from "#/lib/model";

/**
 * Pure scene-preparation math for the 3D lens: turns the plain room model
 * into wall "solids" a renderer can extrude — no three.js, no React, so it
 * stays unit-testable (same pattern as `camera.ts`).
 *
 * All values are meters in plan coordinates (x right, y down — see
 * `model/types.ts`). The vertical extent of openings isn't in the model yet,
 * so this module owns the defaults, measured from the mockup's 3D scene
 * (walls 250 px = 2.5 m at 100 px/m, window at top:56/height:158 px).
 */

export const WALL_HEIGHT = 2.5;
export const WALL_THICKNESS = 0.1;
/** Thickness of the dollhouse floor platform (mockup slab edge: 18 px). */
export const SLAB_THICKNESS = 0.18;
export const DOOR_HEIGHT = 2.05;
export const WINDOW_SILL = 0.36;
export const WINDOW_HEAD = 1.94;

/** A rectangular cut in a wall face, in wall-local coordinates. */
export interface WallHole {
	kind: OpeningKind;
	/** Distance from the wall's start corner to the hole's near edge. */
	start: number;
	width: number;
	/** Height of the hole's lower edge above the floor. */
	bottom: number;
	/** Height of the hole's upper edge above the floor. */
	top: number;
}

/** One wall ready to extrude: a placed rectangle with holes cut into it. */
export interface WallSolid {
	index: number;
	/** Plan position of the wall's start corner. */
	start: Point;
	/** Unit direction along the wall, start → end. */
	dir: Point;
	/** Unit normal pointing away from the room interior. */
	outward: Point;
	length: number;
	holes: WallHole[];
}

/**
 * A filler post at a convex outline corner. Walls extrude to the outside of
 * the outline, which leaves a thickness × thickness notch at every outward
 * corner; the post fills it.
 */
export interface CornerPost {
	/** The outline corner the post fills. */
	corner: Point;
	/** Plan position of the post's center. */
	center: Point;
	/** Wall indices meeting at this corner: [incoming, outgoing]. */
	walls: [number, number];
}

/** Twice the signed area; sign encodes winding (positive for the sample). */
function signedDoubleArea(outline: Point[]): number {
	let sum = 0;
	for (let i = 0; i < outline.length; i++) {
		const a = outline[i];
		const b = outline[(i + 1) % outline.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
}

const MIN_HOLE_SIZE = 1e-6;

/**
 * Derive one solid per wall of the room, with door/window holes located in
 * wall-local coordinates and clamped to the wall's extent. Outlines with
 * fewer than 3 corners enclose nothing and yield no walls.
 */
export function buildWallSolids(
	room: Room,
	wallHeight = WALL_HEIGHT,
): WallSolid[] {
	const { outline, openings } = room;
	if (outline.length < 3) return [];
	const windingSign = Math.sign(signedDoubleArea(outline)) || 1;

	const solids: WallSolid[] = [];
	for (const wall of wallsOf(outline)) {
		const dx = wall.end.x - wall.start.x;
		const dy = wall.end.y - wall.start.y;
		const length = Math.hypot(dx, dy);
		if (length < MIN_HOLE_SIZE) continue;
		const dir = { x: dx / length, y: dy / length };
		// For the sample's winding (positive signed area in y-down coords) the
		// interior lies to the wall's left, so outward is the right normal.
		// `+ 0` folds the -0 that the sign flips produce on axis-aligned walls.
		const outward = {
			x: dir.y * windingSign + 0,
			y: -dir.x * windingSign + 0,
		};

		const holes: WallHole[] = [];
		for (const opening of openings) {
			if (opening.wallIndex !== wall.index) continue;
			const start = Math.min(Math.max(opening.offset, 0), length);
			const end = Math.min(Math.max(opening.offset + opening.width, 0), length);
			const bottom = opening.kind === "window" ? WINDOW_SILL : 0;
			const top = Math.min(
				opening.kind === "window" ? WINDOW_HEAD : DOOR_HEIGHT,
				wallHeight,
			);
			if (end - start < MIN_HOLE_SIZE || top - bottom < MIN_HOLE_SIZE) continue;
			holes.push({
				kind: opening.kind,
				start,
				width: end - start,
				bottom,
				top,
			});
		}
		holes.sort((a, b) => a.start - b.start);

		solids.push({
			index: wall.index,
			start: wall.start,
			dir,
			outward,
			length,
			holes,
		});
	}
	return solids;
}

/**
 * Filler posts for the convex corners of the outline (concave corners make
 * the extruded walls overlap instead of leaving a gap, so they need none).
 * `solids` must be the full result of `buildWallSolids` for the outline.
 */
export function cornerPosts(
	solids: WallSolid[],
	thickness = WALL_THICKNESS,
): CornerPost[] {
	const posts: CornerPost[] = [];
	for (let i = 0; i < solids.length; i++) {
		const incoming = solids[(i - 1 + solids.length) % solids.length];
		const outgoing = solids[i];
		// Walking the outline in its winding, convex corners bend around the
		// interior — the turn points to the interior side, opposite outward.
		const turn =
			incoming.dir.x * outgoing.dir.y - incoming.dir.y * outgoing.dir.x;
		const outwardSide =
			incoming.dir.x * incoming.outward.y - incoming.dir.y * incoming.outward.x;
		if (turn * outwardSide >= 0) continue;
		const corner = outgoing.start;
		posts.push({
			corner,
			center: {
				x:
					corner.x +
					((incoming.outward.x + outgoing.outward.x) * thickness) / 2,
				y:
					corner.y +
					((incoming.outward.y + outgoing.outward.y) * thickness) / 2,
			},
			walls: [incoming.index, outgoing.index],
		});
	}
	return posts;
}
