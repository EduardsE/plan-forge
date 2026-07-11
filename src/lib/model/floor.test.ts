import { describe, expect, it } from "vitest";
import { roomById, updateRoomIn } from "./floor";
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
  openings: [],
  furniture: [],
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

describe("createSampleFloor", () => {
  it("wraps the sample room as a one-room floor", () => {
    const floor = createSampleFloor();
    expect(floor.rooms).toHaveLength(1);
    expect(floor.rooms[0]).toEqual(createSampleRoom());
  });
});
