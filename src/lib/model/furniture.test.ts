import { describe, expect, it } from "vitest";
import {
	addFurniture,
	DUPLICATE_OFFSET,
	duplicateFurniture,
	footprintCorners,
	formatFootprintCm,
	furnitureDisplayName,
	removeFurniture,
	rotateFurniture,
	updateFurniture,
} from "./furniture";
import { createSampleRoom } from "./sample-room";
import { deriveMountTransform, wallFrames } from "./wall-mount";

describe("rotateFurniture", () => {
	it("adds the delta to the target item only", () => {
		const room = createSampleRoom();
		const next = rotateFurniture(room, "desk-1", -90);
		expect(next.furniture.find((item) => item.id === "desk-1")?.rotation).toBe(
			270,
		);
		expect(
			next.furniture.find((item) => item.id === "credenza-1")?.rotation,
		).toBe(90);
	});

	it("normalizes past a full turn", () => {
		const room = rotateFurniture(createSampleRoom(), "credenza-1", 360 + 45);
		expect(
			room.furniture.find((item) => item.id === "credenza-1")?.rotation,
		).toBe(135);
	});

	it("does not mutate the input room", () => {
		const room = createSampleRoom();
		rotateFurniture(room, "desk-1", 90);
		expect(room.furniture.find((item) => item.id === "desk-1")?.rotation).toBe(
			0,
		);
	});
});

describe("duplicateFurniture", () => {
	it("appends an offset copy under the new id", () => {
		const room = createSampleRoom();
		const next = duplicateFurniture(room, "desk-chair-1", "desk-chair-2");
		expect(next.furniture).toHaveLength(room.furniture.length + 1);
		const copy = next.furniture.at(-1);
		expect(copy).toMatchObject({
			id: "desk-chair-2",
			catalogId: "desk-chair",
			rotation: 0,
			footprint: { width: 0.64, depth: 0.64, height: 1.04 },
		});
		expect(copy?.position).toEqual({
			x: 4.52 + DUPLICATE_OFFSET,
			y: 2.22 + DUPLICATE_OFFSET,
		});
	});

	it("returns the room unchanged for an unknown id", () => {
		const room = createSampleRoom();
		expect(duplicateFurniture(room, "nope", "nope-2")).toBe(room);
	});

	it("shifts a wall-mounted copy along its host wall, staying flush", () => {
		const room = createSampleRoom();
		const source = room.furniture.find((item) => item.mount);
		expect(source?.mount).toBeDefined();
		if (!source?.mount) return;
		const next = duplicateFurniture(room, source.id, "frame-copy");
		const copy = next.furniture.find((item) => item.id === "frame-copy");
		expect(copy?.mount).toMatchObject({
			wallIndex: source.mount.wallIndex,
			offset: source.mount.offset + DUPLICATE_OFFSET,
			elevation: source.mount.elevation,
		});
		// Position/rotation re-derive from the shifted mount, not a plain nudge.
		const frame = wallFrames(room.outline).find(
			(f) => f.index === source.mount?.wallIndex,
		);
		if (!frame) throw new Error("host wall missing");
		const expected = deriveMountTransform(
			frame,
			source.mount.offset + DUPLICATE_OFFSET,
			source.footprint,
		);
		expect(copy?.position.x).toBeCloseTo(expected.position.x);
		expect(copy?.position.y).toBeCloseTo(expected.position.y);
		expect(copy?.rotation).toBeCloseTo(expected.rotation);
	});
});

describe("updateFurniture", () => {
	it("repositions the target item only, without mutating the input", () => {
		const room = createSampleRoom();
		const next = updateFurniture(room, "desk-chair-1", {
			position: { x: 2.5, y: 3.15 },
		});
		expect(
			next.furniture.find((item) => item.id === "desk-chair-1")?.position,
		).toEqual({ x: 2.5, y: 3.15 });
		expect(
			next.furniture.find((item) => item.id === "desk-1")?.position,
		).toEqual({ x: 4.7, y: 0.73 });
		expect(
			room.furniture.find((item) => item.id === "desk-chair-1")?.position,
		).toEqual({ x: 4.52, y: 2.22 });
	});

	it("applies rotation and mount when the update carries them", () => {
		const room = createSampleRoom();
		const mount = { wallIndex: 2, offset: 1.1, elevation: 1.4 };
		const next = updateFurniture(room, "desk-chair-1", {
			position: { x: 3, y: 5 },
			rotation: 180,
			mount,
		});
		const item = next.furniture.find((entry) => entry.id === "desk-chair-1");
		expect(item?.rotation).toBe(180);
		expect(item?.mount).toEqual(mount);
	});

	it("leaves an item's rotation and mount untouched when the update omits them", () => {
		const room = createSampleRoom();
		const source = room.furniture.find((item) => item.mount);
		if (!source) throw new Error("no mounted fixture");
		const next = updateFurniture(room, source.id, {
			position: { x: 1, y: 1 },
		});
		const item = next.furniture.find((entry) => entry.id === source.id);
		expect(item?.rotation).toBe(source.rotation);
		expect(item?.mount).toEqual(source.mount);
	});

	it("leaves the room unchanged for an unknown id", () => {
		const room = createSampleRoom();
		expect(
			updateFurniture(room, "nope", { position: { x: 1, y: 1 } }).furniture,
		).toEqual(room.furniture);
	});
});

describe("removeFurniture", () => {
	it("removes the item without mutating the input", () => {
		const room = createSampleRoom();
		const next = removeFurniture(room, "rug-1");
		expect(next.furniture.some((item) => item.id === "rug-1")).toBe(false);
		expect(next.furniture).toHaveLength(room.furniture.length - 1);
		expect(room.furniture.some((item) => item.id === "rug-1")).toBe(true);
	});
});

describe("addFurniture", () => {
	it("appends the item without mutating the input", () => {
		const room = createSampleRoom();
		const item = {
			id: "sofa-2-1",
			catalogId: "sofa-2",
			position: { x: 3, y: 3.8 },
			rotation: 0,
			footprint: { width: 1.68, depth: 0.88, height: 0.82 },
		};
		const next = addFurniture(room, item);
		expect(next.furniture.at(-1)).toBe(item);
		expect(next.furniture).toHaveLength(room.furniture.length + 1);
		expect(room.furniture.some((entry) => entry.id === "sofa-2-1")).toBe(false);
	});
});

describe("furnitureDisplayName", () => {
	it("uses the catalog name when the id is known", () => {
		expect(furnitureDisplayName("sofa-2")).toBe("Sofa · 2-seat");
		expect(furnitureDisplayName("plant")).toBe("Potted Plant");
	});

	it("falls back to a title-cased slug for unknown ids", () => {
		expect(furnitureDisplayName("bean-bag")).toBe("Bean Bag");
	});
});

describe("formatFootprintCm", () => {
	it("renders whole centimeters in the mockup format", () => {
		expect(formatFootprintCm({ width: 0.64, depth: 0.64, height: 1.04 })).toBe(
			"64 × 64 · H 104 cm",
		);
	});

	it("rounds sub-centimeter values", () => {
		expect(formatFootprintCm({ width: 0.945, depth: 0.4, height: 2.052 })).toBe(
			"95 × 40 · H 205 cm",
		);
	});
});

describe("footprintCorners", () => {
	it("returns the axis-aligned corners of an unrotated item", () => {
		const corners = footprintCorners({
			id: "f1",
			catalogId: "sofa-2",
			position: { x: 2, y: 3 },
			rotation: 0,
			footprint: { width: 2, depth: 1, height: 0.8 },
		});
		expect(corners).toEqual([
			{ x: 1, y: 2.5 },
			{ x: 3, y: 2.5 },
			{ x: 3, y: 3.5 },
			{ x: 1, y: 3.5 },
		]);
	});

	it("swaps the extents at 90°", () => {
		const corners = footprintCorners({
			id: "f1",
			catalogId: "sofa-2",
			position: { x: 0, y: 0 },
			rotation: 90,
			footprint: { width: 2, depth: 1, height: 0.8 },
		});
		const xs = corners.map((c) => c.x);
		const ys = corners.map((c) => c.y);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
		expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2);
	});
});
