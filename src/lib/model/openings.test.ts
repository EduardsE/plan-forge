import { describe, expect, it } from "vitest";
import {
  addFloorOpening,
  DOOR_HEIGHT,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  MIN_OPENING_HEIGHT,
  moveFloorOpening,
  openingVerticals,
  removeFloorOpening,
  resizeFloorOpening,
  setOpeningVerticals,
  shiftOpeningVertical,
  WINDOW_HEAD,
  WINDOW_SILL,
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

describe("opening vertical extents", () => {
  const window = (floor: ReturnType<typeof makeFloor>) =>
    floor.openings.find((o) => o.id === "window-AB");
  const door = (floor: ReturnType<typeof makeFloor>) =>
    floor.openings.find((o) => o.id === "door-BE");

  it("defaults come from the constants; stored fields override", () => {
    const floor = makeFloor();
    const w = window(floor) as Opening;
    expect(openingVerticals(w)).toEqual({
      bottom: WINDOW_SILL,
      top: WINDOW_HEAD,
    });
    expect(openingVerticals(door(floor) as Opening)).toEqual({
      bottom: 0,
      top: DOOR_HEIGHT,
    });
    expect(openingVerticals({ ...w, sill: 0.8, head: 2.1 })).toEqual({
      bottom: 0.8,
      top: 2.1,
    });
  });

  it("sets a window's sill and head, clamped to floor/ceiling", () => {
    const floor = makeFloor();
    const raised = setOpeningVerticals(
      floor,
      "window-AB",
      { bottom: 0.8, top: 2.2 },
      2.5,
    );
    expect(openingVerticals(window(raised) as Opening)).toEqual({
      bottom: 0.8,
      top: 2.2,
    });
    // Below the floor / above the ceiling clamp.
    const clamped = setOpeningVerticals(
      floor,
      "window-AB",
      { bottom: -1, top: 99 },
      2.5,
    );
    expect(openingVerticals(window(clamped) as Opening)).toEqual({
      bottom: 0,
      top: 2.5,
    });
  });

  it("keeps a minimum extent against the other edge", () => {
    const floor = makeFloor();
    // Sill pushed up against the default head stops MIN short of it.
    const squeezed = setOpeningVerticals(
      floor,
      "window-AB",
      { bottom: 1.9 },
      2.5,
    );
    expect(openingVerticals(window(squeezed) as Opening).bottom).toBeCloseTo(
      WINDOW_HEAD - MIN_OPENING_HEIGHT,
      6,
    );
    const shrunk = setOpeningVerticals(floor, "window-AB", { top: 0.1 }, 2.5);
    expect(openingVerticals(window(shrunk) as Opening).top).toBeCloseTo(
      WINDOW_SILL + MIN_OPENING_HEIGHT,
      6,
    );
  });

  it("pins a door's bottom to the floor, resizes its head", () => {
    const floor = makeFloor();
    const tall = setOpeningVerticals(
      floor,
      "door-BE",
      { bottom: 0.5, top: 2.3 },
      2.5,
    );
    expect(openingVerticals(door(tall) as Opening)).toEqual({
      bottom: 0,
      top: 2.3,
    });
    expect(door(tall)?.sill).toBeUndefined();
  });

  it("stores defaults as absent fields; no-ops by reference", () => {
    const floor = makeFloor();
    const roundTrip = setOpeningVerticals(
      setOpeningVerticals(floor, "window-AB", { bottom: 0.9 }, 2.5),
      "window-AB",
      { bottom: WINDOW_SILL },
      2.5,
    );
    expect(window(roundTrip)?.sill).toBeUndefined();
    expect(window(roundTrip)?.head).toBeUndefined();
    // Same values → same reference; unknown id → same reference.
    expect(
      setOpeningVerticals(floor, "window-AB", { bottom: WINDOW_SILL }, 2.5),
    ).toBe(floor);
    expect(setOpeningVerticals(floor, "nope", { bottom: 1 }, 2.5)).toBe(floor);
  });

  it("shifts a window vertically preserving height; doors no-op", () => {
    const floor = makeFloor();
    const height = WINDOW_HEAD - WINDOW_SILL;
    const shifted = shiftOpeningVertical(floor, "window-AB", 0.63, 2.5, 0.05);
    const v = openingVerticals(window(shifted) as Opening);
    // Quantized to the grid, height preserved.
    expect(v.bottom).toBeCloseTo(0.65, 6);
    expect(v.top - v.bottom).toBeCloseTo(height, 6);
    // Ceiling clamp keeps the whole hole under the ceiling.
    const high = shiftOpeningVertical(floor, "window-AB", 99, 2.5);
    expect(openingVerticals(window(high) as Opening).top).toBeCloseTo(2.5, 6);
    expect(shiftOpeningVertical(floor, "door-BE", 1, 2.5)).toBe(floor);
    expect(shiftOpeningVertical(floor, "window-AB", WINDOW_SILL, 2.5)).toBe(
      floor,
    );
  });
});
