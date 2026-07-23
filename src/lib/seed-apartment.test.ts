import { expect, it } from "vitest";
import { deriveFloor, pointInOutline, storeyHeightOf } from "#/lib/model";
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
  // Every opening survived reconciliation: 4 windows (two living, bedroom,
  // bath) + 4 doors upstairs; window + door downstairs.
  expect(state?.building.floors.map((f) => f.openings.length)).toEqual([2, 8]);
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
  // 2.3 m ceiling + slab -> 14 risers x 0.25 m tread.
  expect(stairRun(storeyHeightOf(lower)).run).toBeCloseTo(3.5);
  expect(stairValid(building, lower.id, lower.stairs[0])).toBe(true);
});

it("uses the apartment's real ceiling heights", () => {
  const [lower, main] = createApartmentBuilding().floors;
  const heights = (floor: (typeof lower | typeof main) & object) =>
    Object.fromEntries(floor.rooms.map((room) => [room.id, room.wallHeight]));
  expect(heights(main)).toEqual({
    "room-living": 4.3,
    "room-entry": 3.7,
    "room-bath": 3.7,
    "room-bed": 2.3,
  });
  expect(heights(lower)).toEqual({
    "room-lower-bed": 2.3,
    "room-stairs": 2.3,
  });
});

it("places every furniture item inside a room", () => {
  for (const floor of createApartmentBuilding().floors) {
    const { rooms } = deriveFloor(floor);
    for (const item of floor.furniture) {
      const home = rooms.find((room) =>
        pointInOutline(room.outline, item.position),
      );
      expect(home, `${item.id} landed outside every room`).toBeDefined();
    }
  }
});

it("keeps furniture out of the stair void cut into the living room", () => {
  const [lower] = createApartmentBuilding().floors;
  const stair = lower.stairs[0];
  const { run } = stairRun(storeyHeightOf(lower));
  // Rotation 270: the run spans x, the width spans y, around the center.
  const min = {
    x: stair.position.x - run / 2,
    y: stair.position.y - stair.width / 2,
  };
  const max = {
    x: stair.position.x + run / 2,
    y: stair.position.y + stair.width / 2,
  };
  const [, main] = createApartmentBuilding().floors;
  for (const item of main.furniture) {
    const inVoid =
      item.position.x > min.x &&
      item.position.x < max.x &&
      item.position.y > min.y &&
      item.position.y < max.y;
    expect(inVoid, `${item.id} sits over the stair void`).toBe(false);
  }
});

it("returns an independent building per call", () => {
  const a = createApartmentBuilding();
  const b = createApartmentBuilding();
  expect(a).not.toBe(b);
  expect(a.floors[0]).not.toBe(b.floors[0]);
  expect(a).toEqual(b);
});
