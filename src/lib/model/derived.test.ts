import { describe, expect, it } from "vitest";
import { deriveFloor, reconcileFloor, updateDerivedRoom } from "./derived";
import { updateFurniture } from "./furniture";
import { setRoomName, setRoomWallHeight } from "./room";
import { makeFloor } from "./test-fixtures";
import type { Floor, Point } from "./types";

/** Points as a sorted "x,y" set so vertex order/rotation doesn't matter. */
function pointSet(points: Point[]): string[] {
  return points
    .map((p) => `${Math.round(p.x * 1e4) / 1e4},${Math.round(p.y * 1e4) / 1e4}`)
    .sort();
}

describe("deriveFloor", () => {
  it("yields two rooms with interior outlines at the wall centerlines", () => {
    const derived = deriveFloor(makeFloor());
    expect(derived.rooms).toHaveLength(2);
    const living = derived.rooms.find((r) => r.id === "living");
    const kitchen = derived.rooms.find((r) => r.id === "kitchen");
    if (!living || !kitchen) throw new Error("missing room");
    expect(pointSet(living.outline)).toEqual(
      pointSet([
        { x: 0, y: 0 },
        { x: 6.35, y: 0 },
        { x: 6.35, y: 5.2 },
        { x: 0, y: 5.2 },
      ]),
    );
    expect(pointSet(kitchen.outline)).toEqual(
      pointSet([
        { x: 6.45, y: 0 },
        { x: 9.4, y: 0 },
        { x: 9.4, y: 5.2 },
        { x: 6.45, y: 5.2 },
      ]),
    );
  });

  it("maps openings onto their room's outline walls with edge refs", () => {
    const living = deriveFloor(makeFloor()).rooms.find(
      (r) => r.id === "living",
    );
    if (!living) throw new Error("missing living");
    const door = living.openings.find((o) => o.id === "door-BE");
    const window = living.openings.find((o) => o.id === "window-AB");
    if (!door || !window) throw new Error("missing opening");

    // Door on the shared wall (x ≈ 6.35), offset ≈ 3.6.
    const doorWall = living.outline[door.wallIndex];
    expect(doorWall.x).toBeCloseTo(6.35, 4);
    expect(door.offset).toBeCloseTo(3.6, 2);
    expect(living.wallRefs[door.wallIndex].edgeId).toBe("BE");

    // Window on the y = 0 wall, offset ≈ 3.5.
    const windowWall = living.outline[window.wallIndex];
    expect(windowWall.y).toBeCloseTo(0, 4);
    expect(window.offset).toBeCloseTo(3.5, 2);
    expect(living.wallRefs[window.wallIndex].edgeId).toBe("AB");
  });

  it("partitions furniture by center containment", () => {
    const derived = deriveFloor(makeFloor());
    const living = derived.rooms.find((r) => r.id === "living");
    const kitchen = derived.rooms.find((r) => r.id === "kitchen");
    expect(living?.furniture.map((f) => f.id)).toEqual(["desk-1"]);
    expect(kitchen?.furniture.map((f) => f.id)).toEqual(["plant-1"]);
    expect(derived.unassignedFurniture.map((f) => f.id)).toEqual(["stool-1"]);
  });
});

describe("updateDerivedRoom", () => {
  it("writes a furniture move back onto floor.furniture, no-ops by reference", () => {
    const floor = makeFloor();
    const derived = deriveFloor(floor);

    const moved = updateDerivedRoom(floor, derived, "living", (room) =>
      updateFurniture(room, "desk-1", { position: { x: 2.5, y: 2.5 } }),
    );
    const desk = moved.furniture.find((f) => f.id === "desk-1");
    expect(desk?.position).toEqual({ x: 2.5, y: 2.5 });
    // Other items untouched.
    expect(moved.furniture.map((f) => f.id).sort()).toEqual([
      "desk-1",
      "plant-1",
      "stool-1",
    ]);

    // Identity fn → same floor reference.
    const same = updateDerivedRoom(floor, derived, "living", (room) => room);
    expect(same).toBe(floor);
  });

  it("renames the room record and sets its ceiling height", () => {
    const floor = makeFloor();
    const derived = deriveFloor(floor);

    const renamed = updateDerivedRoom(floor, derived, "living", (room) =>
      setRoomName(room, "Lounge"),
    );
    expect(renamed.rooms.find((r) => r.id === "living")?.name).toBe("Lounge");

    const raised = updateDerivedRoom(floor, derived, "living", (room) =>
      setRoomWallHeight(room, 3.2),
    );
    expect(raised.rooms.find((r) => r.id === "living")?.wallHeight).toBe(3.2);
  });
});

describe("reconcileFloor", () => {
  it("creates records for unclaimed faces and no-ops when settled", () => {
    const base = makeFloor();
    const empty: Floor = { ...base, rooms: [] };
    const reconciled = reconcileFloor(empty);
    expect(reconciled.rooms).toHaveLength(2);
    expect(reconciled.rooms.map((r) => r.name).sort()).toEqual([
      "Room 1",
      "Room 2",
    ]);

    // Already reconciled → same reference.
    expect(reconcileFloor(reconciled)).toBe(reconciled);
  });
});
