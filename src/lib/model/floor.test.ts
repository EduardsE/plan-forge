import { describe, expect, it } from "vitest";
import {
  addRoom,
  floorBounds,
  nextRoomName,
  reparentFurniture,
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

describe("addRoom", () => {
  it("appends the room, leaving existing rooms untouched", () => {
    const floor: Floor = { rooms: [createSampleRoom()] };
    const next = addRoom(floor, secondRoom());
    expect(next.rooms).toHaveLength(2);
    expect(next.rooms[0]).toBe(floor.rooms[0]);
    expect(next.rooms[1].id).toBe("kitchen");
    // The input floor is untouched (pure).
    expect(floor.rooms).toHaveLength(1);
  });
});

describe("nextRoomName", () => {
  it("numbers past the existing rooms and skips taken names", () => {
    expect(nextRoomName(twoRoomFloor())).toBe("Room 3");
    const floor = twoRoomFloor();
    floor.rooms[1] = { ...floor.rooms[1], name: "Room 3" };
    expect(nextRoomName(floor)).toBe("Room 4");
  });
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

describe("reparentFurniture", () => {
  it("moves the item into the destination room at the updated position", () => {
    const floor = twoRoomFloor();
    const next = reparentFurniture(floor, "desk-chair-1", "kitchen", {
      position: { x: 7.5, y: 1.5 },
    });
    expect(roomOfFurniture(next, "desk-chair-1")?.id).toBe("kitchen");
    const moved = roomById(next, "kitchen")?.furniture.find(
      (item) => item.id === "desk-chair-1",
    );
    expect(moved?.position).toEqual({ x: 7.5, y: 1.5 });
    // Untouched rooms and the source floor stay as they were (pure).
    expect(
      roomById(floor, "living-room")?.furniture.some(
        (item) => item.id === "desk-chair-1",
      ),
    ).toBe(true);
  });

  it("carries riders stacked on the item across with it", () => {
    const floor = twoRoomFloor();
    const living = floor.rooms[0];
    floor.rooms[0] = {
      ...living,
      furniture: [
        ...living.furniture,
        {
          id: "lamp-1",
          catalogId: "table-lamp",
          position: { x: 4.7, y: 0.73 },
          rotation: 0,
          footprint: { width: 0.2, depth: 0.2, height: 0.45 },
          stack: { hostId: "desk-1", dx: 0, dy: 0 },
        },
      ],
    };
    const next = reparentFurniture(floor, "desk-1", "kitchen", {
      position: { x: 7.5, y: 1.5 },
    });
    expect(roomOfFurniture(next, "lamp-1")?.id).toBe("kitchen");
    // The rider's derived position followed its host into the new room.
    const lamp = roomById(next, "kitchen")?.furniture.find(
      (item) => item.id === "lamp-1",
    );
    expect(lamp?.position).toEqual({ x: 7.5, y: 1.5 });
  });

  it("reduces to a plain in-room update for a same-room target", () => {
    const floor = twoRoomFloor();
    const next = reparentFurniture(floor, "stool-1", "kitchen", {
      position: { x: 8, y: 2 },
    });
    expect(roomById(next, "kitchen")?.furniture[0].position).toEqual({
      x: 8,
      y: 2,
    });
    // The other room rides along untouched (same reference).
    expect(next.rooms[0]).toBe(floor.rooms[0]);
  });

  it("returns the same floor for unknown item or room ids", () => {
    const floor = twoRoomFloor();
    expect(
      reparentFurniture(floor, "ghost", "kitchen", {
        position: { x: 0, y: 0 },
      }),
    ).toBe(floor);
    expect(
      reparentFurniture(floor, "stool-1", "attic", {
        position: { x: 0, y: 0 },
      }),
    ).toBe(floor);
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
  it("ships the two-room flat, living room first", () => {
    const floor = createSampleFloor();
    expect(floor.rooms).toHaveLength(2);
    expect(floor.rooms[0]).toEqual(createSampleRoom());
    expect(floor.rooms[1].name).toBe("Kitchen");
  });
});
