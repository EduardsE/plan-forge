import { describe, expect, it } from "vitest";
import { createFloor } from "#/lib/model/building";
import { makeFloor } from "#/lib/model/test-fixtures";
import {
  stairClimbDir,
  stairPolygon,
  stairRun,
  stairValid,
  stairVoidObstacles,
} from "./stairs";

describe("stairRun", () => {
  it("derives risers and run from the storey height", () => {
    // 2.5 + 0.18 = 2.68 → ceil(2.68 / 0.19) = 15 risers → 3.75 m run
    const { risers, run } = stairRun(2.68);
    expect(risers).toBe(15);
    expect(run).toBeCloseTo(3.75);
  });
});

describe("stairPolygon / stairClimbDir", () => {
  it("rotation 0: width across x, run along +y, climb +y", () => {
    const poly = stairPolygon(
      { id: "s", position: { x: 2, y: 3 }, rotation: 0, width: 1 },
      3,
    );
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(1.5);
    expect(Math.max(...xs)).toBeCloseTo(2.5);
    expect(Math.min(...ys)).toBeCloseTo(1.5);
    expect(Math.max(...ys)).toBeCloseTo(4.5);
    expect(stairClimbDir(0).x).toBeCloseTo(0);
    expect(stairClimbDir(0).y).toBeCloseTo(1);
  });
  it("rotation 90 climbs along +x (CCW in y-down plan coords)", () => {
    const dir = stairClimbDir(90);
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
  });
});

describe("stairValid", () => {
  // makeFloor: living room interior x ∈ [0, 6.35], y ∈ [0, 5.2] with the
  // shared wall centerline at x = 6.4.
  const ground = { ...makeFloor(), id: "g" };
  const upper = createFloor("f2");
  const building = { floors: [ground, upper] };
  const stair = (x: number, y: number, rotation = 0) => ({
    id: "s",
    position: { x, y },
    rotation,
    width: 0.9,
  });
  it("accepts a stair clear of walls on both floors", () => {
    expect(stairValid(building, "g", stair(3, 2.5))).toBe(true);
  });
  it("rejects a stair overlapping its own floor's wall slab", () => {
    expect(stairValid(building, "g", stair(6.35, 2.5, 90))).toBe(false);
  });
  it("rejects any stair on the top floor", () => {
    expect(stairValid(building, "f2", stair(3, 2.5))).toBe(false);
  });
  it("rejects when the void would cut the floor above's walls", () => {
    // Give the upper floor a wall crossing x=3 at y∈[1,4].
    const walled = {
      ...upper,
      nodes: [
        { id: "n1", x: 3, y: 1 },
        { id: "n2", x: 3, y: 4 },
      ],
      edges: [{ id: "e1", a: "n1", b: "n2" }],
    };
    const b2 = { floors: [ground, walled] };
    expect(stairValid(b2, "g", stair(3, 2.5))).toBe(false);
  });
});

describe("stairValid — rotated stair vs a wall corner (SAT needs the stair's own axes)", () => {
  // A single vertical wall segment, x ∈ [-0.05, 0.05] (WALL_THICKNESS/2),
  // y ∈ [0, 3] — no closed room, so storeyHeightOf falls back to
  // DEFAULT_WALL_HEIGHT + SLAB_THICKNESS = 2.68 → run = 3.75 (same as the
  // `stairRun` test above), hd = 1.875.
  const ground = {
    ...createFloor("g"),
    nodes: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 0, y: 3 },
    ],
    edges: [{ id: "e1", a: "n1", b: "n2" }],
  };
  const upper = createFloor("f2");
  const building = { floors: [ground, upper] };

  it("accepts a 45°-rotated stair whose AABB overlaps the wall's corner but whose diamond shape clears it", () => {
    // Square footprint (width = run = 3.75, hw = hd = 1.875) rotated 45°:
    // a diamond with vertices s·(hw+hd) = √2/2·3.75 ≈ 2.6517 from center
    // along the world axes. Centered at (2.05, 5) — 2 m past the wall's
    // top-right corner (0.05, 3) on both axes — its AABB
    // (x ∈ [-0.60, 4.70], y ∈ [2.35, 7.65]) overlaps the wall's box
    // (x ∈ [-0.05, 0.05], y ∈ [0, 3]) on both world axes, so an x/y-only
    // SAT falsely reports a collision. Projected onto the diamond's own
    // ±45° edge normal, though, the wall's span ([-0.035, 2.157]) and the
    // diamond's span ([3.111, 6.861]) don't overlap — they're genuinely
    // clear, and only the polygon's own axis proves it.
    const stair = {
      id: "s",
      position: { x: 2.05, y: 5 },
      rotation: 45,
      width: 3.75,
    };
    expect(stairValid(building, "g", stair)).toBe(true);
  });

  it("still rejects a 45°-rotated stair genuinely overlapping the wall", () => {
    const stair = {
      id: "s",
      position: { x: 0, y: 1.5 },
      rotation: 45,
      width: 3.75,
    };
    expect(stairValid(building, "g", stair)).toBe(false);
  });
});

describe("stairValid — non-axis wall edge (oriented obstacle branch)", () => {
  it("rejects a stair overlapping a diagonal wall", () => {
    const ground = {
      ...createFloor("g"),
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 3, y: 3 },
      ],
      edges: [{ id: "e1", a: "n1", b: "n2" }],
    };
    const building = { floors: [ground, createFloor("f2")] };
    const stair = {
      id: "s",
      position: { x: 1.5, y: 1.5 },
      rotation: 0,
      width: 2,
    };
    expect(stairValid(building, "g", stair)).toBe(false);
  });
});

describe("stairVoidObstacles", () => {
  it("emits one obstacle per stair sized to the run", () => {
    const floor = {
      ...createFloor("g"),
      stairs: [{ id: "s", position: { x: 2, y: 3 }, rotation: 0, width: 1 }],
    };
    const [ob] = stairVoidObstacles(floor, 2.68);
    expect(ob.min.x).toBeCloseTo(1.5);
    expect(ob.max.y).toBeCloseTo(3 + 3.75 / 2);
  });

  it("attaches an oriented slab for an off-axis stair, hand-derived", () => {
    // storeyHeight 2.68 → run 3.75 (hd = 1.875); climbDir(45) = (sin45,
    // cos45) = (0.70711, 0.70711); half = run/2 = 1.875.
    const floor = {
      ...createFloor("g"),
      stairs: [{ id: "s", position: { x: 2, y: 3 }, rotation: 45, width: 1 }],
    };
    const [ob] = stairVoidObstacles(floor, 2.68);
    const s = Math.SQRT1_2;
    expect(ob.oriented).toBeDefined();
    expect(ob.oriented?.p0.x).toBeCloseTo(2 - s * 1.875);
    expect(ob.oriented?.p0.y).toBeCloseTo(3 - s * 1.875);
    expect(ob.oriented?.t.x).toBeCloseTo(s);
    expect(ob.oriented?.t.y).toBeCloseTo(s);
    expect(ob.oriented?.n.x).toBeCloseTo(-s);
    expect(ob.oriented?.n.y).toBeCloseTo(s);
    expect(ob.oriented?.length).toBeCloseTo(3.75);
    expect(ob.oriented?.half).toBeCloseTo(0.5);
  });
});
