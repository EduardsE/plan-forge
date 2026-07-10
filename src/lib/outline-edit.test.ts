import { describe, expect, it } from "vitest";
import type { FurnitureItem, Opening, Point, Room } from "#/lib/model";
import {
	applyOutlineDraft,
	draftFromRoom,
	sameOutline,
	setClosedSegmentLength,
	snapCornerDrag,
	splitOutlineWall,
	splitPointOnWall,
} from "./outline-edit";

const TOL = 0.1;

/** 6 × 5 rectangle: walls 0 bottom→, 1 right↓… (plan coords, y down). */
const RECT: Point[] = [
	{ x: 0, y: 0 },
	{ x: 6, y: 0 },
	{ x: 6, y: 5 },
	{ x: 0, y: 5 },
];

function opening(overrides: Partial<Opening>): Opening {
	return {
		id: "o1",
		kind: "door",
		wallIndex: 0,
		offset: 1,
		width: 0.9,
		...overrides,
	};
}

function item(overrides: Partial<FurnitureItem>): FurnitureItem {
	return {
		id: "f1",
		catalogId: "sofa-2",
		position: { x: 3, y: 2.5 },
		rotation: 0,
		footprint: { width: 1.8, depth: 0.9, height: 0.8 },
		...overrides,
	};
}

function room(overrides: Partial<Room>): Room {
	return {
		name: "Test",
		outline: RECT,
		openings: [],
		furniture: [],
		...overrides,
	};
}

describe("draftFromRoom", () => {
	it("opens an existing outline as a closed draft carrying the openings", () => {
		const source = room({ openings: [opening({})] });
		const draft = draftFromRoom(source);
		expect(draft.closed).toBe(true);
		expect(draft.corners).toEqual(RECT);
		expect(draft.openings).toEqual(source.openings);
	});

	it("falls back to a blank open draft when the outline is empty", () => {
		const draft = draftFromRoom(room({ outline: [] }));
		expect(draft.closed).toBe(false);
		expect(draft.corners).toEqual([]);
	});
});

describe("sameOutline", () => {
	it("matches identical corner lists and rejects any drift", () => {
		expect(sameOutline(RECT, [...RECT])).toBe(true);
		expect(sameOutline(RECT, RECT.slice(0, 3))).toBe(false);
		expect(sameOutline(RECT, [{ x: 0.05, y: 0 }, ...RECT.slice(1)])).toBe(
			false,
		);
	});
});

describe("snapCornerDrag", () => {
	it("locks each axis to the nearest other corner within tolerance", () => {
		// Dragging the bottom-right corner near its original spot: x matches the
		// top-right corner, y matches the bottom-left one.
		const snap = snapCornerDrag(RECT, 1, { x: 6.04, y: 0.06 }, TOL);
		expect(snap.point).toEqual({ x: 6, y: 0 });
		expect(snap.guides).toEqual([
			{ cornerIndex: 2, axis: "x" },
			{ cornerIndex: 0, axis: "y" },
		]);
	});

	it("quantizes free coordinates to the draw grid", () => {
		const snap = snapCornerDrag(RECT, 1, { x: 7.32, y: 1.28 }, TOL);
		expect(snap.point).toEqual({ x: 7.3, y: 1.3 });
		expect(snap.guides).toEqual([]);
	});

	it("never snaps to the corner being dragged", () => {
		const snap = snapCornerDrag(RECT, 1, { x: 6.04, y: 1.5 }, TOL);
		expect(snap.guides).toEqual([{ cornerIndex: 2, axis: "x" }]);
	});

	it("passes the raw cursor through when snapping is off", () => {
		// Would otherwise lock both axes onto the neighboring corners.
		const snap = snapCornerDrag(RECT, 1, { x: 6.04, y: 0.06 }, TOL, false);
		expect(snap.point).toEqual({ x: 6.04, y: 0.06 });
		expect(snap.guides).toEqual([]);
	});
});

describe("splitPointOnWall", () => {
	it("projects the cursor onto the wall and quantizes along it", () => {
		// Wall 1 runs down the right side; the cursor hovers just off it.
		expect(splitPointOnWall(RECT, 1, { x: 6.08, y: 2.53 })).toEqual({
			x: 6,
			y: 2.55,
		});
	});

	it("refuses splits within the corner clearance", () => {
		expect(splitPointOnWall(RECT, 0, { x: 0.1, y: 0 })).toBeNull();
		expect(splitPointOnWall(RECT, 0, { x: 5.9, y: 0 })).toBeNull();
		expect(splitPointOnWall(RECT, 0, { x: 0.5, y: 0 })).toEqual({
			x: 0.5,
			y: 0,
		});
	});

	it("refuses walls too short to hold two clearances", () => {
		const tiny: Point[] = [
			{ x: 0, y: 0 },
			{ x: 0.4, y: 0 },
			{ x: 0.4, y: 0.4 },
		];
		expect(splitPointOnWall(tiny, 0, { x: 0.2, y: 0 })).toBeNull();
	});
});

describe("splitOutlineWall", () => {
	it("inserts the corner after the wall's start", () => {
		const { outline } = splitOutlineWall(RECT, [], 0, { x: 2.5, y: 0 });
		expect(outline).toEqual([
			{ x: 0, y: 0 },
			{ x: 2.5, y: 0 },
			{ x: 6, y: 0 },
			{ x: 6, y: 5 },
			{ x: 0, y: 5 },
		]);
	});

	it("shifts openings on later walls by one wall index", () => {
		const { openings } = splitOutlineWall(
			RECT,
			[opening({ wallIndex: 2, offset: 1.2 })],
			0,
			{ x: 2.5, y: 0 },
		);
		expect(openings).toEqual([opening({ wallIndex: 3, offset: 1.2 })]);
	});

	it("keeps an opening before the split on the first piece", () => {
		const { openings } = splitOutlineWall(
			RECT,
			[opening({ offset: 1, width: 0.9 })],
			0,
			{ x: 2.5, y: 0 },
		);
		expect(openings).toEqual([opening({ offset: 1, width: 0.9 })]);
	});

	it("re-anchors an opening after the split to the second piece", () => {
		const { openings } = splitOutlineWall(
			RECT,
			[opening({ offset: 4, width: 0.9 })],
			0,
			{ x: 2.5, y: 0 },
		);
		expect(openings).toEqual([
			opening({ wallIndex: 1, offset: 1.5, width: 0.9 }),
		]);
	});

	it("clamps an opening straddling the split into the piece holding its center", () => {
		// Center at 2.45 < 2.5 → first piece [0, 2.5], clamped to end at 2.5.
		const { openings } = splitOutlineWall(
			RECT,
			[opening({ offset: 2, width: 0.9 })],
			0,
			{ x: 2.5, y: 0 },
		);
		expect(openings).toEqual([opening({ offset: 1.6, width: 0.9 })]);
	});

	it("drops an opening wider than the piece it lands on", () => {
		const { openings } = splitOutlineWall(
			RECT,
			[opening({ offset: 0, width: 0.9 })],
			0,
			{ x: 0.5, y: 0 },
		);
		expect(openings).toEqual([]);
	});
});

describe("setClosedSegmentLength", () => {
	it("stretches a rectangle wall by sliding the whole far side", () => {
		const next = setClosedSegmentLength(RECT, 0, 7);
		expect(next).toEqual([
			{ x: 0, y: 0 },
			{ x: 7, y: 0 },
			{ x: 7, y: 5 },
			{ x: 0, y: 5 },
		]);
	});

	it("stops propagating at the first wall parallel to the shift", () => {
		// L-shape: stretching the bottom wall slides the right side; the first
		// horizontal wall (C→D) absorbs the shift by lengthening.
		const lShape: Point[] = [
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
			{ x: 6, y: 3 },
			{ x: 4, y: 3 },
			{ x: 4, y: 5 },
			{ x: 0, y: 5 },
		];
		const next = setClosedSegmentLength(lShape, 0, 7);
		expect(next).toEqual([
			{ x: 0, y: 0 },
			{ x: 7, y: 0 },
			{ x: 7, y: 3 },
			{ x: 4, y: 3 },
			{ x: 4, y: 5 },
			{ x: 0, y: 5 },
		]);
	});

	it("edits the closing wall too", () => {
		const next = setClosedSegmentLength(RECT, 3, 6);
		expect(next).toEqual([
			{ x: 0, y: -1 },
			{ x: 6, y: -1 },
			{ x: 6, y: 5 },
			{ x: 0, y: 5 },
		]);
	});

	it("ignores invalid input", () => {
		expect(setClosedSegmentLength(RECT, 4, 3)).toBe(RECT);
		expect(setClosedSegmentLength(RECT, 0, 0)).toBe(RECT);
		expect(setClosedSegmentLength(RECT, 0, Number.NaN)).toBe(RECT);
	});
});

describe("applyOutlineDraft", () => {
	it("keeps openings whose wall still fits them, clamping the offset", () => {
		// Wall 0 shrinks to 2 m: the 0.9 door at offset 1.5 slides back to fit.
		const corners: Point[] = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 5 },
			{ x: 0, y: 5 },
		];
		const next = applyOutlineDraft(room({}), corners, [
			opening({ offset: 1.5, width: 0.9 }),
		]);
		expect(next.openings).toEqual([opening({ offset: 1.1, width: 0.9 })]);
		expect(next.outline).toBe(corners);
		expect(next.name).toBe("Test");
	});

	it("drops openings wider than their resized wall", () => {
		const corners: Point[] = [
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: 0.5, y: 5 },
			{ x: 0, y: 5 },
		];
		const next = applyOutlineDraft(room({}), corners, [
			opening({ offset: 0, width: 0.9 }),
		]);
		expect(next.openings).toEqual([]);
	});

	it("never lets two clamped openings overlap", () => {
		// Both fit a 2 m wall alone but must stack, not overlap.
		const corners: Point[] = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 5 },
			{ x: 0, y: 5 },
		];
		const next = applyOutlineDraft(room({}), corners, [
			opening({ id: "a", offset: 1.1, width: 0.9 }),
			opening({ id: "b", offset: 1.1, width: 0.9 }),
		]);
		expect(next.openings).toHaveLength(2);
		const [a, b] = next.openings;
		expect(
			a.offset + a.width <= b.offset || b.offset + b.width <= a.offset,
		).toBe(true);
	});

	it("keeps furniture inside the new outline and drops the rest", () => {
		const inside = item({ id: "in", position: { x: 1.5, y: 2.5 } });
		const outside = item({ id: "out", position: { x: 5, y: 2.5 } });
		const corners: Point[] = [
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: 5 },
			{ x: 0, y: 5 },
		];
		const next = applyOutlineDraft(
			room({ furniture: [inside, outside] }),
			corners,
			[],
		);
		expect(next.furniture.map((f) => f.id)).toEqual(["in"]);
	});

	it("keeps furniture flush against a wall", () => {
		// 0.9 deep item centered 0.45 from the wall: its edge lies exactly on it.
		const flush = item({ position: { x: 3, y: 0.45 } });
		const next = applyOutlineDraft(room({ furniture: [flush] }), RECT, []);
		expect(next.furniture).toHaveLength(1);
	});

	it("accounts for rotation when testing the fit", () => {
		// 1.8 wide item in a 1.2-wide sliver: fits rotated 90°, not at 0°.
		const corners: Point[] = [
			{ x: 0, y: 0 },
			{ x: 1.2, y: 0 },
			{ x: 1.2, y: 5 },
			{ x: 0, y: 5 },
		];
		const upright = item({ position: { x: 0.6, y: 2.5 }, rotation: 90 });
		const sideways = item({ position: { x: 0.6, y: 2.5 }, rotation: 0 });
		expect(
			applyOutlineDraft(room({ furniture: [upright] }), corners, []).furniture,
		).toHaveLength(1);
		expect(
			applyOutlineDraft(room({ furniture: [sideways] }), corners, []).furniture,
		).toHaveLength(0);
	});
});
