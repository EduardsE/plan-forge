import { describe, expect, it } from "vitest";
import {
	addFurniture,
	DUPLICATE_OFFSET,
	duplicateFurniture,
	formatFootprintCm,
	furnitureDisplayName,
	moveFurniture,
	removeFurniture,
	rotateFurniture,
} from "./furniture";
import { createSampleRoom } from "./sample-room";

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
});

describe("moveFurniture", () => {
	it("repositions the target item only, without mutating the input", () => {
		const room = createSampleRoom();
		const next = moveFurniture(room, "desk-chair-1", { x: 2.5, y: 3.15 });
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

	it("leaves the room unchanged for an unknown id", () => {
		const room = createSampleRoom();
		expect(moveFurniture(room, "nope", { x: 1, y: 1 }).furniture).toEqual(
			room.furniture,
		);
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
