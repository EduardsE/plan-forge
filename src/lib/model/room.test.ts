import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_HEIGHT,
  MAX_WALL_HEIGHT,
  MIN_WALL_HEIGHT,
  setRoomName,
  setRoomWallHeight,
  wallHeightOf,
} from "./room";
import type { FurnitureItem, Room } from "./types";

const makeRoom = (overrides: Partial<Room> = {}): Room => ({
  id: "room-1",
  name: "Living room",
  outline: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ],
  openings: [],
  furniture: [],
  ...overrides,
});

const mountedItem = (elevation: number, height = 0.6): FurnitureItem => ({
  id: "frame-1",
  catalogId: "wall-frame",
  position: { x: 2, y: 0.05 },
  rotation: 0,
  footprint: { width: 0.7, depth: 0.1, height },
  mount: { roomId: "room", wallIndex: 0, offset: 1.6, elevation },
});

describe("wallHeightOf", () => {
  it("falls back to the default when the room sets none", () => {
    expect(wallHeightOf(makeRoom())).toBe(DEFAULT_WALL_HEIGHT);
    expect(wallHeightOf(makeRoom({ wallHeight: 3.1 }))).toBe(3.1);
  });
});

describe("setRoomName", () => {
  it("renames and trims", () => {
    expect(setRoomName(makeRoom(), "  Studio  ").name).toBe("Studio");
  });

  it("returns the same reference for no-ops and empty input", () => {
    const room = makeRoom();
    expect(setRoomName(room, "Living room")).toBe(room);
    expect(setRoomName(room, "  Living room ")).toBe(room);
    expect(setRoomName(room, "   ")).toBe(room);
  });
});

describe("setRoomWallHeight", () => {
  it("sets a clamped height", () => {
    expect(setRoomWallHeight(makeRoom(), 3).wallHeight).toBe(3);
    expect(setRoomWallHeight(makeRoom(), 1).wallHeight).toBe(MIN_WALL_HEIGHT);
    expect(setRoomWallHeight(makeRoom(), 99).wallHeight).toBe(MAX_WALL_HEIGHT);
  });

  it("stores the default height as an absent field", () => {
    const raised = setRoomWallHeight(makeRoom(), 3.2);
    const backToDefault = setRoomWallHeight(raised, DEFAULT_WALL_HEIGHT);
    expect("wallHeight" in backToDefault).toBe(false);
    expect(wallHeightOf(backToDefault)).toBe(DEFAULT_WALL_HEIGHT);
  });

  it("returns the same reference for no-ops and non-finite input", () => {
    const room = makeRoom();
    expect(setRoomWallHeight(room, DEFAULT_WALL_HEIGHT)).toBe(room);
    expect(setRoomWallHeight(room, Number.NaN)).toBe(room);
    const tall = makeRoom({ wallHeight: 3 });
    expect(setRoomWallHeight(tall, 3)).toBe(tall);
  });

  it("re-clamps mounted furniture under a lowered ceiling", () => {
    const room = makeRoom({ furniture: [mountedItem(2.3)] });
    const lowered = setRoomWallHeight(room, MIN_WALL_HEIGHT);
    // Body top must stay at or below the new ceiling: 2.2 - 0.6/2 = 1.9.
    expect(lowered.furniture[0].mount?.elevation).toBeCloseTo(1.9, 10);
  });

  it("lets the floor clamp win for an item taller than the wall", () => {
    const room = makeRoom({ furniture: [mountedItem(1.5, 5)] });
    const lowered = setRoomWallHeight(room, MIN_WALL_HEIGHT);
    expect(lowered.furniture[0].mount?.elevation).toBe(2.5);
  });

  it("leaves untouched furniture objects by reference", () => {
    const floorItem: FurnitureItem = {
      id: "sofa-1",
      catalogId: "sofa-2",
      position: { x: 2, y: 1.5 },
      rotation: 0,
      footprint: { width: 1.8, depth: 0.9, height: 0.8 },
    };
    const room = makeRoom({ furniture: [floorItem, mountedItem(1.5)] });
    const raised = setRoomWallHeight(room, 3);
    expect(raised.furniture[0]).toBe(floorItem);
    expect(raised.furniture[1]).toBe(room.furniture[1]);
  });
});
