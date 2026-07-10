import { describe, expect, it } from "vitest";
import { snapPlacement } from "./place";

/** The sample room's rectangle: 6.40 × 5.20 m, origin top-left. */
const RECT = [
	{ x: 0, y: 0 },
	{ x: 6.4, y: 0 },
	{ x: 6.4, y: 5.2 },
	{ x: 0, y: 5.2 },
];

/** Mockup 1d's dragged sofa: 168 × 88 cm. */
const SOFA = { width: 1.68, depth: 0.88 };

describe("snapPlacement", () => {
	it("quantizes the center to the placement grid", () => {
		const snap = snapPlacement(RECT, SOFA, { x: 3.013, y: 2.538 });
		expect(snap.center.x).toBeCloseTo(3.0, 10);
		expect(snap.center.y).toBeCloseTo(2.55, 10);
	});

	it("clamps the footprint inside the room bounds", () => {
		const snap = snapPlacement(RECT, SOFA, { x: 20, y: -5 });
		expect(snap.center.x).toBeCloseTo(6.4 - 0.84, 10);
		expect(snap.center.y).toBeCloseTo(0.44, 10);
	});

	it("sticks flush to a wall within the snap tolerance", () => {
		const snap = snapPlacement(RECT, SOFA, { x: 1.0, y: 2.6 });
		// Left edge at 1.0 − 0.84 = 0.16 from the wall → inside 0.3 tolerance.
		expect(snap.center.x).toBeCloseTo(0.84, 10);
		// Flush walls produce no guide on that axis.
		expect(snap.guides.map((guide) => guide.axis)).toEqual(["y"]);
	});

	it("leaves centers beyond the tolerance alone", () => {
		const snap = snapPlacement(RECT, SOFA, { x: 1.2, y: 2.6 });
		expect(snap.center.x).toBeCloseTo(1.2, 10);
	});

	it("measures per-axis clearance to the nearest wall", () => {
		// The mockup's ghost pose: center (3.85, 4.25) after quantization.
		const snap = snapPlacement(RECT, SOFA, { x: 3.85, y: 4.25 });
		const x = snap.guides.find((guide) => guide.axis === "x");
		const y = snap.guides.find((guide) => guide.axis === "y");
		// Right wall (1.71 m) beats left (3.01 m); bottom (0.51 m) beats top.
		expect(x?.distance).toBeCloseTo(6.4 - 3.85 - 0.84, 10);
		expect(x?.from).toEqual({ x: 6.4, y: 4.25 });
		expect(x?.to.x).toBeCloseTo(3.85 + 0.84, 10);
		expect(y?.distance).toBeCloseTo(5.2 - 4.25 - 0.44, 10);
		expect(y?.from).toEqual({ x: 3.85, y: 5.2 });
	});

	it("ignores walls whose span does not face the ghost", () => {
		// L-shape: the notch wall at x=3 spans y 3..5 only.
		const ell = [
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
			{ x: 6, y: 3 },
			{ x: 3, y: 3 },
			{ x: 3, y: 5 },
			{ x: 0, y: 5 },
		];
		const snap = snapPlacement(
			ell,
			{ width: 0.4, depth: 0.4 },
			{ x: 3.2, y: 1 },
		);
		const x = snap.guides.find((guide) => guide.axis === "x");
		// Nearest facing wall on x is x=6 (2.6 m away), not the notch at x=3.
		expect(x?.from.x).toBe(6);
		expect(snap.center.x).toBeCloseTo(3.2, 10);
	});

	it("centers an oversized item on the too-small axis", () => {
		const snap = snapPlacement(RECT, { width: 8, depth: 1 }, { x: 1, y: 1 });
		expect(snap.center.x).toBeCloseTo(3.2, 10);
		expect(snap.guides.some((guide) => guide.axis === "x")).toBe(false);
	});

	it("returns the quantized cursor untouched without an outline", () => {
		const snap = snapPlacement([], SOFA, { x: 2.026, y: 1.013 });
		expect(snap.center.x).toBeCloseTo(2.05, 10);
		expect(snap.center.y).toBeCloseTo(1.0, 10);
		expect(snap.guides).toEqual([]);
	});
});
