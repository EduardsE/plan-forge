import { describe, expect, it } from "vitest";
import { floorArea, outlineBounds, wallLength, wallsOf } from "./geometry";
import { createSampleRoom } from "./sample-room";
import type { FurnitureItem } from "./types";

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
		expect(room.furniture).toHaveLength(6);
		for (const item of room.furniture) {
			const { hx, hy } = halfExtents(item);
			expect(item.position.x - hx).toBeGreaterThanOrEqual(0);
			expect(item.position.x + hx).toBeLessThanOrEqual(6.4);
			expect(item.position.y - hy).toBeGreaterThanOrEqual(0);
			expect(item.position.y + hy).toBeLessThanOrEqual(5.2);
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
		expect(b.furniture).toHaveLength(6);
	});
});
