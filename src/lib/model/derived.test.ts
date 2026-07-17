import { describe, expect, it } from "vitest";
import {
  deriveFloor,
  edgeOffsetOf,
  reconcileFloor,
  updateDerivedRoom,
} from "./derived";
import { updateFurniture } from "./furniture";
import { moveOpening } from "./openings";
import { setRoomName, setRoomWallHeight } from "./room";
import type { Floor, Point } from "./types";

/**
 * Fixture: two rooms sharing a full-height edge (6 nodes, 7 edges).
 *   nodes A(-0.05,-0.05) B(6.4,-0.05) C(9.45,-0.05)
 *         D(9.45,5.25)  E(6.4,5.25)  F(-0.05,5.25)
 *   edges AB BC CD DE EF FA and the shared edge BE.
 *   records: living (anchor 3,2.5), kitchen (anchor 8,2.5).
 *   openings: door on BE (offset 3.65, width 0.95, side toward living = 1),
 *             window on AB (offset 3.55, width 2.1, side toward living = 1).
 *   furniture: desk at (2,2) in living, plant at (8,4) in kitchen,
 *              stray stool at (20,20) (unassigned).
 */
function makeFloor(): Floor {
  return {
    nodes: [
      { id: "A", x: -0.05, y: -0.05 },
      { id: "B", x: 6.4, y: -0.05 },
      { id: "C", x: 9.45, y: -0.05 },
      { id: "D", x: 9.45, y: 5.25 },
      { id: "E", x: 6.4, y: 5.25 },
      { id: "F", x: -0.05, y: 5.25 },
    ],
    edges: [
      { id: "AB", a: "A", b: "B" },
      { id: "BC", a: "B", b: "C" },
      { id: "CD", a: "C", b: "D" },
      { id: "DE", a: "D", b: "E" },
      { id: "EF", a: "E", b: "F" },
      { id: "FA", a: "F", b: "A" },
      { id: "BE", a: "B", b: "E" },
    ],
    openings: [
      {
        id: "door-BE",
        kind: "door",
        edgeId: "BE",
        offset: 3.65,
        width: 0.95,
        side: 1,
        hinge: "start",
      },
      {
        id: "window-AB",
        kind: "window",
        edgeId: "AB",
        offset: 3.55,
        width: 2.1,
        side: 1,
      },
    ],
    furniture: [
      {
        id: "desk-1",
        catalogId: "desk",
        position: { x: 2, y: 2 },
        rotation: 0,
        footprint: { width: 1.2, depth: 0.6, height: 0.75 },
      },
      {
        id: "plant-1",
        catalogId: "plant",
        position: { x: 8, y: 4 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 1.2 },
      },
      {
        id: "stool-1",
        catalogId: "stool",
        position: { x: 20, y: 20 },
        rotation: 0,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
    ],
    rooms: [
      { id: "living", name: "Living room", anchor: { x: 3, y: 2.5 } },
      { id: "kitchen", name: "Kitchen", anchor: { x: 8, y: 2.5 } },
    ],
  };
}

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

  it("rewrites a moved opening onto its edge", () => {
    const floor = makeFloor();
    const derived = deriveFloor(floor);
    const next = updateDerivedRoom(floor, derived, "living", (room) =>
      moveOpening(room, "door-BE", 2.0),
    );
    const stored = next.openings.find((o) => o.id === "door-BE");
    expect(stored?.edgeId).toBe("BE");
    expect(stored?.offset).toBeCloseTo(2.05, 2);
    expect(stored?.side).toBe(1);
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

describe("edgeOffsetOf", () => {
  it("projects a wall-local span back onto the edge", () => {
    const floor = makeFloor();
    const living = deriveFloor(floor).rooms.find((r) => r.id === "living");
    if (!living) throw new Error("missing living");
    const door = living.openings.find((o) => o.id === "door-BE");
    if (!door) throw new Error("missing door");
    const ref = living.wallRefs[door.wallIndex];
    const edgeOffset = edgeOffsetOf(
      floor,
      ref,
      living,
      door.wallIndex,
      2.0,
      door.width,
    );
    expect(edgeOffset).toBeCloseTo(2.05, 2);
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
