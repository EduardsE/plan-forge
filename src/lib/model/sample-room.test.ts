import { describe, expect, it } from "vitest";
import { floorArea, outlineBounds, wallLength, wallsOf } from "./geometry";
import { createSampleRoom } from "./sample-room";
import type { FurnitureItem } from "./types";
import { deriveMountTransform, wallFrames } from "./wall-mount";

/** Axis-aligned x/y half-extents of a footprint after rotation. */
function halfExtents(item: FurnitureItem): { hx: number; hy: number } {
	const radians = (item.rotation * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	const { width, depth } = item.footprint;
	return {
		hx: (width * cos + depth * sin) / 2,
		hy: (width * sin + depth * cos) / 2,
	};
}

describe("createSampleRoom", () => {
	it("computes the mockup's 33.28 m² from the area helper", () => {
		expect(floorArea(createSampleRoom().outline)).toBeCloseTo(33.28, 10);
	});

	it("spans 6.40 × 5.20 m", () => {
		const bounds = outlineBounds(createSampleRoom().outline);
		expect(bounds?.width).toBeCloseTo(6.4, 10);
		expect(bounds?.height).toBeCloseTo(5.2, 10);
	});

	it("has one door and one window, each fitting inside its host wall", () => {
		const room = createSampleRoom();
		const walls = wallsOf(room.outline);
		expect(room.openings.map((o) => o.kind).sort()).toEqual(["door", "window"]);
		for (const opening of room.openings) {
			const wall = walls[opening.wallIndex];
			expect(wall).toBeDefined();
			expect(opening.offset).toBeGreaterThan(0);
			expect(opening.offset + opening.width).toBeLessThan(wallLength(wall));
		}
	});

	it("places every furniture item fully inside the room", () => {
		const room = createSampleRoom();
		expect(room.furniture).toHaveLength(7);
		// Wall-mounted items sit flush against a wall face, so a footprint edge
		// lands exactly on the boundary (within floating-point noise).
		const EPS = 1e-9;
		for (const item of room.furniture) {
			const { hx, hy } = halfExtents(item);
			expect(item.position.x - hx).toBeGreaterThanOrEqual(-EPS);
			expect(item.position.x + hx).toBeLessThanOrEqual(6.4 + EPS);
			expect(item.position.y - hy).toBeGreaterThanOrEqual(-EPS);
			expect(item.position.y + hy).toBeLessThanOrEqual(5.2 + EPS);
		}
	});

	it("gives every item a unique id", () => {
		const room = createSampleRoom();
		const ids = [
			...room.openings.map((o) => o.id),
			...room.furniture.map((f) => f.id),
		];
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("returns a fresh room on every call", () => {
		const a = createSampleRoom();
		const b = createSampleRoom();
		expect(a).not.toBe(b);
		a.furniture.pop();
		expect(b.furniture).toHaveLength(7);
	});

	it("keeps the wall-mounted frame's position/rotation in sync with its mount", () => {
		const room = createSampleRoom();
		const frame = room.furniture.find((item) => item.mount);
		expect(frame?.mount).toBeDefined();
		if (!frame?.mount) return;
		const wall = wallFrames(room.outline).find(
			(f) => f.index === frame.mount?.wallIndex,
		);
		expect(wall).toBeDefined();
		if (!wall) return;
		const derived = deriveMountTransform(
			wall,
			frame.mount.offset,
			frame.footprint,
		);
		expect(frame.position.x).toBeCloseTo(derived.position.x);
		expect(frame.position.y).toBeCloseTo(derived.position.y);
		expect(frame.rotation).toBeCloseTo(derived.rotation);
	});
});
