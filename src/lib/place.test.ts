import { describe, expect, it } from "vitest";
import type { FurnitureItem } from "./model";
import {
  furnitureObstacle,
  type Obstacle,
  outlineWallObstacles,
  rotatedFootprintSize,
  snapPlacement,
} from "./place";

/** The sample room's rectangle: 6.40 × 5.20 m, origin top-left. */
const RECT = [
  { x: 0, y: 0 },
  { x: 6.4, y: 0 },
  { x: 6.4, y: 5.2 },
  { x: 0, y: 5.2 },
];

/** Mockup 1d's dragged sofa: 168 × 88 cm. */
const SOFA = { width: 1.68, depth: 0.88 };

describe("snapPlacement", () => {
  it("quantizes the center to the placement grid", () => {
    const snap = snapPlacement(RECT, SOFA, { x: 3.013, y: 2.538 });
    expect(snap.center.x).toBeCloseTo(3.0, 10);
    expect(snap.center.y).toBeCloseTo(2.55, 10);
  });

  it("clamps the footprint inside the room bounds", () => {
    const snap = snapPlacement(RECT, SOFA, { x: 20, y: -5 });
    expect(snap.center.x).toBeCloseTo(6.4 - 0.84, 10);
    expect(snap.center.y).toBeCloseTo(0.44, 10);
  });

  it("sticks flush to a wall within the snap tolerance", () => {
    const snap = snapPlacement(RECT, SOFA, { x: 1.0, y: 2.6 });
    // Left edge at 1.0 − 0.84 = 0.16 from the wall → inside 0.3 tolerance.
    expect(snap.center.x).toBeCloseTo(0.84, 10);
    // Flush walls produce no guide on that axis.
    expect(snap.guides.map((guide) => guide.axis)).toEqual(["y"]);
  });

  it("leaves centers beyond the tolerance alone", () => {
    const snap = snapPlacement(RECT, SOFA, { x: 1.2, y: 2.6 });
    expect(snap.center.x).toBeCloseTo(1.2, 10);
  });

  it("measures per-axis clearance to the nearest wall", () => {
    // The mockup's ghost pose: center (3.85, 4.25) after quantization.
    const snap = snapPlacement(RECT, SOFA, { x: 3.85, y: 4.25 });
    const x = snap.guides.find((guide) => guide.axis === "x");
    const y = snap.guides.find((guide) => guide.axis === "y");
    // Right wall (1.71 m) beats left (3.01 m); bottom (0.51 m) beats top.
    expect(x?.distance).toBeCloseTo(6.4 - 3.85 - 0.84, 10);
    expect(x?.from).toEqual({ x: 6.4, y: 4.25 });
    expect(x?.to.x).toBeCloseTo(3.85 + 0.84, 10);
    expect(y?.distance).toBeCloseTo(5.2 - 4.25 - 0.44, 10);
    expect(y?.from).toEqual({ x: 3.85, y: 5.2 });
  });

  it("ignores walls whose span does not face the ghost", () => {
    // L-shape: the notch wall at x=3 spans y 3..5 only.
    const ell = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 0, y: 5 },
    ];
    const snap = snapPlacement(
      ell,
      { width: 0.4, depth: 0.4 },
      { x: 3.2, y: 1 },
    );
    const x = snap.guides.find((guide) => guide.axis === "x");
    // Nearest facing wall on x is x=6 (2.6 m away), not the notch at x=3.
    expect(x?.from.x).toBe(6);
    expect(snap.center.x).toBeCloseTo(3.2, 10);
  });

  it("centers an oversized item on the too-small axis", () => {
    const snap = snapPlacement(RECT, { width: 8, depth: 1 }, { x: 1, y: 1 });
    expect(snap.center.x).toBeCloseTo(3.2, 10);
    expect(snap.guides.some((guide) => guide.axis === "x")).toBe(false);
  });

  it("returns the quantized cursor untouched without an outline", () => {
    const snap = snapPlacement([], SOFA, { x: 2.026, y: 1.013 });
    expect(snap.center.x).toBeCloseTo(2.05, 10);
    expect(snap.center.y).toBeCloseTo(1.0, 10);
    expect(snap.guides).toEqual([]);
  });
});

describe("snapPlacement — snap off", () => {
  it("passes the raw cursor through unquantized with no guides", () => {
    const snap = snapPlacement(
      RECT,
      SOFA,
      { x: 3.013, y: 2.538 },
      [],
      undefined,
      undefined,
      false,
    );
    expect(snap.center.x).toBeCloseTo(3.013, 10);
    expect(snap.center.y).toBeCloseTo(2.538, 10);
    expect(snap.guides).toEqual([]);
  });

  it("does not flush-snap to a wall within tolerance", () => {
    // Snap on, this pulls flush to x=0.84 (see the flush test above).
    const snap = snapPlacement(
      RECT,
      SOFA,
      { x: 1.0, y: 2.6 },
      [],
      undefined,
      undefined,
      false,
    );
    expect(snap.center.x).toBeCloseTo(1.0, 10);
    expect(snap.guides).toEqual([]);
  });

  it("still clamps the footprint inside the room bounds", () => {
    const snap = snapPlacement(
      RECT,
      SOFA,
      { x: 20, y: -5 },
      [],
      undefined,
      undefined,
      false,
    );
    expect(snap.center.x).toBeCloseTo(6.4 - 0.84, 10);
    expect(snap.center.y).toBeCloseTo(0.44, 10);
  });
});

/** A table footprint sitting mid-room, away from every wall. */
const TABLE: Obstacle = {
  min: { x: 2.5, y: 2.2 },
  max: { x: 3.5, y: 3.0 },
};

describe("snapPlacement — object-to-object", () => {
  it("sticks flush to a neighbor's facing edge within tolerance", () => {
    // Sofa dragged just right of the table: left edge 4.5 − 0.84 = 3.66,
    // 0.16 past the table's right face (3.5) → inside 0.3 tolerance.
    const snap = snapPlacement(RECT, SOFA, { x: 4.5, y: 2.6 }, [TABLE]);
    expect(snap.center.x).toBeCloseTo(3.5 + 0.84, 10);
    // Beside on x must not drag the overlapping y axis into the table.
    expect(snap.center.y).toBeCloseTo(2.6, 10);
    // Flush leaves no x guide; the far walls still guide on y.
    expect(snap.guides.some((guide) => guide.axis === "x")).toBe(false);
  });

  it("guides to the nearest neighbor edge when it beats the wall", () => {
    // Between the table (right face 3.5) and the right wall (6.4): the
    // table is nearer but past tolerance, so no snap, just a guide.
    const snap = snapPlacement(RECT, SOFA, { x: 4.7, y: 2.6 }, [TABLE]);
    expect(snap.center.x).toBeCloseTo(4.7, 10);
    const x = snap.guides.find((guide) => guide.axis === "x");
    expect(x?.from).toEqual({ x: 3.5, y: 2.6 });
    expect(x?.distance).toBeCloseTo(4.7 - 0.84 - 3.5, 10);
  });

  it("ignores a neighbor the mover glides past rather than beside", () => {
    // Above the table (no y overlap) → the table's x faces don't capture.
    const snap = snapPlacement(RECT, SOFA, { x: 4.5, y: 0.6 }, [TABLE]);
    expect(snap.center.x).toBeCloseTo(4.5, 10);
    // Any x guide is to a wall, never the passed-by table's edge (3.5).
    const x = snap.guides.find((guide) => guide.axis === "x");
    expect(x?.from.x).not.toBe(3.5);
  });
});

describe("snapPlacement — angled walls", () => {
  // Right triangle: legs on x=0 and y=0, hypotenuse (6,0)→(0,6) at 45°
  // (the line x + y = 6, interior x + y < 6).
  const TRI = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 0, y: 6 },
  ];
  const BOX = { width: 0.4, depth: 0.4 }; // half 0.2 → support √2·0.2 ≈ 0.283

  it("sticks flush to the hypotenuse within tolerance", () => {
    // Center at x+y=5.4, ~0.14 off the flush line (0.283 support) → snaps.
    const snap = snapPlacement(TRI, BOX, { x: 2.7, y: 2.7 });
    expect(snap.center.x).toBeCloseTo(2.8, 6);
    expect(snap.center.y).toBeCloseTo(2.8, 6);
    // Flush leaves no guide to that wall.
    expect(snap.guides.some((g) => g.id === "wall-1")).toBe(false);
  });

  it("contains a footprint dragged out through the angled wall", () => {
    // Cursor at x+y=7 is outside; it must come back to the flush line.
    const snap = snapPlacement(TRI, BOX, { x: 3.5, y: 3.5 });
    expect(snap.center.x).toBeCloseTo(2.8, 6);
    expect(snap.center.y).toBeCloseTo(2.8, 6);
    expect(snap.center.x + snap.center.y).toBeLessThan(6); // inside
  });

  it("guides to the hypotenuse along its normal", () => {
    const snap = snapPlacement(TRI, BOX, { x: 2.4, y: 2.4 });
    expect(snap.center.x).toBeCloseTo(2.4, 6); // too far to snap
    const g = snap.guides.find((guide) => guide.id === "wall-1");
    // Perp distance to x+y=6 is 1.2/√2; minus the box support 0.2·√2.
    expect(g?.distance).toBeCloseTo(1.2 / Math.SQRT2 - 0.2 * Math.SQRT2, 6);
    // Foot of the guide sits on the wall line x + y = 6.
    expect((g?.from.x ?? 0) + (g?.from.y ?? 0)).toBeCloseTo(6, 6);
  });

  it("finds the inward normal regardless of winding", () => {
    // Same triangle wound the other way — containment must still pull in.
    const reversed = [
      { x: 0, y: 0 },
      { x: 0, y: 6 },
      { x: 6, y: 0 },
    ];
    const snap = snapPlacement(reversed, BOX, { x: 3.5, y: 3.5 });
    expect(snap.center.x).toBeCloseTo(2.8, 6);
    expect(snap.center.y).toBeCloseTo(2.8, 6);
  });
});

describe("furnitureObstacle", () => {
  const base: FurnitureItem = {
    id: "t1",
    catalogId: "table",
    position: { x: 3, y: 3 },
    rotation: 0,
    footprint: { width: 2, depth: 0.5, height: 0.75 },
  };

  it("bounds the unrotated footprint around its center", () => {
    expect(furnitureObstacle(base)).toEqual({
      min: { x: 2, y: 2.75 },
      max: { x: 4, y: 3.25 },
    });
  });

  it("uses the rotated hull at 90°", () => {
    const box = furnitureObstacle({ ...base, rotation: 90 });
    expect(box.min.x).toBeCloseTo(2.75, 10);
    expect(box.max.x).toBeCloseTo(3.25, 10);
    expect(box.min.y).toBeCloseTo(2, 10);
    expect(box.max.y).toBeCloseTo(4, 10);
  });
});

describe("outlineWallObstacles", () => {
  it("turns each axis-aligned wall into a degenerate obstacle", () => {
    const obstacles = outlineWallObstacles(RECT);
    expect(obstacles).toHaveLength(4);
    // The top wall: flat on y, spanning the room's width.
    expect(obstacles[0]).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 6.4, y: 0 },
    });
    // The left wall: flat on x.
    expect(obstacles[3]).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 0, y: 5.2 },
    });
  });

  it("skips non-axis walls, like every other snap path", () => {
    const cut = [
      { x: 0, y: 0 },
      { x: 6.4, y: 0 },
      { x: 6.4, y: 3.2 },
      { x: 4.4, y: 5.2 }, // 45° cut
      { x: 0, y: 5.2 },
    ];
    expect(outlineWallObstacles(cut)).toHaveLength(4);
  });

  it("snaps a mover flush against a neighbor room's wall", () => {
    // A neighbor room protruding into the mover's room bounds at x=4:
    // dragging toward it sticks flush instead of sliding over the wall.
    const neighbor = outlineWallObstacles([
      { x: 4, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: 4, y: 6 },
    ]);
    const snap = snapPlacement(RECT, SOFA, { x: 3.1, y: 3 }, neighbor);
    expect(snap.center.x).toBeCloseTo(4 - SOFA.width / 2, 10);
  });
});

describe("rotatedFootprintSize", () => {
  it("keeps the size at 0° and 180°", () => {
    expect(rotatedFootprintSize(SOFA, 0).width).toBeCloseTo(1.68, 10);
    expect(rotatedFootprintSize(SOFA, 180).depth).toBeCloseTo(0.88, 10);
  });

  it("swaps width and depth at 90° and 270°", () => {
    const quarter = rotatedFootprintSize(SOFA, 90);
    expect(quarter.width).toBeCloseTo(0.88, 10);
    expect(quarter.depth).toBeCloseTo(1.68, 10);
    expect(rotatedFootprintSize(SOFA, 270).width).toBeCloseTo(0.88, 10);
  });

  it("returns the rotated bounding box at other angles", () => {
    const diagonal = rotatedFootprintSize({ width: 1, depth: 1 }, 45);
    expect(diagonal.width).toBeCloseTo(Math.SQRT2, 10);
    expect(diagonal.depth).toBeCloseTo(Math.SQRT2, 10);
  });
});
