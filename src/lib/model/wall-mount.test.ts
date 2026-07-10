import { describe, expect, it } from "vitest";
import {
	DEFAULT_MOUNT_ELEVATION,
	defaultMountElevation,
	deriveMountTransform,
	isWallItem,
	wallFrames,
} from "./wall-mount";

/** The sample room outline, wound clockwise in y-down plan coords. */
const OUTLINE = [
	{ x: 0, y: 0 },
	{ x: 6.4, y: 0 },
	{ x: 6.4, y: 5.2 },
	{ x: 0, y: 5.2 },
];

describe("wallFrames", () => {
	it("derives one frame per wall with outward normals pointing out of the room", () => {
		const frames = wallFrames(OUTLINE);
		expect(frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);
		// Top wall runs +x, its outward normal points up (out of the room = -y).
		expect(frames[0].dir).toEqual({ x: 1, y: 0 });
		expect(frames[0].outward.x).toBeCloseTo(0);
		expect(frames[0].outward.y).toBeCloseTo(-1);
		// Left wall runs -y (from (0,5.2) to (0,0)); outward points -x.
		expect(frames[3].dir).toEqual({ x: 0, y: -1 });
		expect(frames[3].outward.x).toBeCloseTo(-1);
		expect(frames[3].outward.y).toBeCloseTo(0);
		expect(frames[0].length).toBeCloseTo(6.4);
		expect(frames[3].length).toBeCloseTo(5.2);
	});

	it("yields no frames for a degenerate outline", () => {
		expect(
			wallFrames([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
			]),
		).toEqual([]);
	});
});

describe("deriveMountTransform", () => {
	it("centers the item along the wall and pushes its back flush to the face", () => {
		const frames = wallFrames(OUTLINE);
		const footprint = { width: 0.9, depth: 0.06 };
		// Top wall, near-edge offset 2.0 → center at along 2.45, pushed into the
		// room (down, +y) by depth/2 = 0.03.
		const { position, rotation } = deriveMountTransform(
			frames[0],
			2.0,
			footprint,
		);
		expect(position.x).toBeCloseTo(2.45);
		expect(position.y).toBeCloseTo(0.03);
		expect(rotation).toBeCloseTo(0);
	});

	it("turns the width axis to align with the wall direction", () => {
		const frames = wallFrames(OUTLINE);
		// Left wall points -y; its yaw is 90° so the item's width runs vertically.
		const { rotation } = deriveMountTransform(frames[3], 1.0, {
			width: 0.9,
			depth: 0.06,
		});
		expect(rotation).toBeCloseTo(90);
	});
});

describe("defaultMountElevation", () => {
	it("hangs a picture frame lower than a clock", () => {
		expect(defaultMountElevation("picture-frame")).toBe(1.5);
		expect(defaultMountElevation("wall-clock")).toBe(1.9);
	});

	it("falls back for unknown ids", () => {
		expect(defaultMountElevation("mystery")).toBe(DEFAULT_MOUNT_ELEVATION);
	});
});

describe("isWallItem", () => {
	it("is true only for the wall-items category", () => {
		expect(isWallItem("picture-frame")).toBe(true);
		expect(isWallItem("wall-clock")).toBe(true);
		expect(isWallItem("desk")).toBe(false);
		expect(isWallItem("nope")).toBe(false);
	});
});
