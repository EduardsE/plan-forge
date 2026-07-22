import { describe, expect, it } from "vitest";
import { defaultVerticals, deriveFloor, type Floor } from "#/lib/model";
import {
  offsetAlongWall,
  openingAt,
  openingCornerGuides,
  openingVerticalGuides,
  slideOpening,
} from "#/lib/opening-place";
import { buildEdgeSolids } from "#/lib/room-scene";

/** A single rectangular room, 6.4 × 5.2, wound positively. */
function rectFloor(): Floor {
  return {
    id: "fixture",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 6.4, y: 0 },
      { id: "c", x: 6.4, y: 5.2 },
      { id: "d", x: 0, y: 5.2 },
    ],
    edges: [
      { id: "ab", a: "a", b: "b" },
      { id: "bc", a: "b", b: "c" },
      { id: "cd", a: "c", b: "d" },
      { id: "da", a: "d", b: "a" },
    ],
    openings: [],
    furniture: [],
    rooms: [{ id: "r", anchor: { x: 3, y: 2.5 } }],
    stairs: [],
  };
}
const solids = buildEdgeSolids(rectFloor(), deriveFloor(rectFloor()).rooms);
const byEdge = (edgeId: string) => {
  const solid = solids.find((s) => s.edgeId === edgeId);
  if (!solid) throw new Error(`no solid ${edgeId}`);
  return solid;
};
// ab = top (y=0, +x), bc = right (x=6.4, +y), cd = bottom (right→left).
const top = byEdge("ab");
const right = byEdge("bc");
const bottom = byEdge("cd");

describe("offsetAlongWall", () => {
  it("projects onto the edge direction from node a", () => {
    expect(offsetAlongWall(top, { x: 2.5, y: 0 })).toBeCloseTo(2.5);
    expect(offsetAlongWall(right, { x: 6.4, y: 1.2 })).toBeCloseTo(1.2);
    // The bottom edge runs right-to-left, so offsets count from x=6.4.
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
    expect(
      slideOpening(6.4, 0.9, [{ start: 3.5, width: 2.1 }], 3.1),
    ).toBeCloseTo(2.6);
  });

  it("returns null when no gap fits the width", () => {
    expect(slideOpening(0.6, 0.9, [], 0)).toBe(null);
    expect(slideOpening(4, 1.5, [{ start: 1, width: 2 }], 0.2)).toBe(null);
  });

  it("jumps to the far gap when the cursor is nearest it", () => {
    // A blocker fills the middle [1, 5]; the cursor at 4.5 is closest to the
    // far gap [5, 6.4], so the opening lands there rather than the near gap.
    expect(slideOpening(6.4, 0.9, [{ start: 1, width: 4 }], 4.5)).toBeCloseTo(
      5.0,
      6,
    );
  });

  it("lands flush against a neighbor even off the grid", () => {
    // The only gap is [0, 5.53]; a far cursor clamps flush to the blocker,
    // and flush beats the grid (4.63 is not a 0.05 multiple).
    expect(
      slideOpening(6.4, 0.9, [{ start: 5.53, width: 0.87 }], 9),
    ).toBeCloseTo(4.63, 6);
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
  });

  it("draws inside vertical walls too", () => {
    const guides = openingCornerGuides(right, 3.6, 0.95, 0.18);
    expect(guides[0].from).toEqual({ x: 6.4 - 0.18, y: 0 });
    expect(guides[0].to).toEqual({ x: 6.4 - 0.18, y: 3.6 });
  });

  it("drops the guide for a corner the opening sits flush against", () => {
    // Flush at the near corner (offset 0): only the far guide survives.
    const near = openingCornerGuides(top, 0, 2.1, 0.18);
    expect(near).toHaveLength(1);
    expect(near[0].id).toBe("far");
    // Flush at the far corner (offset + width === length): only the near one.
    const far = openingCornerGuides(top, top.length - 2.1, 2.1, 0.18);
    expect(far).toHaveLength(1);
    expect(far[0].id).toBe("near");
  });
});

describe("openingVerticalGuides", () => {
  it("measures floor→sill and head→ceiling at the hole's center", () => {
    const guides = openingVerticalGuides(3.55, 2.1, 0.36, 1.94, 2.5);
    expect(guides).toHaveLength(2);
    expect(guides[0]).toEqual({
      id: "floor",
      along: 3.55 + 1.05,
      fromY: 0,
      toY: 0.36,
      distance: 0.36,
    });
    expect(guides[1].id).toBe("ceiling");
    expect(guides[1].fromY).toBeCloseTo(1.94, 10);
    expect(guides[1].toY).toBeCloseTo(2.5, 10);
    expect(guides[1].distance).toBeCloseTo(0.56, 10);
  });

  it("drops flush edges: a door's floor-pinned bottom, a ceiling-high head", () => {
    // Door: bottom 0 → only the ceiling guide.
    const door = openingVerticalGuides(3.65, 0.95, 0, 2.05, 2.5);
    expect(door).toHaveLength(1);
    expect(door[0].id).toBe("ceiling");
    // Window shifted to the ceiling: only the floor guide.
    const high = openingVerticalGuides(3.55, 2.1, 0.92, 2.5, 2.5);
    expect(high).toHaveLength(1);
    expect(high[0].id).toBe("floor");
  });

  it("measures from a raised floorY (a stacked neighbor's top) and drops it when flush", () => {
    // A window at 2.0–2.6 over a neighbor topping out at 1.94.
    const guides = openingVerticalGuides(3.55, 2.1, 2.0, 2.6, 3.2, 1.94);
    expect(guides).toHaveLength(2);
    expect(guides[0]).toEqual({
      id: "floor",
      along: 3.55 + 1.05,
      fromY: 1.94,
      toY: 2.0,
      distance: expect.closeTo(0.06, 10),
    });
    // Dropped flush onto the neighbor: no lower guide.
    const flush = openingVerticalGuides(3.55, 2.1, 1.94, 2.6, 3.2, 1.94);
    expect(flush).toHaveLength(1);
    expect(flush[0].id).toBe("ceiling");
  });
});

describe("openingAt", () => {
  const doorBand = defaultVerticals("door");
  const windowBand = defaultVerticals("window");

  it("lands on the nearest edge, centered on the cursor projection, snapped", () => {
    const placed = openingAt(solids, { x: 2.53, y: 0.3 }, 0.9, doorBand);
    expect(placed?.edgeId).toBe("ab");
    // 2.53 - 0.45 = 2.08, snapped to the 0.05 grid.
    expect(placed?.offset).toBeCloseTo(2.1);
    // A one-face wall opens onto its sole room.
    expect(placed?.side).toBe(1);
    expect(placed?.guides).toHaveLength(2);
  });

  it("keeps the exact offset with snap off (still clamped)", () => {
    const placed = openingAt(solids, { x: 2.53, y: 0.3 }, 0.9, doorBand, false);
    expect(placed?.offset).toBeCloseTo(2.08);
    expect(placed?.guides).toHaveLength(0);
  });

  it("ignores holes on a vertically disjoint band (stacked windows land)", () => {
    // An existing window fills [1.5, 3.6] on the top wall at the default
    // band; an incoming default window must slide clear, but one aimed at a
    // raised band (2.0–2.6, clear of the 1.94 head) lands right on top.
    const floor = rectFloor();
    floor.openings.push({
      id: "w1",
      edgeId: "ab",
      offset: 1.5,
      width: 2.1,
      kind: "window",
      side: 1,
    });
    const stacked = buildEdgeSolids(floor, deriveFloor(floor).rooms);
    // Same band → slid clear into the nearest gap ([0, 1.5], flush at 0.6).
    const blocked = openingAt(stacked, { x: 2.53, y: 0.3 }, 0.9, windowBand);
    expect(blocked?.edgeId).toBe("ab");
    expect(blocked?.offset).toBeCloseTo(0.6);
    const above = openingAt(stacked, { x: 2.53, y: 0.3 }, 0.9, {
      bottom: 2.0,
      top: 2.6,
    });
    expect(above?.edgeId).toBe("ab");
    expect(above?.offset).toBeCloseTo(2.1);
  });

  it("falls through to the next-nearest edge when the nearest can't fit", () => {
    // A short 0.6 m top edge can't fit a 0.9 m door.
    const lShaped: Floor = {
      id: "fixture-l",
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 0.6, y: 0 },
        { id: "c", x: 0.6, y: 2 },
        { id: "d", x: 4, y: 2 },
        { id: "e", x: 4, y: 5 },
        { id: "f", x: 0, y: 5 },
      ],
      edges: [
        { id: "ab", a: "a", b: "b" },
        { id: "bc", a: "b", b: "c" },
        { id: "cd", a: "c", b: "d" },
        { id: "de", a: "d", b: "e" },
        { id: "ef", a: "e", b: "f" },
        { id: "fa", a: "f", b: "a" },
      ],
      openings: [],
      furniture: [],
      rooms: [{ id: "r", anchor: { x: 2, y: 3 } }],
      stairs: [],
    };
    const lSolids = buildEdgeSolids(lShaped, deriveFloor(lShaped).rooms);
    const placed = openingAt(lSolids, { x: 0.3, y: 0.1 }, 0.9, doorBand);
    expect(placed).not.toBeNull();
    expect(placed?.edgeId).not.toBe("ab");
  });
});
