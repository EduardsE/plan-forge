import { describe, expect, it } from "vitest";
import { createSampleRoom } from "#/lib/model";
import {
	circlePoints,
	dashedPolyline,
	doorSwing,
	roundedRectPoints,
	solidSpans,
	wallPoint,
	wallSpanRect,
} from "#/lib/plan-scene";
import { buildWallSolids, type WallSolid } from "#/lib/room-scene";

const sampleSolids = () => buildWallSolids(createSampleRoom());

describe("solidSpans", () => {
	it("returns the whole wall when it has no holes", () => {
		const bottom = sampleSolids()[2];
		expect(bottom.holes).toHaveLength(0);
		expect(solidSpans(bottom)).toEqual([{ start: 0, end: 6.4 }]);
	});

	it("splits a wall around its hole", () => {
		const top = sampleSolids()[0];
		expect(solidSpans(top)).toEqual([
			{ start: 0, end: 3.5 },
			{ start: 5.6, end: 6.4 },
		]);
	});

	it("merges overlapping holes and drops empty edge spans", () => {
		const solid: WallSolid = {
			index: 0,
			start: { x: 0, y: 0 },
			dir: { x: 1, y: 0 },
			outward: { x: 0, y: -1 },
			length: 4,
			holes: [
				{ kind: "door", start: 0, width: 1.5, bottom: 0, top: 2 },
				{ kind: "window", start: 1, width: 1, bottom: 0.4, top: 1.9 },
			],
		};
		expect(solidSpans(solid)).toEqual([{ start: 2, end: 4 }]);
	});
});

describe("wallPoint / wallSpanRect", () => {
	it("offsets away from the interior", () => {
		// Sample top wall: start (0,0) → (6.4,0), outward -y (up).
		const top = sampleSolids()[0];
		expect(wallPoint(top, 2, 0.1)).toEqual({ x: 2, y: -0.1 });
	});

	it("builds the span footprint from outline to outward face", () => {
		const top = sampleSolids()[0];
		expect(wallSpanRect(top, { start: 1, end: 3 }, 0.1)).toEqual([
			{ x: 1, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: -0.1 },
			{ x: 1, y: -0.1 },
		]);
	});
});

describe("roundedRectPoints", () => {
	it("stays inside the rect and touches all four edges", () => {
		const points = roundedRectPoints(2, 1, 0.2);
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);
		expect(Math.min(...xs)).toBeCloseTo(-1, 10);
		expect(Math.max(...xs)).toBeCloseTo(1, 10);
		expect(Math.min(...ys)).toBeCloseTo(-0.5, 10);
		expect(Math.max(...ys)).toBeCloseTo(0.5, 10);
	});

	it("emits sharp corners for zero radii", () => {
		expect(roundedRectPoints(2, 1, 0)).toEqual([
			{ x: -1, y: -0.5 },
			{ x: 1, y: -0.5 },
			{ x: 1, y: 0.5 },
			{ x: -1, y: 0.5 },
		]);
	});

	it("supports per-corner radii in CSS order", () => {
		const points = roundedRectPoints(2, 2, [0.5, 0, 0, 0]);
		// Only the top-left corner is cut; the other three stay sharp.
		expect(points).toContainEqual({ x: 1, y: -1 });
		expect(points).toContainEqual({ x: 1, y: 1 });
		expect(points).toContainEqual({ x: -1, y: 1 });
		expect(points.some((p) => p.x === -1 && p.y === -1)).toBe(false);
		// The arc starts on the left edge and ends on the top edge.
		expect(points[0].x).toBeCloseTo(-1, 10);
		expect(points[0].y).toBeCloseTo(-0.5, 10);
	});

	it("clamps radii to the half extents", () => {
		const points = roundedRectPoints(2, 1, 5);
		for (const p of points) {
			expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 + 1e-9);
		}
	});
});

describe("circlePoints", () => {
	it("lies on the radius", () => {
		for (const p of circlePoints(0.25, 12)) {
			expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.25, 10);
		}
	});
});

describe("dashedPolyline", () => {
	it("alternates dashes and gaps along a straight line", () => {
		const pairs = dashedPolyline(
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
			],
			0.3,
			0.2,
		);
		expect(pairs).toEqual([
			{ x: 0, y: 0 },
			{ x: 0.3, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: expect.closeTo(0.8, 10), y: 0 },
		]);
	});

	it("carries a dash across a polyline vertex", () => {
		const pairs = dashedPolyline(
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 1 },
			],
			1.5,
			0.5,
		);
		// One dash: (0,0)→(1,0) then continuing (1,0)→(1,0.5) past the corner.
		expect(pairs).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: expect.closeTo(0.5, 10) },
		]);
	});

	it("emits an even number of points (start/end pairs)", () => {
		const pairs = dashedPolyline(circlePoints(1, 32), 0.09, 0.06);
		expect(pairs.length % 2).toBe(0);
		expect(pairs.length).toBeGreaterThan(0);
	});
});

describe("doorSwing", () => {
	it("matches the mockup door: hinge at offset edge, leaf into the room", () => {
		// Sample right wall: start (6.4,0) → (6.4,5.2), door at 3.6, 0.95 wide.
		const right = sampleSolids()[1];
		const swing = doorSwing(right, right.holes[0]);
		expect(swing.hinge.x).toBeCloseTo(6.4, 10);
		expect(swing.hinge.y).toBeCloseTo(3.6, 10);
		expect(swing.leafEnd.x).toBeCloseTo(6.4 - 0.95, 10);
		expect(swing.leafEnd.y).toBeCloseTo(3.6, 10);
		// Arc runs from the open leaf tip to the closed pose at the far edge.
		const first = swing.arc[0];
		const last = swing.arc[swing.arc.length - 1];
		expect(first.x).toBeCloseTo(swing.leafEnd.x, 10);
		expect(first.y).toBeCloseTo(swing.leafEnd.y, 10);
		expect(last.x).toBeCloseTo(6.4, 10);
		expect(last.y).toBeCloseTo(3.6 + 0.95, 10);
		// Every arc point stays at the leaf radius, inside the room.
		for (const p of swing.arc) {
			expect(Math.hypot(p.x - 6.4, p.y - 3.6)).toBeCloseTo(0.95, 10);
			expect(p.x).toBeLessThanOrEqual(6.4 + 1e-9);
		}
	});

	it("mirrors the swing when hinged at the far edge", () => {
		const right = sampleSolids()[1];
		const swing = doorSwing(right, { ...right.holes[0], hinge: "end" });
		expect(swing.hinge.y).toBeCloseTo(3.6 + 0.95, 10);
		expect(swing.leafEnd.x).toBeCloseTo(6.4 - 0.95, 10);
		const last = swing.arc[swing.arc.length - 1];
		expect(last.y).toBeCloseTo(3.6, 10);
	});
});
