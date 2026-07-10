import { describe, expect, it } from "vitest";
import {
	type FurniturePart,
	furnitureParts,
	HULL_RIM,
	mixHex,
	partHullScale,
	partScale,
} from "./furniture-parts";
import { CATALOG, catalogItemById } from "./model";

/**
 * Conservative world-space AABB of a part: the shape's local box half-extents
 * pushed through its euler rotation (|R|·e), offset by its center. For the
 * rotated parts (leaning mirror, clock face/hands) this is exactly the bound
 * that must stay inside the footprint.
 */
function partBounds(part: FurniturePart) {
	const { shape } = part;
	let e: [number, number, number];
	if (shape.kind === "box")
		e = [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
	else if (shape.kind === "cylinder") {
		const r = Math.max(shape.radiusTop, shape.radiusBottom);
		e = [r, shape.height / 2, r];
	} else e = [shape.radius, shape.radius * shape.squash, shape.radius];

	const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
	// Row-major XYZ-order rotation matrix, absolute values only.
	const cx = Math.cos(rx);
	const sx = Math.sin(rx);
	const cy = Math.cos(ry);
	const sy = Math.sin(ry);
	const cz = Math.cos(rz);
	const sz = Math.sin(rz);
	const m = [
		[cy * cz, -cy * sz, sy],
		[cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
		[sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
	];
	const extent = m.map(
		(row) =>
			Math.abs(row[0]) * e[0] +
			Math.abs(row[1]) * e[1] +
			Math.abs(row[2]) * e[2],
	);
	return {
		min: [
			part.position[0] - extent[0],
			part.position[1] - extent[1],
			part.position[2] - extent[2],
		],
		max: [
			part.position[0] + extent[0],
			part.position[1] + extent[1],
			part.position[2] + extent[2],
		],
	};
}

const EPS = 1e-6;

describe("furnitureParts", () => {
	it("composes more than a single box for every non-rug catalog item", () => {
		for (const entry of CATALOG) {
			const parts = furnitureParts(entry.id, entry.footprint);
			if (entry.id === "rug") expect(parts).toHaveLength(1);
			else expect(parts.length, entry.id).toBeGreaterThanOrEqual(2);
		}
	});

	it("keeps every part inside the footprint (plants' foliage excepted)", () => {
		for (const entry of CATALOG) {
			if (entry.category === "plants") continue;
			const { width, depth, height } = entry.footprint;
			for (const part of furnitureParts(entry.id, entry.footprint)) {
				const { min, max } = partBounds(part);
				expect(min[0], `${entry.id} min x`).toBeGreaterThanOrEqual(
					-width / 2 - EPS,
				);
				expect(max[0], `${entry.id} max x`).toBeLessThanOrEqual(
					width / 2 + EPS,
				);
				expect(min[1], `${entry.id} min y`).toBeGreaterThanOrEqual(-EPS);
				expect(max[1], `${entry.id} max y`).toBeLessThanOrEqual(height + EPS);
				expect(min[2], `${entry.id} min z`).toBeGreaterThanOrEqual(
					-depth / 2 - EPS,
				);
				expect(max[2], `${entry.id} max z`).toBeLessThanOrEqual(
					depth / 2 + EPS,
				);
			}
		}
	});

	it("puts backs at -z: sofa back, bed headboard, desk-chair back", () => {
		for (const id of ["sofa-2", "bed-double", "desk-chair"]) {
			const fp = catalogItemById(id)?.footprint;
			if (!fp) throw new Error(`missing catalog entry ${id}`);
			const parts = furnitureParts(id, fp);
			// The tallest part is the back/headboard; its center must sit behind.
			const tallest = parts.reduce((a, b) =>
				partBounds(b).max[1] > partBounds(a).max[1] ? b : a,
			);
			expect(tallest.position[2], id).toBeLessThan(0);
		}
	});

	it("keeps a wall item's back flush against the wall plane (-depth/2)", () => {
		const frame = catalogItemById("picture-frame");
		if (!frame) throw new Error("missing picture-frame");
		const parts = furnitureParts("picture-frame", frame.footprint);
		const backMost = Math.min(...parts.map((p) => partBounds(p).min[2]));
		expect(backMost).toBeCloseTo(-frame.footprint.depth / 2, 6);
	});

	it("falls back to the plain footprint box for unknown ids", () => {
		const fp = { width: 1.2, depth: 0.6, height: 0.9 };
		const parts = furnitureParts("not-in-catalog", fp);
		expect(parts).toHaveLength(1);
		expect(parts[0].shape).toEqual({ kind: "box", size: [1.2, 0.9, 0.6] });
		expect(parts[0].position).toEqual([0, 0.45, 0]);
	});

	it("scales furniture proportionally, not from absolute artwork", () => {
		const fp = catalogItemById("sofa-2")?.footprint;
		if (!fp) throw new Error("missing sofa-2");
		const doubled = { width: fp.width, depth: fp.depth, height: fp.height * 2 };
		const [back] = furnitureParts("sofa-2", fp);
		const [tallBack] = furnitureParts("sofa-2", doubled);
		if (back.shape.kind !== "box" || tallBack.shape.kind !== "box")
			throw new Error("sofa back should be a box");
		expect(tallBack.shape.size[1]).toBeCloseTo(back.shape.size[1] * 2, 6);
	});
});

describe("part scales", () => {
	it("squashes spheres vertically, leaves other shapes alone", () => {
		expect(partScale({ kind: "sphere", radius: 0.4, squash: 0.92 })).toEqual([
			1, 0.92, 1,
		]);
		expect(partScale({ kind: "box", size: [1, 1, 1] })).toEqual([1, 1, 1]);
	});

	it("inflates the hull by the rim on every side", () => {
		expect(partHullScale({ kind: "box", size: [1, 2, 4] })).toEqual([
			1 + 2 * HULL_RIM,
			(2 + 2 * HULL_RIM) / 2,
			(4 + 2 * HULL_RIM) / 4,
		]);
		const [kx, ky, kz] = partHullScale({
			kind: "cylinder",
			radiusTop: 0.1,
			radiusBottom: 0.2,
			height: 0.5,
		});
		expect(kx).toBeCloseTo((0.2 + HULL_RIM) / 0.2, 9);
		expect(kz).toBe(kx);
		expect(ky).toBeCloseTo((0.5 + 2 * HULL_RIM) / 0.5, 9);
		const [sx, sy] = partHullScale({
			kind: "sphere",
			radius: 0.5,
			squash: 0.9,
		});
		expect(sx).toBeCloseTo(1.04, 9);
		expect(sy).toBeCloseTo(1.04 * 0.9, 9);
	});
});

describe("mixHex", () => {
	it("blends #rrggbb endpoints linearly", () => {
		expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
		expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
		expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mixHex("#ce7b52", "#ce7b52", 0.7)).toBe("#ce7b52");
	});
});
