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
});
