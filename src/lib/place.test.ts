import { describe, expect, it } from "vitest";
import type { Floor, FurnitureItem, Opening } from "./model";
import { setEdgeThickness } from "./model";
import { makeFloor } from "./model/test-fixtures";
import {
  edgeWallObstacles,
  furnitureObstacle,
  type Obstacle,
  rotatedFootprintSize,
  separateFromWalls,
  snapPlacement,
} from "./place";

/** Mockup 1d's dragged sofa: 168 × 88 cm. */
const SOFA = { width: 1.68, depth: 0.88 };

/** A rectangular graph floor (6.40 × 5.20 m) with optional openings. */
function rectFloor(openings: Opening[] = []): Floor {
  return {
    id: "fixture",
    nodes: [
      { id: "n0", x: 0, y: 0 },
      { id: "n1", x: 6.4, y: 0 },
      { id: "n2", x: 6.4, y: 5.2 },
      { id: "n3", x: 0, y: 5.2 },
    ],
    edges: [
      { id: "e-top", a: "n0", b: "n1" },
      { id: "e-right", a: "n1", b: "n2" },
      { id: "e-bottom", a: "n2", b: "n3" },
      { id: "e-left", a: "n3", b: "n0" },
    ],
    openings,
    furniture: [],
    rooms: [],
    stairs: [],
  };
}

/** The four axis wall slabs of `rectFloor` (inner faces at 0.05 off each line). */
const WALLS = edgeWallObstacles(rectFloor());

describe("snapPlacement", () => {
  it("quantizes the center to the placement grid", () => {
    const snap = snapPlacement(SOFA, { x: 3.013, y: 2.538 });
    expect(snap.center.x).toBeCloseTo(3.0, 10);
    expect(snap.center.y).toBeCloseTo(2.55, 10);
  });

  it("sticks flush to a wall within the snap tolerance", () => {
    const snap = snapPlacement(SOFA, { x: 1.0, y: 2.6 }, WALLS);
    // Left edge at 1.0 − 0.84 = 0.16, the slab inner face at 0.05 → 0.11 gap,
    // inside 0.3 tolerance → flush at 0.05 + 0.84 = 0.89.
    expect(snap.center.x).toBeCloseTo(0.89, 10);
    // Flush walls produce no guide on that axis.
    expect(snap.guides.map((guide) => guide.axis)).toEqual(["y"]);
  });

  it("leaves centers beyond the tolerance alone", () => {
    const snap = snapPlacement(SOFA, { x: 1.2, y: 2.6 }, WALLS);
    // Left edge 0.36, inner face 0.05 → 0.31 gap, just past 0.3 tolerance.
    expect(snap.center.x).toBeCloseTo(1.2, 10);
  });

  it("measures per-axis clearance to the nearest wall face", () => {
    const snap = snapPlacement(SOFA, { x: 3.85, y: 4.25 }, WALLS);
    const x = snap.guides.find((guide) => guide.axis === "x");
    const y = snap.guides.find((guide) => guide.axis === "y");
    // Right wall inner face (6.35) beats left; bottom (5.15) beats top.
    expect(x?.distance).toBeCloseTo(6.35 - 3.85 - 0.84, 10);
    expect(x?.from.x).toBeCloseTo(6.35, 10);
    expect(x?.from.y).toBeCloseTo(4.25, 10);
    expect(x?.to.x).toBeCloseTo(3.85 + 0.84, 10);
    expect(y?.distance).toBeCloseTo(5.15 - 4.25 - 0.44, 10);
    expect(y?.from.x).toBeCloseTo(3.85, 10);
    expect(y?.from.y).toBeCloseTo(5.15, 10);
  });

  it("ignores walls whose span does not face the ghost", () => {
    // L-shaped graph: the notch wall at x=3 spans y 3..5 only.
    const ell: Floor = {
      id: "fixture-ell",
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 6, y: 0 },
        { id: "c", x: 6, y: 3 },
        { id: "d", x: 3, y: 3 },
        { id: "e", x: 3, y: 5 },
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
      rooms: [],
      stairs: [],
    };
    const snap = snapPlacement(
      { width: 0.4, depth: 0.4 },
      { x: 3.2, y: 1 },
      edgeWallObstacles(ell),
    );
    const x = snap.guides.find((guide) => guide.axis === "x");
    // Nearest facing wall on x is the right wall (inner face 5.95), not the
    // notch at x=3 (its slab spans y 3..5, above the ghost).
    expect(x?.from.x).toBeCloseTo(5.95, 10);
    expect(snap.center.x).toBeCloseTo(3.2, 10);
  });

  it("returns the quantized cursor untouched without obstacles", () => {
    const snap = snapPlacement(SOFA, { x: 2.026, y: 1.013 });
    expect(snap.center.x).toBeCloseTo(2.05, 10);
    expect(snap.center.y).toBeCloseTo(1.0, 10);
    expect(snap.guides).toEqual([]);
  });
});

describe("snapPlacement — snap off", () => {
  it("passes the raw cursor through unquantized with no guides", () => {
    const snap = snapPlacement(
      SOFA,
      { x: 3.013, y: 2.538 },
      WALLS,
      undefined,
      undefined,
      false,
    );
    expect(snap.center.x).toBeCloseTo(3.013, 10);
    expect(snap.center.y).toBeCloseTo(2.538, 10);
    expect(snap.guides).toEqual([]);
  });

  it("does not flush-snap to a wall within tolerance", () => {
    // Snap on, this pulls flush to x=0.89 (see the flush test above).
    const snap = snapPlacement(
      SOFA,
      { x: 1.0, y: 2.6 },
      WALLS,
      undefined,
      undefined,
      false,
    );
    expect(snap.center.x).toBeCloseTo(1.0, 10);
    expect(snap.guides).toEqual([]);
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
    const snap = snapPlacement(SOFA, { x: 4.5, y: 2.6 }, [TABLE, ...WALLS]);
    expect(snap.center.x).toBeCloseTo(3.5 + 0.84, 10);
    // Beside on x must not drag the overlapping y axis into the table.
    expect(snap.center.y).toBeCloseTo(2.6, 10);
    // Flush leaves no x guide; the far walls still guide on y.
    expect(snap.guides.some((guide) => guide.axis === "x")).toBe(false);
  });

  it("guides to the nearest neighbor edge when it beats the wall", () => {
    // Between the table (right face 3.5) and the right wall (6.35): the
    // table is nearer but past tolerance, so no snap, just a guide.
    const snap = snapPlacement(SOFA, { x: 4.7, y: 2.6 }, [TABLE, ...WALLS]);
    expect(snap.center.x).toBeCloseTo(4.7, 10);
    const x = snap.guides.find((guide) => guide.axis === "x");
    expect(x?.from).toEqual({ x: 3.5, y: 2.6 });
    expect(x?.distance).toBeCloseTo(4.7 - 0.84 - 3.5, 10);
  });

  it("ignores a neighbor the mover glides past rather than beside", () => {
    // Above the table (no y overlap) → the table's x faces don't capture.
    const snap = snapPlacement(SOFA, { x: 4.5, y: 0.6 }, [TABLE, ...WALLS]);
    expect(snap.center.x).toBeCloseTo(4.5, 10);
    // Any x guide is to a wall, never the passed-by table's edge (3.5).
    const x = snap.guides.find((guide) => guide.axis === "x");
    expect(x?.from.x).not.toBe(3.5);
  });
});

/** A single 45° wall: centerline on x + y = 6, from (6,0) to (0,6). */
function diagWallFloor(): Floor {
  return {
    id: "fixture-diag",
    nodes: [
      { id: "p", x: 6, y: 0 },
      { id: "q", x: 0, y: 6 },
    ],
    edges: [{ id: "e", a: "p", b: "q" }],
    openings: [],
    furniture: [],
    rooms: [],
    stairs: [],
  };
}

describe("snapPlacement — angled walls", () => {
  const DIAG = edgeWallObstacles(diagWallFloor());
  const BOX = { width: 0.4, depth: 0.4 }; // half 0.2 → support √2·0.2 along n
  // Box flush against the wall face on the interior side (x + y < 6): its
  // center sits half + support back from the x+y=6 centerline, along the
  // (1/√2, 1/√2) normal.
  const flushSum = 6 - Math.SQRT2 * (0.05 + Math.SQRT2 * 0.2);

  it("exposes the diagonal edge as one oriented slab", () => {
    expect(DIAG).toHaveLength(1);
    expect(DIAG[0].oriented?.id).toBe("wall-0-0");
    expect(DIAG[0].oriented?.length).toBeCloseTo(6 * Math.SQRT2, 10);
  });

  it("sticks flush to the hypotenuse within tolerance", () => {
    // Center at x+y=5.4, ~0.09 off the flush line → snaps.
    const snap = snapPlacement(BOX, { x: 2.7, y: 2.7 }, DIAG);
    expect(snap.center.x).toBeCloseTo(snap.center.y, 10); // symmetric
    expect(snap.center.x + snap.center.y).toBeCloseTo(flushSum, 6);
    // Flush leaves no guide to that wall.
    expect(snap.guides.some((g) => g.id === "wall-0-0")).toBe(false);
  });

  it("guides to the hypotenuse along its normal when too far to snap", () => {
    const snap = snapPlacement(BOX, { x: 2.4, y: 2.4 }, DIAG);
    expect(snap.center.x).toBeCloseTo(2.4, 6); // too far to snap
    const g = snap.guides.find((guide) => guide.id === "wall-0-0");
    // Clear gap = perp distance (1.2/√2) − half (0.05) − support (√2·0.2).
    expect(g?.distance).toBeCloseTo(
      1.2 / Math.SQRT2 - 0.05 - Math.SQRT2 * 0.2,
      6,
    );
    // Foot of the guide sits on the wall's near face (x + y = 6 − 0.05·√2).
    expect((g?.from.x ?? 0) + (g?.from.y ?? 0)).toBeCloseTo(
      6 - 0.05 * Math.SQRT2,
      6,
    );
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

describe("edgeWallObstacles", () => {
  it("turns each axis-aligned edge into a slab straddling the centerline", () => {
    const obstacles = edgeWallObstacles(rectFloor());
    expect(obstacles).toHaveLength(4);
    // The top wall (y=0): 0.1 m band straddling the line, spanning the width.
    expect(obstacles[0]).toEqual({
      min: { x: 0, y: -0.05 },
      max: { x: 6.4, y: 0.05 },
    });
    // The right wall (x=6.4): 0.1 m band straddling the line.
    expect(obstacles[1].min.x).toBeCloseTo(6.35, 10);
    expect(obstacles[1].max.x).toBeCloseTo(6.45, 10);
    expect(obstacles[1].min.y).toBeCloseTo(0, 10);
    expect(obstacles[1].max.y).toBeCloseTo(5.2, 10);
    // Axis walls carry no oriented slab.
    expect(obstacles.every((o) => o.oriented === undefined)).toBe(true);
  });

  it("splits a slab at a door gap but not a window", () => {
    const doorGap = edgeWallObstacles(
      rectFloor([
        {
          id: "d",
          kind: "door",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    // The right edge becomes two slabs (0..2 and 2.9..5.2); 3 others → 5.
    const rightSlabs = doorGap.filter((o) => o.min.x > 6);
    expect(rightSlabs).toHaveLength(2);
    expect(rightSlabs[0].max.y).toBeCloseTo(2.0, 10);
    expect(rightSlabs[1].min.y).toBeCloseTo(2.9, 10);

    const windowWhole = edgeWallObstacles(
      rectFloor([
        {
          id: "w",
          kind: "window",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    expect(windowWhole.filter((o) => o.min.x > 6)).toHaveLength(1);
  });

  it("carries non-axis edges as oriented slabs (blocks angled walls)", () => {
    const diagonal: Floor = {
      id: "fixture-diagonal",
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 6.4, y: 0 },
        { id: "c", x: 4.4, y: 5.2 },
      ],
      edges: [
        { id: "e0", a: "a", b: "b" }, // horizontal (axis)
        { id: "e1", a: "b", b: "c" }, // diagonal
        { id: "e2", a: "c", b: "a" }, // diagonal
      ],
      openings: [],
      furniture: [],
      rooms: [],
      stairs: [],
    };
    const obstacles = edgeWallObstacles(diagonal);
    expect(obstacles).toHaveLength(3);
    // The axis edge stays a plain box; the two diagonals carry oriented slabs.
    expect(obstacles.filter((o) => o.oriented).length).toBe(2);
    const slab = obstacles.find((o) => o.oriented)?.oriented;
    expect(slab?.half).toBeCloseTo(0.05, 10);
    // Its unit normal is perpendicular to its unit tangent.
    if (slab) {
      expect(slab.t.x * slab.n.x + slab.t.y * slab.n.y).toBeCloseTo(0, 10);
      expect(Math.hypot(slab.n.x, slab.n.y)).toBeCloseTo(1, 10);
    }
  });
});

describe("separateFromWalls", () => {
  it("returns the same reference when the footprint clears every wall", () => {
    const center = { x: 3, y: 3 };
    expect(separateFromWalls(WALLS, { width: 1, depth: 1 }, center)).toBe(
      center,
    );
  });

  it("pushes a footprint off the axis wall it penetrates, to flush", () => {
    // A 1 m item at x=6.0 pokes into the right slab (inner face 6.35).
    const out = separateFromWalls(
      WALLS,
      { width: 1, depth: 1 },
      { x: 6, y: 3 },
    );
    expect(out.x).toBeCloseTo(5.85, 10);
    expect(out.y).toBeCloseTo(3, 10);
  });

  it("blocks a footprint nudged into a 45° wall, to flush inside", () => {
    const DIAG = edgeWallObstacles(diagWallFloor());
    const BOX = { width: 0.4, depth: 0.4 };
    const flushSum = 6 - Math.SQRT2 * (0.05 + Math.SQRT2 * 0.2);
    // A box nudged to (2.9,2.9) straddles the wall from the interior side;
    // it must be pushed back out along the normal, flush and still inside.
    const out = separateFromWalls(DIAG, BOX, { x: 2.9, y: 2.9 });
    expect(out.x).toBeCloseTo(out.y, 10);
    expect(out.x + out.y).toBeCloseTo(flushSum, 6);
    expect(out.x + out.y).toBeLessThan(6); // interior
  });

  it("blocks the 45° wall from its other face too (two-sided slab)", () => {
    const DIAG = edgeWallObstacles(diagWallFloor());
    const BOX = { width: 0.4, depth: 0.4 };
    // A box straddling the wall from the exterior side is pushed back out.
    const out = separateFromWalls(DIAG, BOX, { x: 3.1, y: 3.1 });
    expect(out.x + out.y).toBeGreaterThan(6); // exterior
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

describe("edgeWallObstacles per-edge thickness", () => {
  it("widens a thick shared wall's slab symmetrically about its line", () => {
    const floor = setEdgeThickness(makeFloor(), "BE", 0.3);
    const slabs = edgeWallObstacles(floor).filter(
      (o) => Math.abs((o.min.x + o.max.x) / 2 - 6.4) < 1e-9,
    );
    expect(slabs.length).toBeGreaterThan(0);
    for (const slab of slabs) {
      expect(slab.min.x).toBeCloseTo(6.25, 9);
      expect(slab.max.x).toBeCloseTo(6.55, 9);
    }
  });

  it("grows a thick exterior wall's slab outward only", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
    // AB runs along y = −0.05 with the living room below: the interior face
    // stays at y = 0 while the body bulks upward (outward).
    const slab = edgeWallObstacles(floor).find(
      (o) => o.max.y < 0.5 && o.min.x < 0 && o.max.x > 6,
    );
    expect(slab?.max.y).toBeCloseTo(0, 9);
    expect(slab?.min.y).toBeCloseTo(-0.3, 9);
  });
});

describe("edgeWallObstacles passage gaps", () => {
  it("a passage span carries no slab, like a door", () => {
    const floor = rectFloor([
      {
        id: "p1",
        kind: "passage",
        edgeId: "e-top",
        offset: 2,
        width: 1.2,
        side: 1,
      },
    ]);
    const top = edgeWallObstacles(floor).filter((o) => o.max.y < 0.1);
    // The top wall splits into two slabs around the gap.
    const spans = top
      .map((o) => [o.min.x, o.max.x] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(spans).toHaveLength(2);
    expect(spans[0][1]).toBeCloseTo(2, 9);
    expect(spans[1][0]).toBeCloseTo(3.2, 9);
  });
});
