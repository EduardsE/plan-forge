import { describe, expect, it } from "vitest";
import {
  circlePoints,
  dashedPolyline,
  doorSwing,
  roundedRectPoints,
  solidSpans,
  wallPoint,
  wallSpanRect,
} from "#/lib/plan-scene";
import { WALL_HEIGHT, WALL_THICKNESS, type WallSolid } from "#/lib/room-scene";

/** A wall solid literal (edge a→b) for the pure geometry helpers. */
function solid(overrides: Partial<WallSolid> = {}): WallSolid {
  return {
    index: 0,
    edgeId: "e",
    start: { x: 0, y: 0 },
    dir: { x: 1, y: 0 },
    outward: { x: 0, y: -1 },
    length: 6.4,
    height: WALL_HEIGHT,
    thickness: WALL_THICKNESS,
    outwardShift: 0,
    outwardSign: 1,
    holes: [],
    faces: 1,
    faceSides: [1],
    ...overrides,
  };
}

describe("solidSpans", () => {
  it("returns the whole wall when it has no holes", () => {
    expect(solidSpans(solid())).toEqual([{ start: 0, end: 6.4 }]);
  });

  it("splits a wall around its hole", () => {
    const withWindow = solid({
      holes: [
        {
          id: "w",
          kind: "window",
          start: 3.5,
          width: 2.1,
          bottom: 0.36,
          top: 1.94,
          side: 1,
        },
      ],
    });
    expect(solidSpans(withWindow)).toEqual([
      { start: 0, end: 3.5 },
      { start: 5.6, end: 6.4 },
    ]);
  });

  it("merges overlapping holes and drops empty edge spans", () => {
    const s = solid({
      length: 4,
      holes: [
        {
          id: "d",
          kind: "door",
          start: 0,
          width: 1.5,
          bottom: 0,
          top: 2,
          side: 1,
        },
        {
          id: "w",
          kind: "window",
          start: 1,
          width: 1,
          bottom: 0.4,
          top: 1.9,
          side: 1,
        },
      ],
    });
    expect(solidSpans(s)).toEqual([{ start: 2, end: 4 }]);
  });
});

describe("wallPoint / wallSpanRect", () => {
  it("offsets away from the interior", () => {
    // Top wall: start (0,0) → (6.4,0), outward -y (up).
    expect(wallPoint(solid(), 2, 0.1)).toEqual({ x: 2, y: -0.1 });
  });

  it("builds the span footprint from the line to the outward face", () => {
    expect(wallSpanRect(solid(), { start: 1, end: 3 }, 0.1)).toEqual([
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: -0.1 },
      { x: 1, y: -0.1 },
    ]);
  });
});

describe("doorSwing", () => {
  // A right wall (start (6.4,0) → (6.4,5.2)); the door opens onto side +1,
  // whose face is on the interior (x < 6.4) — the left normal.
  const right = solid({
    edgeId: "right",
    start: { x: 6.4, y: 0 },
    dir: { x: 0, y: 1 },
    outward: { x: 1, y: 0 },
    length: 5.2,
    faces: 2,
    faceSides: [1, -1],
  });
  const door = {
    id: "door-1",
    kind: "door" as const,
    start: 3.6,
    width: 0.95,
    bottom: 0,
    top: 2.05,
    hinge: "start" as const,
    side: 1 as const,
  };

  it("hinges at the offset edge and swings the leaf toward the opening's face", () => {
    const swing = doorSwing(right, door);
    expect(swing.hinge.x).toBeCloseTo(6.4, 10);
    expect(swing.hinge.y).toBeCloseTo(3.6, 10);
    expect(swing.leafEnd.x).toBeCloseTo(6.4 - 0.95, 10);
    expect(swing.leafEnd.y).toBeCloseTo(3.6, 10);
    const last = swing.arc[swing.arc.length - 1];
    expect(last.x).toBeCloseTo(6.4, 10);
    expect(last.y).toBeCloseTo(3.6 + 0.95, 10);
    for (const p of swing.arc) {
      expect(Math.hypot(p.x - 6.4, p.y - 3.6)).toBeCloseTo(0.95, 10);
      expect(p.x).toBeLessThanOrEqual(6.4 + 1e-9);
    }
  });

  it("swings the other way when the door opens onto side -1", () => {
    const swing = doorSwing(right, { ...door, side: -1 });
    // The face on side -1 is the right normal (x > 6.4).
    expect(swing.leafEnd.x).toBeCloseTo(6.4 + 0.95, 10);
  });

  it("mirrors the hinge when hinged at the far edge", () => {
    const swing = doorSwing(right, { ...door, hinge: "end" });
    expect(swing.hinge.y).toBeCloseTo(3.6 + 0.95, 10);
    expect(swing.leafEnd.x).toBeCloseTo(6.4 - 0.95, 10);
  });
});

describe("roundedRectPoints", () => {
  it("stays inside the rect and touches all four edges", () => {
    const points = roundedRectPoints(2, 1, 0.2);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-1, 10);
    expect(Math.max(...xs)).toBeCloseTo(1, 10);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 10);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 10);
  });

  it("emits sharp corners for zero radii", () => {
    expect(roundedRectPoints(2, 1, 0)).toEqual([
      { x: -1, y: -0.5 },
      { x: 1, y: -0.5 },
      { x: 1, y: 0.5 },
      { x: -1, y: 0.5 },
    ]);
  });

  it("clamps radii to the half extents", () => {
    const points = roundedRectPoints(2, 1, 5);
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("rounds per-corner radii in CSS order (tl, tr, br, bl)", () => {
    // Only the top-left corner rounded — the desk-chair footprint uses this
    // per-corner form ([0.13, 0.13, 0.055, 0.055]).
    const points = roundedRectPoints(2, 1, [0.2, 0, 0, 0]);
    // The tl arc (cornerSegments + 1 = 7 pts) then three sharp corners.
    expect(points).toHaveLength(7 + 3);
    // The sharp corners are the exact rect corners, tr → br → bl.
    expect(points.slice(7)).toEqual([
      { x: 1, y: -0.5 },
      { x: 1, y: 0.5 },
      { x: -1, y: 0.5 },
    ]);
    // The rounded corner stays in the top-left quadrant of the rect.
    for (const p of points.slice(0, 7)) {
      expect(p.x).toBeLessThanOrEqual(-0.8 + 1e-9);
      expect(p.y).toBeLessThanOrEqual(-0.3 + 1e-9);
    }
  });
});

describe("circlePoints", () => {
  it("lies on the radius", () => {
    for (const p of circlePoints(0.25, 12)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.25, 10);
    }
  });
});

describe("dashedPolyline", () => {
  it("alternates dashes and gaps along a straight line", () => {
    const pairs = dashedPolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      0.3,
      0.2,
    );
    expect(pairs).toEqual([
      { x: 0, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.5, y: 0 },
      { x: expect.closeTo(0.8, 10), y: 0 },
    ]);
  });

  it("emits an even number of points (start/end pairs)", () => {
    const pairs = dashedPolyline(circlePoints(1, 32), 0.09, 0.06);
    expect(pairs.length % 2).toBe(0);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("carries a dash across a vertex into the next segment", () => {
    // The first leg (0.2) is shorter than the 0.3 dash, so the dash continues
    // around the corner into the second leg instead of ending at the vertex.
    const pairs = dashedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0.2, y: 0 },
        { x: 0.2, y: 0.2 },
      ],
      0.3,
      0.2,
    );
    expect(pairs).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0 },
      { x: expect.closeTo(0.2, 10), y: expect.closeTo(0.1, 10) },
    ]);
  });
});
