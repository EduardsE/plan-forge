import { describe, expect, it } from "vitest";
import {
  addFloorAbove,
  createFloor,
  floorDisplayName,
  floorOfItem,
  removeFloor,
  renameFloor,
  SLAB_THICKNESS,
  storeyElevation,
  storeyHeightOf,
  topFloorOf,
  updateFloorIn,
} from "./building";
import { DEFAULT_WALL_HEIGHT } from "./room";
import { makeFloor } from "./test-fixtures";
import type { Building } from "./types";

const ground = { ...makeFloor(), id: "g" };
const building = (): Building => ({ floors: [ground, createFloor("f2")] });

describe("storey math", () => {
  it("empty floor gets the default ceiling", () => {
    expect(storeyHeightOf(createFloor("x"))).toBeCloseTo(
      DEFAULT_WALL_HEIGHT + SLAB_THICKNESS,
    );
  });
  it("tallest room wins", () => {
    const tall = {
      ...ground,
      rooms: ground.rooms.map((r, i) =>
        i === 0 ? { ...r, wallHeight: 3.2 } : r,
      ),
    };
    expect(storeyHeightOf(tall)).toBeCloseTo(3.2 + SLAB_THICKNESS);
  });
  it("elevation sums the storeys below", () => {
    const b = building();
    expect(storeyElevation(b, 0)).toBe(0);
    expect(storeyElevation(b, 1)).toBeCloseTo(storeyHeightOf(ground));
  });
});

describe("topFloorOf", () => {
  it("is the last floor in the stack", () => {
    expect(topFloorOf(building()).id).toBe("f2");
  });
  it("is the only floor of a one-storey building", () => {
    expect(topFloorOf({ floors: [ground] }).id).toBe("g");
  });
});

describe("updateFloorIn", () => {
  it("replaces only the target floor and no-ops by reference", () => {
    const b = building();
    expect(updateFloorIn(b, "g", (f) => f)).toBe(b);
    expect(updateFloorIn(b, "missing", (f) => ({ ...f }))).toBe(b);
    const renamed = updateFloorIn(b, "f2", (f) => ({ ...f, name: "Attic" }));
    expect(renamed).not.toBe(b);
    expect(renamed.floors[0]).toBe(b.floors[0]);
    expect(renamed.floors[1].name).toBe("Attic");
  });
});

describe("floor management", () => {
  it("addFloorAbove appends an empty floor with a fresh id", () => {
    let n = 0;
    const b = addFloorAbove(building(), () => `gen-${n++}`);
    expect(b.floors).toHaveLength(3);
    expect(b.floors[2].id).toBe("gen-0");
    expect(b.floors[2].nodes).toEqual([]);
  });
  it("removeFloor refuses the last floor and strips the new top floor's stairs", () => {
    const stair = {
      id: "s1",
      position: { x: 2, y: 2 },
      rotation: 0,
      width: 0.9,
    };
    const b: Building = {
      floors: [{ ...ground, stairs: [stair] }, createFloor("f2")],
    };
    const removed = removeFloor(b, "f2");
    expect(removed.floors).toHaveLength(1);
    expect(removed.floors[0].stairs).toEqual([]); // ground is top now
    expect(removeFloor(removed, "g")).toBe(removed); // last floor: no-op
  });
  it("renameFloor trims, empty reverts to absent, display names derive by index", () => {
    const b = renameFloor(building(), "f2", "  Studio  ");
    expect(b.floors[1].name).toBe("Studio");
    const cleared = renameFloor(b, "f2", "   ");
    expect(cleared.floors[1].name).toBeUndefined();
    expect(floorDisplayName(cleared, 0)).toBe("Ground floor");
    expect(floorDisplayName(cleared, 1)).toBe("Floor 2");
  });
  it("floorOfItem finds the owning floor across storeys", () => {
    const b = building();
    const anyItem = ground.furniture[0];
    expect(floorOfItem(b, anyItem.id)?.id).toBe("g");
    expect(floorOfItem(b, "nope")).toBeUndefined();
  });
});
