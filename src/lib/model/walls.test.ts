import { describe, expect, it } from "vitest";
import { splitEdgeAt } from "#/lib/graph-edit";
import { WALL_THICKNESS } from "./geometry";
import { makeFloor } from "./test-fixtures";
import {
  MAX_WALL_THICKNESS,
  MIN_WALL_THICKNESS,
  setEdgeThickness,
} from "./walls";

describe("setEdgeThickness", () => {
  it("stores a clamped thickness on the edge", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
    expect(floor.edges.find((e) => e.id === "AB")?.thickness).toBe(0.3);
  });

  it("clamps into [MIN, MAX]", () => {
    const thin = setEdgeThickness(makeFloor(), "AB", 0.001);
    expect(thin.edges.find((e) => e.id === "AB")?.thickness).toBe(
      MIN_WALL_THICKNESS,
    );
    const thick = setEdgeThickness(makeFloor(), "AB", 5);
    expect(thick.edges.find((e) => e.id === "AB")?.thickness).toBe(
      MAX_WALL_THICKNESS,
    );
  });

  it("stores the default as an absent field", () => {
    const floor = setEdgeThickness(
      setEdgeThickness(makeFloor(), "AB", 0.3),
      "AB",
      WALL_THICKNESS,
    );
    expect(floor.edges.find((e) => e.id === "AB")?.thickness).toBeUndefined();
  });

  it("no-ops by reference on unknown ids and non-finite values", () => {
    const floor = makeFloor();
    expect(setEdgeThickness(floor, "nope", 0.3)).toBe(floor);
    expect(setEdgeThickness(floor, "AB", Number.NaN)).toBe(floor);
    expect(setEdgeThickness(floor, "AB", WALL_THICKNESS)).toBe(floor);
  });

  it("survives an edge split (both halves inherit the thickness)", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
    const split = splitEdgeAt(floor, "AB", { x: 3.2, y: -0.05 });
    expect(split).not.toBe(floor);
    // AB (A(-0.05,-0.05) → B(6.4,-0.05)) is replaced by two new edges
    // spanning the same nodes through the split node; both carry 0.3.
    const halves = split.edges.filter((e) => e.thickness !== undefined);
    expect(halves).toHaveLength(2);
    expect(halves.every((e) => e.thickness === 0.3)).toBe(true);
  });
});
