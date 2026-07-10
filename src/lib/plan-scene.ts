import type { Point } from "#/lib/model";
import type { WallHole, WallSolid } from "#/lib/room-scene";

/**
 * Pure geometry for the 2D plan lens: turns wall solids and footprints into
 * the flat rects, arcs and outlines the plan presentation draws — no
 * three.js, no React (same pattern as `room-scene.ts` / `camera.ts`).
 *
 * All values are meters in plan coordinates (x right, y down).
 */

const EPS = 1e-6;

/** A stretch along a wall, as distances from the wall's start corner. */
export interface Span {
	start: number;
	end: number;
}

/**
 * The stretches of a wall that are solid masonry — the complement of its
 * (sorted, possibly overlapping) holes over the wall's length.
 */
export function solidSpans(solid: WallSolid): Span[] {
	const spans: Span[] = [];
	let cursor = 0;
	for (const hole of solid.holes) {
		if (hole.start - cursor > EPS) {
			spans.push({ start: cursor, end: hole.start });
		}
		cursor = Math.max(cursor, hole.start + hole.width);
	}
	if (solid.length - cursor > EPS) {
		spans.push({ start: cursor, end: solid.length });
	}
	return spans;
}

/**
 * A point on (or beside) a wall: `along` meters from its start corner,
 * shifted `outwardOffset` meters away from the interior.
 */
export function wallPoint(
	solid: WallSolid,
	along: number,
	outwardOffset: number,
): Point {
	return {
		x: solid.start.x + solid.dir.x * along + solid.outward.x * outwardOffset,
		y: solid.start.y + solid.dir.y * along + solid.outward.y * outwardOffset,
	};
}

/**
 * The plan footprint of a wall span: a rect from the outline (interior face)
 * to `thickness` meters outward, as 4 corners in plan coordinates.
 */
export function wallSpanRect(
	solid: WallSolid,
	span: Span,
	thickness: number,
): [Point, Point, Point, Point] {
	return [
		wallPoint(solid, span.start, 0),
		wallPoint(solid, span.end, 0),
		wallPoint(solid, span.end, thickness),
		wallPoint(solid, span.start, thickness),
	];
}

/**
 * Outline of a rounded rect centered at the origin, walked clockwise in
 * y-down plan coordinates from the top-left corner. Not closed — the caller
 * repeats the first point (polyline) or lets the shape close itself.
 * `radius` is uniform, or per-corner `[tl, tr, br, bl]` (CSS order).
 */
export function roundedRectPoints(
	width: number,
	depth: number,
	radius: number | [number, number, number, number],
	cornerSegments = 6,
): Point[] {
	const radii = Array.isArray(radius)
		? radius
		: ([radius, radius, radius, radius] as const);
	const hw = width / 2;
	const hd = depth / 2;
	const corners = radii.map((r, i) => {
		const clamped = Math.min(Math.max(r, 0), hw, hd);
		// Corner order tl, tr, br, bl; each arc sweeps +90° from its start
		// angle ((cos, sin) in y-down coords, so π points left, π/2 down).
		const signX = i === 1 || i === 2 ? 1 : -1;
		const signY = i >= 2 ? 1 : -1;
		return {
			center: { x: signX * (hw - clamped), y: signY * (hd - clamped) },
			r: clamped,
			startAngle: Math.PI * (1 + i / 2),
		};
	});
	const points: Point[] = [];
	for (const corner of corners) {
		if (corner.r < EPS) {
			points.push({
				x: corner.center.x,
				y: corner.center.y,
			});
			continue;
		}
		for (let s = 0; s <= cornerSegments; s++) {
			const angle = corner.startAngle + (Math.PI / 2) * (s / cornerSegments);
			points.push({
				x: corner.center.x + Math.cos(angle) * corner.r,
				y: corner.center.y + Math.sin(angle) * corner.r,
			});
		}
	}
	return points;
}

/** Circle outline centered at the origin, not closed (see above). */
export function circlePoints(radius: number, segments = 48): Point[] {
	const points: Point[] = [];
	for (let s = 0; s < segments; s++) {
		const angle = (2 * Math.PI * s) / segments;
		points.push({
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius,
		});
	}
	return points;
}

/**
 * Chop a polyline into explicit dash segments — consecutive point pairs for
 * a segments-mode line. Rendered this way instead of a dashed line material,
 * whose shader shows quad artifacts on some GPUs.
 */
export function dashedPolyline(
	points: Point[],
	dashSize: number,
	gapSize: number,
): Point[] {
	const pairs: Point[] = [];
	let drawing = true;
	let remaining = dashSize;
	for (let i = 0; i + 1 < points.length; i++) {
		let from = points[i];
		const to = points[i + 1];
		let segmentLeft = Math.hypot(to.x - from.x, to.y - from.y);
		while (segmentLeft > EPS) {
			const step = Math.min(segmentLeft, remaining);
			const t = step / segmentLeft;
			const next = {
				x: from.x + (to.x - from.x) * t,
				y: from.y + (to.y - from.y) * t,
			};
			if (drawing) pairs.push(from, next);
			from = next;
			segmentLeft -= step;
			remaining -= step;
			if (remaining <= EPS) {
				drawing = !drawing;
				remaining = drawing ? dashSize : gapSize;
			}
		}
	}
	return pairs;
}

/** The door-swing symbol: open leaf plus the arc back to the closed pose. */
export interface DoorSwing {
	/** Hinge corner, on the interior wall face. */
	hinge: Point;
	/** Tip of the open leaf, perpendicular to the wall inside the room. */
	leafEnd: Point;
	/** Quarter arc from the open leaf tip to the opening's far edge. */
	arc: Point[];
}

/**
 * Swing geometry for a door hole, hinged per `hole.hinge` (default
 * `"start"`), drawn open at 90° into the room interior.
 */
export function doorSwing(
	solid: WallSolid,
	hole: WallHole,
	segments = 24,
): DoorSwing {
	const hingeAtStart = (hole.hinge ?? "start") === "start";
	const hinge = wallPoint(
		solid,
		hingeAtStart ? hole.start : hole.start + hole.width,
		0,
	);
	const radius = hole.width;
	const interior = { x: -solid.outward.x, y: -solid.outward.y };
	const towardFar = hingeAtStart
		? solid.dir
		: { x: -solid.dir.x, y: -solid.dir.y };
	const leafEnd = {
		x: hinge.x + interior.x * radius,
		y: hinge.y + interior.y * radius,
	};
	const startAngle = Math.atan2(interior.y, interior.x);
	const endAngle = Math.atan2(towardFar.y, towardFar.x);
	let delta = endAngle - startAngle;
	if (delta > Math.PI) delta -= 2 * Math.PI;
	if (delta < -Math.PI) delta += 2 * Math.PI;
	const arc: Point[] = [];
	for (let s = 0; s <= segments; s++) {
		const angle = startAngle + delta * (s / segments);
		arc.push({
			x: hinge.x + Math.cos(angle) * radius,
			y: hinge.y + Math.sin(angle) * radius,
		});
	}
	return { hinge, leafEnd, arc };
}
