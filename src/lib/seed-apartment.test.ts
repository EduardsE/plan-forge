import { expect, it } from "vitest";
import { deriveFloor, storeyHeightOf } from "#/lib/model";
import { deserializeSavedState, serializeSavedState } from "#/lib/persistence";
import { createApartmentBuilding } from "#/lib/seed-apartment";
import { stairRun, stairValid } from "#/lib/stairs";

it("survives the strict persistence round-trip", () => {
  const json = serializeSavedState({
    building: createApartmentBuilding(),
    unit: "m",
    savedAt: 1,
  });
  // A malformed building deserializes as null and the sample house would
  // load instead — the exact failure createHome must never hit.
  const state = deserializeSavedState(json);
  expect(state).not.toBeNull();
  expect(state?.building.floors.map((f) => f.id)).toEqual([
    "floor-lower",
    "floor-main",
  ]);
});

it("derives the six plan rooms with their names", () => {
  const [lower, main] = createApartmentBuilding().floors;
  expect(
    deriveFloor(main)
      .rooms.map((r) => r.name)
      .sort(),
  ).toEqual(["Bathroom", "Bedroom", "Entryway", "Living room"]);
  expect(
    deriveFloor(lower)
      .rooms.map((r) => r.name)
      .sort(),
  ).toEqual(["Bedroom", "Stairs"]);
});

it("keeps the stair valid inside the stairwell strip", () => {
  const building = createApartmentBuilding();
  const [lower, main] = building.floors;
  expect(main.stairs).toHaveLength(0);
  expect(lower.stairs).toHaveLength(1);
  // 2.2 m ceiling + slab -> 13 risers x 0.25 m tread.
  expect(stairRun(storeyHeightOf(lower)).run).toBeCloseTo(3.25);
  expect(stairValid(building, lower.id, lower.stairs[0])).toBe(true);
});

it("returns an independent building per call", () => {
  const a = createApartmentBuilding();
  const b = createApartmentBuilding();
  expect(a).not.toBe(b);
  expect(a.floors[0]).not.toBe(b.floors[0]);
  expect(a).toEqual(b);
});
