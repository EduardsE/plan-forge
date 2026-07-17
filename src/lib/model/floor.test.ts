import { describe, expect, it } from "vitest";
import { deriveFloor } from "./derived";
import {
  allFurnitureOf,
  floorBounds,
  roomAtPoint,
  roomById,
  roomOfFurniture,
  roomOfOpening,
  totalFloorArea,
  totalPerimeter,
  updateFloorFurniture,
} from "./floor";
import { addFurniture } from "./furniture";
import { createSampleRoom } from "./sample-room";
import { makeFloor } from "./test-fixtures";
import type { FurnitureItem, Room } from "./types";

/**
 * The floor helpers work on **derived** rooms (`Room[]`) — the write path
 * lives in `updateDerivedRoom`. These use two bare `Room` fixtures.
 */
const secondRoom = (): Room => ({
  id: "kitchen",
  name: "Kitchen",
  outline: [
    { x: 6.4, y: 0 },
    { x: 9.4, y: 0 },
    { x: 9.4, y: 3 },
    { x: 6.4, y: 3 },
  ],
  openings: [
    { id: "kitchen-door", kind: "door", wallIndex: 2, offset: 1, width: 0.9 },
  ],
  furniture: [
    {
      id: "stool-1",
      catalogId: "stool",
      position: { x: 7, y: 1 },
      rotation: 0,
      footprint: { width: 0.4, depth: 0.4, height: 0.45 },
    },
  ],
});

const rooms = (): Room[] => [createSampleRoom(), secondRoom()];

describe("roomById", () => {
  it("finds a room by id and misses unknown ids", () => {
    expect(roomById(rooms(), "kitchen")?.name).toBe("Kitchen");
    expect(roomById(rooms(), "attic")).toBeUndefined();
  });
});

describe("owning-room resolution", () => {
  it("finds the room owning a furniture item", () => {
    expect(roomOfFurniture(rooms(), "stool-1")?.id).toBe("kitchen");
    expect(roomOfFurniture(rooms(), "desk-1")?.id).toBe("living-room");
    expect(roomOfFurniture(rooms(), "ghost")).toBeUndefined();
  });

  it("finds the room owning an opening", () => {
    expect(roomOfOpening(rooms(), "kitchen-door")?.id).toBe("kitchen");
    expect(roomOfOpening(rooms(), "window-1")?.id).toBe("living-room");
    expect(roomOfOpening(rooms(), "ghost")).toBeUndefined();
  });
});

describe("roomAtPoint", () => {
  it("resolves the room containing a plan point", () => {
    expect(roomAtPoint(rooms(), { x: 3, y: 2 })?.id).toBe("living-room");
    expect(roomAtPoint(rooms(), { x: 8, y: 1 })?.id).toBe("kitchen");
    expect(roomAtPoint(rooms(), { x: 20, y: 20 })).toBeUndefined();
  });

  it("counts boundary points as inside within the tolerance", () => {
    expect(roomAtPoint(rooms(), { x: -0.05, y: 2 }, 0.1)?.id).toBe(
      "living-room",
    );
  });
});

describe("updateFloorFurniture", () => {
  const item: FurnitureItem = {
    id: "new-1",
    catalogId: "stool",
    // Out on the open canvas, inside no room.
    position: { x: 20, y: 20 },
    rotation: 0,
    footprint: { width: 0.4, depth: 0.4, height: 0.45 },
  };

  it("drops a piece outside every room and it derives as unassigned", () => {
    const floor = makeFloor();
    const next = updateFloorFurniture(floor, (room) =>
      addFurniture(room, item),
    );
    expect(next.furniture).toHaveLength(floor.furniture.length + 1);
    const derived = deriveFloor(next);
    // No room contains it → it lands in the unassigned bucket, still there.
    expect(
      derived.rooms.every((r) => !r.furniture.some((f) => f.id === "new-1")),
    ).toBe(true);
    expect(derived.unassignedFurniture.map((f) => f.id)).toContain("new-1");
  });

  it("keeps the same floor reference on a no-op", () => {
    const floor = makeFloor();
    expect(updateFloorFurniture(floor, (room) => room)).toBe(floor);
  });
});

describe("allFurnitureOf", () => {
  it("unions each room's furniture with the unassigned bucket", () => {
    const derived = deriveFloor(makeFloor());
    expect(
      allFurnitureOf(derived.rooms, derived.unassignedFurniture)
        .map((f) => f.id)
        .sort(),
    ).toEqual(["desk-1", "plant-1", "stool-1"]);
  });
});

describe("floor totals", () => {
  it("unions bounds across rooms", () => {
    expect(floorBounds(rooms())).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 9.4, y: 5.2 },
      width: 9.4,
      height: 5.2,
    });
    expect(floorBounds([])).toBeNull();
  });

  it("sums area and perimeter across rooms", () => {
    // 6.4 × 5.2 + 3 × 3
    expect(totalFloorArea(rooms())).toBeCloseTo(33.28 + 9, 10);
    // 2·(6.4+5.2) + 2·(3+3)
    expect(totalPerimeter(rooms())).toBeCloseTo(23.2 + 12, 10);
    // Degenerate outlines (a fresh empty room) contribute nothing.
    const withEmpty: Room[] = [
      ...rooms(),
      { id: "new", outline: [], openings: [], furniture: [] },
    ];
    expect(totalFloorArea(withEmpty)).toBeCloseTo(42.28, 10);
    expect(totalPerimeter(withEmpty)).toBeCloseTo(35.2, 10);
  });
});
