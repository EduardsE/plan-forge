import { describe, expect, it } from "vitest";
import {
	rectangleOutline,
	setSegmentLength,
	snapDraftPoint,
	snapRectPoint,
} from "./draw";

const TOL = 0.1;

describe("snapDraftPoint", () => {
	it("quantizes a free cursor to the 5 cm draw grid", () => {
		const snap = snapDraftPoint([], { x: 2.03, y: 1.28 }, TOL);
		expect(snap.point).toEqual({ x: 2.05, y: 1.3 });
		expect(snap.axisSnapped).toBe(false);
		expect(snap.alignment).toBeNull();
		expect(snap.turnAngleDeg).toBeNull();
	});

	it("locks the preview horizontal from the last corner", () => {
		const snap = snapDraftPoint([{ x: 0, y: 0 }], { x: 2.03, y: 0.06 }, TOL);
		expect(snap.point).toEqual({ x: 2.05, y: 0 });
		expect(snap.axisSnapped).toBe(true);
		// Only one corner placed — no previous segment to turn against.
		expect(snap.turnAngleDeg).toBeNull();
	});

	it("locks the preview vertical and reports the 90° turn", () => {
		const corners = [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
		];
		const snap = snapDraftPoint(corners, { x: 6.45, y: 2.5 }, TOL);
		expect(snap.point).toEqual({ x: 6.4, y: 2.5 });
		expect(snap.axisSnapped).toBe(true);
		expect(snap.turnAngleDeg).toBe(90);
	});

	it("reports 0° when continuing straight along the previous wall", () => {
		const corners = [
			{ x: 6.4, y: 3.2 },
			{ x: 2.8, y: 3.2 },
		];
		const snap = snapDraftPoint(corners, { x: 1, y: 3.24 }, TOL);
		expect(snap.point).toEqual({ x: 1, y: 3.2 });
		expect(snap.turnAngleDeg).toBe(0);
	});

	it("aligns the free coordinate with an earlier corner", () => {
		const corners = [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
			{ x: 6.4, y: 3.2 },
			{ x: 2.8, y: 3.2 },
		];
		// Far from the last corner (no axis snap), but x lines up with start.
		const snap = snapDraftPoint(corners, { x: 0.04, y: 4.81 }, TOL);
		expect(snap.point).toEqual({ x: 0, y: 4.8 });
		expect(snap.axisSnapped).toBe(false);
		expect(snap.alignment).toEqual({ cornerIndex: 0, axis: "x" });
	});

	it("composes an axis snap with a start alignment", () => {
		const corners = [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
			{ x: 6.4, y: 3.2 },
			{ x: 2.8, y: 3.2 },
		];
		const snap = snapDraftPoint(corners, { x: 0.04, y: 3.24 }, TOL);
		expect(snap.point).toEqual({ x: 0, y: 3.2 });
		expect(snap.axisSnapped).toBe(true);
		expect(snap.alignment).toEqual({ cornerIndex: 0, axis: "x" });
	});

	it("never aligns the coordinate the axis snap already locked", () => {
		const corners = [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0.08 },
		];
		// Horizontal axis snap locks y to 0.08; corner 0's y = 0 is within
		// tolerance but must not steal the locked coordinate.
		const snap = snapDraftPoint(corners, { x: 3, y: 0.12 }, TOL);
		expect(snap.point.y).toBe(0.08);
		expect(snap.alignment).toBeNull();
	});

	it("passes the raw cursor through when snapping is off", () => {
		// Would otherwise axis-lock to the last corner and quantize to 5 cm.
		const snap = snapDraftPoint(
			[{ x: 0, y: 0 }],
			{ x: 2.03, y: 0.06 },
			TOL,
			false,
		);
		expect(snap.point).toEqual({ x: 2.03, y: 0.06 });
		expect(snap.axisSnapped).toBe(false);
		expect(snap.alignment).toBeNull();
		expect(snap.turnAngleDeg).toBeNull();
	});
});

describe("snapRectPoint", () => {
	it("quantizes both axes to the 5 cm draw grid", () => {
		expect(snapRectPoint({ x: 2.03, y: 1.28 })).toEqual({ x: 2.05, y: 1.3 });
	});

	it("passes the raw cursor through when snapping is off", () => {
		expect(snapRectPoint({ x: 2.03, y: 1.28 }, false)).toEqual({
			x: 2.03,
			y: 1.28,
		});
	});
});

describe("rectangleOutline", () => {
	it("winds clockwise from two opposite corners regardless of click order", () => {
		const expected = [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
			{ x: 6.4, y: 5.2 },
			{ x: 0, y: 5.2 },
		];
		// Bottom-right dragged from the top-left, and the reverse.
		expect(rectangleOutline({ x: 0, y: 0 }, { x: 6.4, y: 5.2 })).toEqual(
			expected,
		);
		expect(rectangleOutline({ x: 6.4, y: 5.2 }, { x: 0, y: 0 })).toEqual(
			expected,
		);
	});

	it("returns null when either side collapses", () => {
		expect(rectangleOutline({ x: 1, y: 1 }, { x: 1, y: 4 })).toBeNull();
		expect(rectangleOutline({ x: 1, y: 1 }, { x: 4, y: 1 })).toBeNull();
		expect(rectangleOutline({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
	});
});

describe("setSegmentLength", () => {
	const corners = [
		{ x: 0, y: 0 },
		{ x: 6.4, y: 0 },
		{ x: 6.4, y: 3.2 },
	];

	it("moves the segment end and shifts later corners rigidly", () => {
		expect(setSegmentLength(corners, 0, 5)).toEqual([
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 5, y: 3.2 },
		]);
	});

	it("re-lengthens the last segment by moving only its end corner", () => {
		expect(setSegmentLength(corners, 1, 2)).toEqual([
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
			{ x: 6.4, y: 2 },
		]);
	});

	it("ignores invalid indices and non-positive lengths", () => {
		expect(setSegmentLength(corners, 2, 5)).toBe(corners);
		expect(setSegmentLength(corners, -1, 5)).toBe(corners);
		expect(setSegmentLength(corners, 0, 0)).toBe(corners);
		expect(setSegmentLength(corners, 0, Number.NaN)).toBe(corners);
	});

	it("ignores degenerate zero-length segments", () => {
		const degenerate = [
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
		];
		expect(setSegmentLength(degenerate, 0, 3)).toBe(degenerate);
	});
});
