import { describe, expect, it } from "vitest";
import {
	floorArea,
	outlineBounds,
	wallLength,
	wallLengths,
	wallsOf,
} from "./geometry";
import type { Point } from "./types";

// The mockup's living room outline: 6.40 × 5.20 m rectangle.
const rectangle: Point[] = [
	{ x: 0, y: 0 },
	{ x: 6.4, y: 0 },
	{ x: 6.4, y: 5.2 },
	{ x: 0, y: 5.2 },
];

// 6 × 5 rectangle with a 2 × 2 notch cut from the top-right corner.
const lShape: Point[] = [
	{ x: 0, y: 0 },
	{ x: 6, y: 0 },
	{ x: 6, y: 3 },
	{ x: 4, y: 3 },
	{ x: 4, y: 5 },
	{ x: 0, y: 5 },
];

describe("wallsOf", () => {
	it("derives one wall per corner, closing the loop back to the first corner", () => {
		const walls = wallsOf(rectangle);
		expect(walls).toHaveLength(4);
		expect(walls.map((w) => w.index)).toEqual([0, 1, 2, 3]);
		for (const [i, wall] of walls.entries()) {
			expect(wall.start).toEqual(rectangle[i]);
		}
		expect(walls[3].end).toEqual(rectangle[0]);
	});

	it("returns no walls for outlines with fewer than 2 corners", () => {
		expect(wallsOf([])).toEqual([]);
		expect(wallsOf([{ x: 1, y: 1 }])).toEqual([]);
	});
});

describe("wallLength / wallLengths", () => {
	it("measures each wall of the rectangle", () => {
		expect(wallLengths(rectangle)).toEqual([6.4, 5.2, 6.4, 5.2]);
	});

	it("measures diagonal walls", () => {
		expect(
			wallLength({ index: 0, start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }),
		).toBe(5);
	});
});

describe("floorArea", () => {
	it("computes the mockup room's 33.28 m²", () => {
		expect(floorArea(rectangle)).toBeCloseTo(33.28, 10);
	});

	it("handles non-convex outlines", () => {
		expect(floorArea(lShape)).toBeCloseTo(26, 10);
	});

	it("is independent of winding direction", () => {
		expect(floorArea([...rectangle].reverse())).toBeCloseTo(33.28, 10);
	});

	it("returns 0 for degenerate outlines", () => {
		expect(floorArea([])).toBe(0);
		expect(floorArea(rectangle.slice(0, 2))).toBe(0);
	});
});

describe("outlineBounds", () => {
	it("computes the bounding box of an outline not anchored at the origin", () => {
		const bounds = outlineBounds([
			{ x: -1, y: 2 },
			{ x: 3, y: 2 },
			{ x: 3, y: 7 },
			{ x: -1, y: 7 },
		]);
		expect(bounds).toEqual({
			min: { x: -1, y: 2 },
			max: { x: 3, y: 7 },
			width: 4,
			height: 5,
		});
	});

	it("bounds a non-convex outline by its extremes", () => {
		expect(outlineBounds(lShape)).toEqual({
			min: { x: 0, y: 0 },
			max: { x: 6, y: 5 },
			width: 6,
			height: 5,
		});
	});

	it("returns null for an empty outline", () => {
		expect(outlineBounds([])).toBeNull();
	});
});
