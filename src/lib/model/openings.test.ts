import { describe, expect, it } from "vitest";
import {
  addFloorOpening,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  moveFloorOpening,
  removeFloorOpening,
  resizeFloorOpening,
} from "./openings";
import { makeFloor } from "./test-fixtures";
import type { Opening } from "./types";

describe("floor-level opening setters", () => {
  const door = (floor: ReturnType<typeof makeFloor>) =>
    floor.openings.find((o) => o.id === "door-BE");

  it("adds an opening onto its edge", () => {
    const floor = makeFloor();
    const opening: Opening = {
      id: "new-1",
      kind: "window",
      edgeId: "CD",
      offset: 1,
      width: 1.2,
      side: -1,
    };
    const next = addFloorOpening(floor, opening);
    expect(next.openings.some((o) => o.id === "new-1")).toBe(true);
    expect(floor.openings.some((o) => o.id === "new-1")).toBe(false);
  });

  it("moves an opening along its edge, no-ops by reference", () => {
    const floor = makeFloor();
    const moved = moveFloorOpening(floor, "door-BE", 2);
    expect(door(moved)?.offset).toBeCloseTo(2, 6);
    // The edge BE runs B(y=-0.05)→E(y=5.25); moving stays on it.
    expect(door(moved)?.edgeId).toBe("BE");
    // Same offset → same reference.
    expect(moveFloorOpening(moved, "door-BE", 2)).toBe(moved);
    // Unknown id → same reference.
    expect(moveFloorOpening(floor, "nope", 1)).toBe(floor);
  });

  it("clamps a move to the edge ends", () => {
    const floor = makeFloor();
    // Edge BE is ~5.3 long; a width-0.95 door clamps its offset at ~4.35.
    const moved = moveFloorOpening(floor, "door-BE", 99);
    expect(door(moved)?.offset).toBeCloseTo(5.3 - 0.95, 2);
  });

  it("slides a move clear of another opening on the same edge", () => {
    // Edge AB (~6.45 long) already carries window-AB at [3.55, 5.65]. Add a
    // second 0.8 m window in the left gap, then try to drag it into the first.
    const floor = addFloorOpening(makeFloor(), {
      id: "w2",
      kind: "window",
      edgeId: "AB",
      offset: 0.2,
      width: 0.8,
      side: 1,
    });
    const moved = moveFloorOpening(floor, "w2", 4.0);
    const w2 = moved.openings.find((o) => o.id === "w2");
    // The setter's own gap logic keeps it clear of window-AB (start 3.55).
    expect((w2?.offset ?? 0) + 0.8).toBeLessThanOrEqual(3.55 + 1e-6);
  });

  it("resizes about the center, clamped clear of edge ends", () => {
    const floor = makeFloor();
    const wide = resizeFloorOpening(floor, "door-BE", 12);
    // Grows to fill the whole edge (~5.3 m).
    expect(door(wide)?.width).toBeCloseTo(5.3, 1);
    // No-op width → same reference.
    const same = resizeFloorOpening(floor, "door-BE", door(floor)?.width ?? 0);
    expect(same).toBe(floor);
  });

  it("flips a door hinge, leaves windows alone", () => {
    const floor = makeFloor();
    expect(door(flipFloorOpeningHinge(floor, "door-BE"))?.hinge).toBe("end");
    expect(flipFloorOpeningHinge(floor, "window-AB")).toBe(floor);
  });

  it("flips which face a portal opens onto", () => {
    const floor = makeFloor();
    const flipped = flipFloorOpeningSide(floor, "door-BE");
    expect(door(flipped)?.side).toBe(-1);
    expect(door(flipFloorOpeningSide(flipped, "door-BE"))?.side).toBe(1);
  });

  it("removes an opening; unknown ids no-op", () => {
    const floor = makeFloor();
    const next = removeFloorOpening(floor, "door-BE");
    expect(next.openings.some((o) => o.id === "door-BE")).toBe(false);
    expect(removeFloorOpening(floor, "nope")).toBe(floor);
  });
});
