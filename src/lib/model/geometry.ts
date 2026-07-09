import type { Bounds, Point, Wall } from "./types";

/**
 * Derive the wall segments of a closed outline. Each corner starts one wall;
 * the last wall closes the loop back to the first corner. Outlines with
 * fewer than 2 corners have no walls.
 */
export function wallsOf(outline: Point[]): Wall[] {
	if (outline.length < 2) return [];
	return outline.map((start, index) => ({
		index,
		start,
		end: outline[(index + 1) % outline.length],
	}));
}

export function wallLength(wall: Wall): number {
	return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

/** Length of every wall of the outline, in wall order. */
export function wallLengths(outline: Point[]): number[] {
	return wallsOf(outline).map(wallLength);
}

/**
 * Area enclosed by the outline (shoelace formula). Winding-independent;
 * returns 0 for degenerate outlines (fewer than 3 corners).
 */
export function floorArea(outline: Point[]): number {
	if (outline.length < 3) return 0;
	let twiceSigned = 0;
	for (let i = 0; i < outline.length; i++) {
		const a = outline[i];
		const b = outline[(i + 1) % outline.length];
		twiceSigned += a.x * b.y - b.x * a.y;
	}
	return Math.abs(twiceSigned) / 2;
}

/** Axis-aligned bounding box of the outline, or null when it has no corners. */
export function outlineBounds(outline: Point[]): Bounds | null {
	if (outline.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const { x, y } of outline) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	return {
		min: { x: minX, y: minY },
		max: { x: maxX, y: maxY },
		width: maxX - minX,
		height: maxY - minY,
	};
}
