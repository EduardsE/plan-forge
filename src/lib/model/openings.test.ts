import { describe, expect, it } from "vitest";
import {
  addFloorOpening,
  DOOR_HEIGHT,
  dragOpeningTo,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  MIN_OPENING_HEIGHT,
  moveFloorOpening,
  openingPaneGrid,
  openingSill,
  openingVerticals,
  removeFloorOpening,
  resizeFloorOpening,
  resolveOpeningDrag,
  setOpeningPaneGrid,
  setOpeningSillMaterial,
  setOpeningSillOverhang,
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

  it("clamps a vertical edit against a stacked neighbor, not just floor/ceiling", () => {
    // A second window right above window-AB (0.36–1.94): band 2.0–2.6.
    const floor = addFloorOpening(makeFloor(), {
      id: "w-up",
      kind: "window",
      edgeId: "AB",
      offset: 4.0,
      width: 1.0,
      side: 1,
      sill: 2.0,
      head: 2.6,
    });
    // The upper window's sill can't drop through the lower window's head.
    const lowered = setOpeningVerticals(floor, "w-up", { bottom: 1.0 }, 3.2);
    expect(
      openingVerticals(lowered.openings.find((o) => o.id === "w-up") as Opening)
        .bottom,
    ).toBeCloseTo(WINDOW_HEAD, 6);
    // The lower window's head can't grow through the upper window's sill.
    const raised = setOpeningVerticals(floor, "window-AB", { top: 2.4 }, 3.2);
    expect(openingVerticals(window(raised) as Opening).top).toBeCloseTo(2.0, 6);
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

  it("a vertical shift rides over a stacked neighbor, never through it", () => {
    const floor = addFloorOpening(makeFloor(), {
      id: "w-up",
      kind: "window",
      edgeId: "AB",
      offset: 4.0,
      width: 1.0,
      side: 1,
      sill: 2.0,
      head: 2.6,
    });
    const wUp = (f: ReturnType<typeof makeFloor>) =>
      f.openings.find((o) => o.id === "w-up");
    // Dragged down into the lower window's band: clamps flush onto its head.
    const down = shiftOpeningVertical(floor, "w-up", 0.5, 3.2);
    expect(openingVerticals(wUp(down) as Opening)).toEqual({
      bottom: expect.closeTo(WINDOW_HEAD, 6),
      top: expect.closeTo(WINDOW_HEAD + 0.6, 6),
    });
    // The lower window dragged up stops under the upper's sill.
    const up = shiftOpeningVertical(floor, "window-AB", 2.0, 3.2);
    expect(openingVerticals(window(up) as Opening).top).toBeCloseTo(2.0, 6);
    // No free vertical stretch that fits → no-op by reference.
    expect(shiftOpeningVertical(floor, "w-up", 0.5, 2.3)).toBe(floor);
  });
});

describe("stacked openings share a stretch of wall", () => {
  const stackedFloor = () =>
    addFloorOpening(makeFloor(), {
      id: "w-up",
      kind: "window",
      edgeId: "AB",
      offset: 4.0,
      width: 1.0,
      side: 1,
      sill: 2.0,
      head: 2.6,
    });

  it("adds a vertically clear window right on top of another", () => {
    // Band 2.0–2.6 is clear of window-AB's 0.36–1.94 → no slide off [4.0].
    const floor = stackedFloor();
    expect(floor.openings.find((o) => o.id === "w-up")?.offset).toBeCloseTo(
      4.0,
      6,
    );
    // The same insert at the default band slides clear of window-AB.
    const sameBand = addFloorOpening(makeFloor(), {
      id: "w-flat",
      kind: "window",
      edgeId: "AB",
      offset: 4.0,
      width: 1.0,
      side: 1,
    });
    const slid = sameBand.openings.find((o) => o.id === "w-flat");
    expect((slid?.offset ?? 0) + 1.0).toBeLessThanOrEqual(3.55 + 1e-6);
  });

  it("adds a transom window above a door", () => {
    // Door-BE runs 0–2.05; a window silled at 2.1 shares its span freely.
    const floor = addFloorOpening(makeFloor(), {
      id: "transom",
      kind: "window",
      edgeId: "BE",
      offset: 3.65,
      width: 0.95,
      side: 1,
      sill: 2.1,
      head: 2.4,
    });
    expect(floor.openings.find((o) => o.id === "transom")?.offset).toBeCloseTo(
      3.65,
      6,
    );
  });

  it("moves a raised window across a lower one", () => {
    const moved = moveFloorOpening(stackedFloor(), "w-up", 3.6);
    expect(moved.openings.find((o) => o.id === "w-up")?.offset).toBeCloseTo(
      3.6,
      6,
    );
  });

  it("resizes past a stacked neighbor (only same-band openings cap it)", () => {
    // window-AB (center 4.6) grows to 3.0 wide, straight through w-up's span.
    const wide = resizeFloorOpening(stackedFloor(), "window-AB", 3.0);
    const w = wide.openings.find((o) => o.id === "window-AB");
    expect(w?.width).toBeCloseTo(3.0, 6);
    expect(w?.offset).toBeCloseTo(3.1, 6);
  });
});

describe("combined 3D opening drag stacks flush", () => {
  // window-AB spans [3.55, 5.65] at the default band 0.36–1.94 on a 2.5 m wall.
  const neighbor = { start: 3.55, width: 2.1, bottom: 0.36, top: 1.94 };

  it("snaps a window's bottom flush onto a neighbor's off-grid top", () => {
    // Dragging onto window-AB's column with a bottom a grid-step *inside* its
    // top must land exactly on 1.94 (not a 0.05 multiple) — 0 gap, no shove.
    const r = resolveOpeningDrag(
      6.45,
      2.5,
      true,
      0.5,
      0.5,
      0.2,
      [neighbor],
      3.55,
      1.9,
      0.05,
    );
    expect(r.bottom).toBeCloseTo(1.94, 6);
    expect(r.offset).toBeCloseTo(3.55, 6);
  });

  it("lifts a window onto the column even from a low cursor", () => {
    // Over the column but dragged low: the nearest fitting vertical gap is the
    // stretch above the neighbor, so it rides up and keeps the column.
    const r = resolveOpeningDrag(
      6.45,
      2.5,
      true,
      0.5,
      0.5,
      0.2,
      [neighbor],
      3.55,
      0.5,
      0.05,
    );
    expect(r.bottom).toBeCloseTo(1.94, 6);
    expect(r.offset).toBeCloseTo(3.55, 6);
  });

  it("slides clear only when the band genuinely can't stack", () => {
    // A full-height neighbor leaves no vertical gap: the window stays at its
    // band and slides off the column instead.
    const full = { start: 3.55, width: 2.1, bottom: 0, top: 2.5 };
    const r = resolveOpeningDrag(
      6.45,
      2.5,
      true,
      0.5,
      0.5,
      0.2,
      [full],
      3.55,
      1.0,
      0.05,
    );
    expect(r.bottom).toBeCloseTo(0.2, 6);
    // Clamped flush to the left of the neighbor's [3.55, 5.65] span.
    expect(r.offset).toBeCloseTo(3.05, 6);
  });

  it("pins a door to the floor and only slides along the edge", () => {
    const r = resolveOpeningDrag(
      6.45,
      2.5,
      false,
      0.9,
      2.05,
      0,
      [neighbor],
      1.0,
      1.5,
      0.05,
    );
    expect(r.bottom).toBe(0);
    expect(r.offset).toBeCloseTo(1.0, 6);
  });

  it("returns null offset when no free stretch fits the width", () => {
    const wall = { start: 0, width: 6.45, bottom: 0.36, top: 1.94 };
    const r = resolveOpeningDrag(
      6.45,
      2.5,
      true,
      2.0,
      1.58,
      0.36,
      [wall],
      1.0,
      0.36,
      0.05,
    );
    expect(r.offset).toBeNull();
  });

  it("commits a flush stack through dragOpeningTo, no-ops by reference", () => {
    const floor = addFloorOpening(makeFloor(), {
      id: "w2",
      kind: "window",
      edgeId: "AB",
      offset: 0.3,
      width: 0.5,
      side: 1,
      sill: 0.2,
      head: 0.7,
    });
    // Drag w2 onto window-AB's column, cursor bottom just under its 1.94 top.
    const stacked = dragOpeningTo(floor, "w2", 3.55, 1.9, 2.5, 0.05);
    const w2 = stacked.openings.find((o) => o.id === "w2");
    expect(openingVerticals(w2 as Opening).bottom).toBeCloseTo(1.94, 6);
    expect(w2?.offset).toBeCloseTo(3.55, 6);
    // Re-dragging to the same resolved spot is a no-op (same reference).
    expect(dragOpeningTo(stacked, "w2", 3.55, 1.9, 2.5, 0.05)).toBe(stacked);
    // Unknown id → same reference.
    expect(dragOpeningTo(floor, "nope", 1, 1, 2.5, 0.05)).toBe(floor);
  });
});

describe("window sills", () => {
  it("resolves defaults for an untouched window", () => {
    const floor = makeFloor();
    const window = floor.openings.find((o) => o.id === "window-AB");
    if (!window) throw new Error("fixture window missing");
    expect(openingSill(window)).toEqual({ overhang: 0.03, material: "white" });
  });

  it("stores a clamped overhang sparsely", () => {
    const floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0.18);
    const window = floor.openings.find((o) => o.id === "window-AB");
    expect(window?.sillOverhang).toBe(0.18);
    const back = setOpeningSillOverhang(floor, "window-AB", 0.03);
    expect(
      back.openings.find((o) => o.id === "window-AB")?.sillOverhang,
    ).toBeUndefined();
    const wild = setOpeningSillOverhang(makeFloor(), "window-AB", 9);
    expect(wild.openings.find((o) => o.id === "window-AB")?.sillOverhang).toBe(
      0.4,
    );
  });

  it("stores material sparsely (white is the default)", () => {
    const floor = setOpeningSillMaterial(makeFloor(), "window-AB", "wood");
    expect(floor.openings.find((o) => o.id === "window-AB")?.sillMaterial).toBe(
      "wood",
    );
    const back = setOpeningSillMaterial(floor, "window-AB", "white");
    expect(
      back.openings.find((o) => o.id === "window-AB")?.sillMaterial,
    ).toBeUndefined();
  });

  it("no-ops on doors, unknown ids, and non-finite overhangs", () => {
    const floor = makeFloor();
    expect(setOpeningSillOverhang(floor, "door-BE", 0.2)).toBe(floor);
    expect(setOpeningSillMaterial(floor, "door-BE", "wood")).toBe(floor);
    expect(setOpeningSillOverhang(floor, "nope", 0.2)).toBe(floor);
    expect(setOpeningSillOverhang(floor, "window-AB", Number.NaN)).toBe(floor);
    expect(setOpeningSillOverhang(floor, "window-AB", 0.03)).toBe(floor);
  });
});

describe("window pane grid", () => {
  it("resolves 2×2 defaults for an untouched window", () => {
    const floor = makeFloor();
    const window = floor.openings.find((o) => o.id === "window-AB");
    if (!window) throw new Error("fixture window missing");
    expect(openingPaneGrid(window)).toEqual({ cols: 2, rows: 2 });
  });

  it("stores a non-default grid, dropping fields back at the default", () => {
    const floor = setOpeningPaneGrid(makeFloor(), "window-AB", {
      cols: 4,
      rows: 3,
    });
    const window = floor.openings.find((o) => o.id === "window-AB");
    expect(window?.paneCols).toBe(4);
    expect(window?.paneRows).toBe(3);
    const back = setOpeningPaneGrid(floor, "window-AB", { cols: 2, rows: 2 });
    const reverted = back.openings.find((o) => o.id === "window-AB");
    expect(reverted?.paneCols).toBeUndefined();
    expect(reverted?.paneRows).toBeUndefined();
  });

  it("rounds and clamps into 1..MAX_PANE_DIVISIONS", () => {
    const wild = setOpeningPaneGrid(makeFloor(), "window-AB", {
      cols: 0,
      rows: 12,
    });
    const window = wild.openings.find((o) => o.id === "window-AB");
    expect(openingPaneGrid(window as Opening)).toEqual({ cols: 1, rows: 8 });
    const fraction = setOpeningPaneGrid(makeFloor(), "window-AB", {
      cols: 3.6,
    });
    expect(fraction.openings.find((o) => o.id === "window-AB")?.paneCols).toBe(
      4,
    );
  });

  it("leaves the unspecified axis untouched", () => {
    const floor = setOpeningPaneGrid(makeFloor(), "window-AB", { rows: 5 });
    const window = floor.openings.find((o) => o.id === "window-AB");
    expect(window?.paneCols).toBeUndefined();
    expect(window?.paneRows).toBe(5);
  });

  it("no-ops on doors, unknown ids, non-finite and same values", () => {
    const floor = makeFloor();
    expect(setOpeningPaneGrid(floor, "door-BE", { cols: 4 })).toBe(floor);
    expect(setOpeningPaneGrid(floor, "nope", { cols: 4 })).toBe(floor);
    expect(setOpeningPaneGrid(floor, "window-AB", { cols: Number.NaN })).toBe(
      floor,
    );
    expect(setOpeningPaneGrid(floor, "window-AB", {})).toBe(floor);
    expect(setOpeningPaneGrid(floor, "window-AB", { cols: 2, rows: 2 })).toBe(
      floor,
    );
  });
});
