import { describe, expect, it } from "vitest";
import { createFloor } from "./building";
import {
  deriveFloor,
  deriveFloorsCached,
  reconcileFloor,
  updateDerivedRoom,
} from "./derived";
import { updateFurniture } from "./furniture";
import { setRoomName, setRoomWallHeight } from "./room";
import { makeFloor, makeLRoom } from "./test-fixtures";
import type { Floor, Point } from "./types";
import { setEdgeThickness } from "./walls";

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

  it("counts the openings on each room's walls (matching edge + side)", () => {
    const derived = deriveFloor(makeFloor());
    const living = derived.rooms.find((r) => r.id === "living");
    const kitchen = derived.rooms.find((r) => r.id === "kitchen");
    if (!living || !kitchen) throw new Error("missing room");

    // Both the door on BE (side 1) and the window on AB (side 1) sit on the
    // living room's walls; neither is on the kitchen's side of any wall.
    expect(living.openingCount).toBe(2);
    expect(kitchen.openingCount).toBe(0);

    // The shared wall BE reads +1 for living, -1 for kitchen (opposite
    // traversal), so the door (side 1) counts only for living.
    const livingBE = living.wallRefs.find((ref) => ref.edgeId === "BE");
    const kitchenBE = kitchen.wallRefs.find((ref) => ref.edgeId === "BE");
    expect(livingBE?.side).toBe(1);
    expect(kitchenBE?.side).toBe(-1);
  });

  it("derives wall sides from traversal orientation, not a label-point test", () => {
    // Concave L-room: the reflex vertex is `d`, and a label-point-vs-edge-line
    // side test used to flip the sign of the reflex-adjacent edges `cd`/`de`
    // (the label point can sit across their infinite lines). Traversal
    // orientation reads the true interior side (+1 for every forward edge).
    const room = deriveFloor(makeLRoom()).rooms.find((r) => r.id === "ell");
    if (!room) throw new Error("missing L room");
    const sideOf = (edgeId: string) =>
      room.wallRefs.find((ref) => ref.edgeId === edgeId)?.side;

    // Reflex-adjacent edges — the ones the old test flipped.
    expect(sideOf("cd")).toBe(1);
    expect(sideOf("de")).toBe(1);
    // The whole loop is wound so the interior is on the +1 side of each edge.
    for (const edgeId of ["ab", "bc", "cd", "de", "ef", "fa"]) {
      expect(sideOf(edgeId)).toBe(1);
    }
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

describe("deriveFloorsCached", () => {
  it("reuses the prior DerivedFloor for a floor whose reference is unchanged", () => {
    const f1 = createFloor("f1");
    const f2 = createFloor("f2");
    const first = deriveFloorsCached([f1, f2], new Map());
    const d1 = first.byId.get("f1");
    const d2 = first.byId.get("f2");
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();

    // f2 is edited (a fresh object, as every pure floor setter produces);
    // f1's reference is untouched.
    const f2Edited: Floor = { ...f2, name: "Studio" };
    const second = deriveFloorsCached([f1, f2Edited], first.cache);

    expect(second.byId.get("f1")).toBe(d1); // reused — same reference
    expect(second.byId.get("f2")).not.toBe(d2); // re-derived — f2's own id
    // slot now holds f2Edited's derivation under the same id key.
    expect(second.byId.size).toBe(2);
  });

  it("drops cache entries for floors no longer present (no unbounded growth)", () => {
    const f1 = createFloor("f1");
    const f2 = createFloor("f2");
    const first = deriveFloorsCached([f1, f2], new Map());

    const second = deriveFloorsCached([f1], first.cache);

    expect(second.cache.size).toBe(1);
    expect(second.cache.has(f1)).toBe(true);
    expect(second.cache.has(f2)).toBe(false);
  });

  it("matches a plain deriveFloor for a never-before-seen floor", () => {
    const f1 = createFloor("f1");
    const { byId } = deriveFloorsCached([f1], new Map());
    expect(byId.get("f1")).toEqual(deriveFloor(f1));
  });
});

describe("per-edge thickness in derived outlines", () => {
  it("a thick shared wall insets both rooms by half its thickness", () => {
    const floor = setEdgeThickness(makeFloor(), "BE", 0.3);
    const { rooms } = deriveFloor(floor);
    const living = rooms.find((r) => r.id === "living");
    const kitchen = rooms.find((r) => r.id === "kitchen");
    expect(living && pointSet(living.outline)).toEqual(
      pointSet([
        { x: 0, y: 0 },
        { x: 6.25, y: 0 },
        { x: 6.25, y: 5.2 },
        { x: 0, y: 5.2 },
      ]),
    );
    expect(kitchen && pointSet(kitchen.outline)).toEqual(
      pointSet([
        { x: 6.55, y: 0 },
        { x: 9.4, y: 0 },
        { x: 9.4, y: 5.2 },
        { x: 6.55, y: 5.2 },
      ]),
    );
  });

  it("a thick exterior wall leaves the interior outline unchanged", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.4);
    const living = deriveFloor(floor).rooms.find((r) => r.id === "living");
    expect(living && pointSet(living.outline)).toEqual(
      pointSet(deriveFloor(makeFloor()).rooms[0].outline),
    );
  });
});
