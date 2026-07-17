import { describe, expect, it } from "vitest";
import { deriveFloor, type Floor } from "#/lib/model";
import {
  offsetAlongWall,
  openingAt,
  openingCornerGuides,
  slideOpening,
} from "#/lib/opening-place";
import { buildEdgeSolids } from "#/lib/room-scene";

/** A single rectangular room, 6.4 × 5.2, wound positively. */
function rectFloor(): Floor {
  return {
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
});

describe("openingAt", () => {
  it("lands on the nearest edge, centered on the cursor projection, snapped", () => {
    const placed = openingAt(solids, { x: 2.53, y: 0.3 }, 0.9);
    expect(placed?.edgeId).toBe("ab");
    // 2.53 - 0.45 = 2.08, snapped to the 0.05 grid.
    expect(placed?.offset).toBeCloseTo(2.1);
    // A one-face wall opens onto its sole room.
    expect(placed?.side).toBe(1);
    expect(placed?.guides).toHaveLength(2);
  });

  it("keeps the exact offset with snap off (still clamped)", () => {
    const placed = openingAt(solids, { x: 2.53, y: 0.3 }, 0.9, false);
    expect(placed?.offset).toBeCloseTo(2.08);
    expect(placed?.guides).toHaveLength(0);
  });

  it("falls through to the next-nearest edge when the nearest can't fit", () => {
    // A short 0.6 m top edge can't fit a 0.9 m door.
    const lShaped: Floor = {
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
    };
    const lSolids = buildEdgeSolids(lShaped, deriveFloor(lShaped).rooms);
    const placed = openingAt(lSolids, { x: 0.3, y: 0.1 }, 0.9);
    expect(placed).not.toBeNull();
    expect(placed?.edgeId).not.toBe("ab");
  });
});
