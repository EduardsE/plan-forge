import { describe, expect, it } from "vitest";
import { createFloor } from "./building";
import { addStair, MAX_STAIR_WIDTH, removeStair, updateStair } from "./stairs";

const stair = (id = "s") => ({
  id,
  position: { x: 2, y: 3 },
  rotation: 0,
  width: 0.9,
});

describe("addStair", () => {
  it("appends a stair", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(floor.stairs).toEqual([stair()]);
  });
  it("no-ops by reference when the stair id already exists", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(addStair(floor, stair())).toBe(floor);
  });
});

describe("updateStair", () => {
  it("clamps width into [MIN, MAX]", () => {
    const floor = addStair(createFloor("f"), stair());
    const updated = updateStair(floor, "s", { width: 5 });
    expect(updated.stairs[0].width).toBe(MAX_STAIR_WIDTH);
  });
  it("no-ops by reference on an unknown id", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(updateStair(floor, "nope", { width: 1 })).toBe(floor);
  });
  it("no-ops by reference on an identical patch", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(updateStair(floor, "s", { rotation: 0 })).toBe(floor);
  });
});

describe("removeStair", () => {
  it("drops the stair by id", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(removeStair(floor, "s").stairs).toEqual([]);
  });
  it("no-ops by reference on an unknown id", () => {
    const floor = addStair(createFloor("f"), stair());
    expect(removeStair(floor, "nope")).toBe(floor);
  });
});
