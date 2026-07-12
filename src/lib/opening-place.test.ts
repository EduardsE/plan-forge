import { describe, expect, it } from "vitest";
import { createSampleRoom } from "#/lib/model";
import {
  MIN_OPENING_WIDTH,
  offsetAlongWall,
  openingCornerGuides,
  resizeOpening,
  slideOpening,
} from "#/lib/opening-place";
import { buildWallSolids } from "#/lib/room-scene";

const solids = buildWallSolids(createSampleRoom());
// Sample room walls: 0 = top (y=0, +x), 1 = right (x=6.4, +y),
// 2 = bottom (y=5.2, -x), 3 = left (x=0, -y).
const top = solids[0];
const right = solids[1];
const bottom = solids[2];

describe("offsetAlongWall", () => {
  it("projects onto the wall direction from its start corner", () => {
    expect(offsetAlongWall(top, { x: 2.5, y: 0 })).toBeCloseTo(2.5);
    expect(offsetAlongWall(right, { x: 6.4, y: 1.2 })).toBeCloseTo(1.2);
    // The bottom wall runs right-to-left, so offsets count from x=6.4.
    expect(offsetAlongWall(bottom, { x: 4.4, y: 5.2 })).toBeCloseTo(2);
  });

  it("ignores the across-wall component of the point", () => {
    expect(offsetAlongWall(top, { x: 2.5, y: 0.8 })).toBeCloseTo(2.5);
  });
});

describe("slideOpening", () => {
  it("quantizes the offset to the grid", () => {
    expect(slideOpening(6.4, 0.9, [], 2.13)).toBeCloseTo(2.15);
  });

  it("clamps to the wall ends", () => {
    expect(slideOpening(6.4, 0.9, [], -3)).toBe(0);
    expect(slideOpening(6.4, 0.9, [], 9)).toBeCloseTo(5.5);
  });

  it("clamps against a neighboring opening instead of overlapping it", () => {
    // Neighbor occupies [3.5, 5.6]; approaching from the left stops flush.
    expect(
      slideOpening(6.4, 0.9, [{ start: 3.5, width: 2.1 }], 3.1),
    ).toBeCloseTo(2.6);
  });

  it("jumps to the gap on the far side when the cursor is clearly there", () => {
    expect(slideOpening(6.4, 0.9, [{ start: 2, width: 2 }], 4.3)).toBeCloseTo(
      4.3,
    );
  });

  it("returns null when no gap fits the width", () => {
    expect(slideOpening(0.6, 0.9, [], 0)).toBe(null);
    expect(slideOpening(4, 1.5, [{ start: 1, width: 2 }], 0.2)).toBe(null);
  });

  it("still lands flush when clamping leaves the grid", () => {
    // Gap edge at 1.03 is off-grid; flush placement beats quantization.
    expect(
      slideOpening(6.4, 0.9, [{ start: 0, width: 1.03 }], 0.9),
    ).toBeCloseTo(1.03);
  });
});

describe("openingCornerGuides", () => {
  it("measures from both wall corners to the opening edges, inside the room", () => {
    const guides = openingCornerGuides(top, 3.5, 2.1, 0.18);
    expect(guides).toHaveLength(2);
    expect(guides[0].distance).toBeCloseTo(3.5);
    expect(guides[0].from).toEqual({ x: 0, y: 0.18 });
    expect(guides[0].to).toEqual({ x: 3.5, y: 0.18 });
    expect(guides[1].distance).toBeCloseTo(0.8);
    expect(guides[1].from).toEqual({ x: 5.6, y: 0.18 });
    expect(guides[1].to).toEqual({ x: 6.4, y: 0.18 });
  });

  it("drops the guide for a flush edge", () => {
    const guides = openingCornerGuides(top, 0, 2.1, 0.18);
    expect(guides).toHaveLength(1);
    expect(guides[0].distance).toBeCloseTo(6.4 - 2.1);
  });

  it("draws inside vertical walls too", () => {
    const guides = openingCornerGuides(right, 3.6, 0.95, 0.18);
    expect(guides[0].from).toEqual({ x: 6.4 - 0.18, y: 0 });
    expect(guides[0].to).toEqual({ x: 6.4 - 0.18, y: 3.6 });
  });
});

describe("resizeOpening", () => {
  // Sample fixtures: window-1 on the top wall (offset 3.5, width 2.1, wall
  // 6.4 m), door-1 on the right wall (offset 3.6, width 0.95, wall 5.2 m).
  it("widens about the center when the wall has room", () => {
    const room = resizeOpening(createSampleRoom(), "door-1", 1.55);
    const door = room.openings.find((o) => o.id === "door-1");
    expect(door?.width).toBeCloseTo(1.55);
    // Center stays at 3.6 + 0.95 / 2 = 4.075.
    expect(door?.offset).toBeCloseTo(4.075 - 1.55 / 2);
  });

  it("clamps the width to the wall and slides flush to the corners", () => {
    const room = resizeOpening(createSampleRoom(), "door-1", 12);
    const door = room.openings.find((o) => o.id === "door-1");
    expect(door?.width).toBeCloseTo(5.2);
    expect(door?.offset).toBeCloseTo(0);
  });

  it("clamps against a neighboring opening on the same wall", () => {
    let room = createSampleRoom();
    // A second window right of the first: gap [0, 3.5] holds the resize
    // target once the first window moves there.
    room = {
      ...room,
      openings: [
        ...room.openings,
        { id: "window-2", kind: "window", wallIndex: 0, offset: 1, width: 1 },
      ],
    };
    const next = resizeOpening(room, "window-1", 6);
    const win = next.openings.find((o) => o.id === "window-1");
    // Free gap is [2, 6.4] (after window-2's far edge), so 4.4 max.
    expect(win?.width).toBeCloseTo(4.4);
    expect(win?.offset).toBeCloseTo(2);
  });

  it("clamps against extra blocked spans (a neighbor's portal holes)", () => {
    // door-1 sits at [3.6, 4.55] on the right wall; a neighbor room's portal
    // hole occupies [4.8, 5.2], so growth stops at its near edge.
    const room = resizeOpening(createSampleRoom(), "door-1", 12, [
      { start: 4.8, width: 0.4 },
    ]);
    const door = room.openings.find((o) => o.id === "door-1");
    expect(door?.width).toBeCloseTo(4.8);
    expect(door?.offset).toBeCloseTo(0);
  });

  it("enforces the minimum width", () => {
    const room = resizeOpening(createSampleRoom(), "door-1", 0.05);
    expect(room.openings.find((o) => o.id === "door-1")?.width).toBeCloseTo(
      MIN_OPENING_WIDTH,
    );
  });

  it("returns the room unchanged for unknown ids and no-op widths", () => {
    const room = createSampleRoom();
    expect(resizeOpening(room, "nope", 1)).toBe(room);
    expect(resizeOpening(room, "door-1", 0.95)).toBe(room);
  });
});
