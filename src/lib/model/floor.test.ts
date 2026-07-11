import { describe, expect, it } from "vitest";
import {
  floorBounds,
  roomAtPoint,
  roomById,
  roomOfFurniture,
  roomOfOpening,
  totalFloorArea,
  totalPerimeter,
  updateRoomIn,
} from "./floor";
import { createSampleFloor, createSampleRoom } from "./sample-room";
import type { Floor, Room } from "./types";

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

const twoRoomFloor = (): Floor => ({
  rooms: [createSampleRoom(), secondRoom()],
});

describe("roomById", () => {
  it("finds a room by id and misses unknown ids", () => {
    const floor = twoRoomFloor();
    expect(roomById(floor, "kitchen")?.name).toBe("Kitchen");
    expect(roomById(floor, "attic")).toBeUndefined();
  });
});

describe("updateRoomIn", () => {
  it("replaces only the addressed room", () => {
    const floor = twoRoomFloor();
    const next = updateRoomIn(floor, "kitchen", (room) => ({
      ...room,
      name: "Galley",
    }));
    expect(next.rooms[1].name).toBe("Galley");
    // The other room rides along untouched (same reference).
    expect(next.rooms[0]).toBe(floor.rooms[0]);
  });

  it("returns the same floor for an unknown room id", () => {
    const floor = twoRoomFloor();
    expect(updateRoomIn(floor, "attic", (room) => ({ ...room }))).toBe(floor);
  });

  it("returns the same floor when the update is a no-op (same reference)", () => {
    const floor = twoRoomFloor();
    expect(updateRoomIn(floor, "kitchen", (room) => room)).toBe(floor);
  });
});

describe("owning-room resolution", () => {
  it("finds the room owning a furniture item", () => {
    const floor = twoRoomFloor();
    expect(roomOfFurniture(floor, "stool-1")?.id).toBe("kitchen");
    expect(roomOfFurniture(floor, "desk-1")?.id).toBe("living-room");
    expect(roomOfFurniture(floor, "ghost")).toBeUndefined();
  });

  it("finds the room owning an opening", () => {
    const floor = twoRoomFloor();
    expect(roomOfOpening(floor, "kitchen-door")?.id).toBe("kitchen");
    expect(roomOfOpening(floor, "window-1")?.id).toBe("living-room");
    expect(roomOfOpening(floor, "ghost")).toBeUndefined();
  });
});

describe("roomAtPoint", () => {
  it("resolves the room containing a plan point", () => {
    const floor = twoRoomFloor();
    expect(roomAtPoint(floor, { x: 3, y: 2 })?.id).toBe("living-room");
    expect(roomAtPoint(floor, { x: 8, y: 1 })?.id).toBe("kitchen");
    expect(roomAtPoint(floor, { x: 20, y: 20 })).toBeUndefined();
  });

  it("counts boundary points as inside within the tolerance", () => {
    const floor = twoRoomFloor();
    expect(roomAtPoint(floor, { x: -0.05, y: 2 }, 0.1)?.id).toBe("living-room");
  });
});

describe("floor totals", () => {
  it("unions bounds across rooms", () => {
    expect(floorBounds(twoRoomFloor())).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 9.4, y: 5.2 },
      width: 9.4,
      height: 5.2,
    });
    expect(floorBounds({ rooms: [] })).toBeNull();
  });

  it("sums area and perimeter across rooms", () => {
    const floor = twoRoomFloor();
    // 6.4 × 5.2 + 3 × 3
    expect(totalFloorArea(floor)).toBeCloseTo(33.28 + 9, 10);
    // 2·(6.4+5.2) + 2·(3+3)
    expect(totalPerimeter(floor)).toBeCloseTo(23.2 + 12, 10);
    // Degenerate outlines (a fresh empty room) contribute nothing.
    const withEmpty: Floor = {
      rooms: [
        ...floor.rooms,
        { id: "new", outline: [], openings: [], furniture: [] },
      ],
    };
    expect(totalFloorArea(withEmpty)).toBeCloseTo(42.28, 10);
    expect(totalPerimeter(withEmpty)).toBeCloseTo(35.2, 10);
  });
});

describe("createSampleFloor", () => {
  it("wraps the sample room as a one-room floor", () => {
    const floor = createSampleFloor();
    expect(floor.rooms).toHaveLength(1);
    expect(floor.rooms[0]).toEqual(createSampleRoom());
  });
});
