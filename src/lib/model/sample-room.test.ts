import { describe, expect, it } from "vitest";
import { overlappingFurnitureIds } from "#/lib/collision";
import { stairPolygon, stairRun, stairValid } from "#/lib/stairs";
import { storeyHeightOf } from "./building";
import { deriveFloor, portalLabel } from "./derived";
import { floorArea, outlineBounds, wallLength, wallsOf } from "./geometry";
import { createSampleBuilding, createSampleFloor } from "./sample-room";
import { createSampleKitchen, createSampleRoom } from "./test-fixtures";
import type { FurnitureItem, Room } from "./types";

/** Axis-aligned x/y half-extents of a footprint after rotation. */
function halfExtents(item: FurnitureItem): { hx: number; hy: number } {
  const radians = (item.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const { width, depth } = item.footprint;
  return {
    hx: (width * cos + depth * sin) / 2,
    hy: (width * sin + depth * cos) / 2,
  };
}

/** Every furniture item's rotated AABB sits inside the room's bounds. */
function expectFurnitureInside(room: Room) {
  const bounds = outlineBounds(room.outline);
  expect(bounds).toBeDefined();
  if (!bounds) return;
  const EPS = 1e-9;
  for (const item of room.furniture) {
    const { hx, hy } = halfExtents(item);
    expect(item.position.x - hx).toBeGreaterThanOrEqual(bounds.min.x - EPS);
    expect(item.position.x + hx).toBeLessThanOrEqual(bounds.max.x + EPS);
    expect(item.position.y - hy).toBeGreaterThanOrEqual(bounds.min.y - EPS);
    expect(item.position.y + hy).toBeLessThanOrEqual(bounds.max.y + EPS);
  }
}

describe("createSampleRoom (test fixture)", () => {
  it("computes the mockup's 33.28 m² from the area helper", () => {
    expect(floorArea(createSampleRoom().outline)).toBeCloseTo(33.28, 10);
  });

  it("has one door and one window, each fitting inside its host wall", () => {
    const room = createSampleRoom();
    const walls = wallsOf(room.outline);
    expect(room.openings.map((o) => o.kind).sort()).toEqual(["door", "window"]);
    for (const opening of room.openings) {
      const wall = walls[opening.wallIndex];
      expect(wall).toBeDefined();
      expect(opening.offset).toBeGreaterThan(0);
      expect(opening.offset + opening.width).toBeLessThan(wallLength(wall));
    }
  });

  it("places every furniture item inside, no overlaps", () => {
    const room = createSampleRoom();
    expectFurnitureInside(room);
    expect(overlappingFurnitureIds(room.furniture).size).toBe(0);
  });
});

describe("createSampleKitchen (test fixture)", () => {
  it("places every furniture item inside, no overlaps", () => {
    const room = createSampleKitchen();
    expectFurnitureInside(room);
    expect(overlappingFurnitureIds(room.furniture).size).toBe(0);
  });
});

describe("createSampleBuilding", () => {
  it("stacks two storeys: four rooms off the hall, six off the landing", () => {
    const building = createSampleBuilding();
    expect(building.floors).toHaveLength(2);
    const [ground, upper] = building.floors.map((f) => deriveFloor(f));
    expect(ground.rooms.map((r) => r.name).sort()).toEqual([
      "Hall",
      "Kitchen & dining",
      "Living room",
      "Utility",
    ]);
    expect(upper.rooms.map((r) => r.name).sort()).toEqual([
      "Bathroom",
      "Bedroom 2",
      "Dressing room",
      "Home office",
      "Landing",
      "Master bedroom",
    ]);
  });

  it("derives the room interiors from the wall centerlines", () => {
    const derived = deriveFloor(createSampleBuilding().floors[0]);
    // The living room's centerline cell is 0…4.2 / 0…7.4; inset by half a
    // wall thickness the interior runs 0.05…4.15 / 0.05…7.35.
    const living = derived.rooms.find((r) => r.id === "living-room");
    const bounds = outlineBounds(living?.outline ?? []);
    expect(bounds?.min.x).toBeCloseTo(0.05, 4);
    expect(bounds?.max.x).toBeCloseTo(4.15, 4);
    // Areas come straight from the derived outlines — never hardcoded.
    expect(floorArea(living?.outline ?? [])).toBeCloseTo(4.1 * 7.3, 4);
    const utility = derived.rooms.find((r) => r.id === "utility");
    expect(floorArea(utility?.outline ?? [])).toBeCloseTo(3.1 * 2.9, 4);
  });

  it("connects each ground room to the hall through its door", () => {
    const floor = createSampleBuilding().floors[0];
    const rooms = deriveFloor(floor).rooms;
    const portal = (id: string) =>
      portalLabel(rooms, floor, id)?.split(" ↔ ").sort();
    expect(portal("go-living-door")).toEqual(["Hall", "Living room"]);
    expect(portal("go-kitchen-door")).toEqual(["Hall", "Kitchen & dining"]);
    expect(portal("go-utility-door")).toEqual(["Hall", "Utility"]);
    // The front door and windows sit on exterior edges — no portal.
    expect(portalLabel(rooms, floor, "go-front-door")).toBeNull();
    expect(portalLabel(rooms, floor, "go-living-window-west")).toBeNull();
  });

  it("connects the upper rooms off the landing (dressing via the master)", () => {
    const floor = createSampleBuilding().floors[1];
    const rooms = deriveFloor(floor).rooms;
    const portal = (id: string) =>
      portalLabel(rooms, floor, id)?.split(" ↔ ").sort();
    expect(portal("uo-bedroom2-door")).toEqual(["Bedroom 2", "Landing"]);
    expect(portal("uo-office-door")).toEqual(["Home office", "Landing"]);
    expect(portal("uo-bathroom-door")).toEqual(["Bathroom", "Landing"]);
    expect(portal("uo-master-door")).toEqual(["Landing", "Master bedroom"]);
    expect(portal("uo-dressing-door")).toEqual([
      "Dressing room",
      "Master bedroom",
    ]);
  });

  it("holds one valid stair on the ground floor and none on top", () => {
    const building = createSampleBuilding();
    const [ground, upper] = building.floors;
    expect(upper.stairs).toHaveLength(0);
    expect(ground.stairs).toHaveLength(1);
    expect(stairValid(building, ground.id, ground.stairs[0])).toBe(true);
  });

  it("keeps upper-floor furniture clear of the stair void", () => {
    const building = createSampleBuilding();
    const [ground, upper] = building.floors;
    const { run } = stairRun(storeyHeightOf(ground));
    const poly = stairPolygon(ground.stairs[0], run);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const voidMin = { x: Math.min(...xs), y: Math.min(...ys) };
    const voidMax = { x: Math.max(...xs), y: Math.max(...ys) };
    for (const item of upper.furniture) {
      if (item.mount) continue;
      const { hx, hy } = halfExtents(item);
      const clear =
        item.position.x + hx <= voidMin.x ||
        item.position.x - hx >= voidMax.x ||
        item.position.y + hy <= voidMin.y ||
        item.position.y - hy >= voidMax.y;
      expect(clear, `${item.id} overlaps the stair void`).toBe(true);
    }
  });

  it("fits every opening inside its host edge", () => {
    for (const floor of createSampleBuilding().floors) {
      const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
      for (const opening of floor.openings) {
        const edge = floor.edges.find((e) => e.id === opening.edgeId);
        expect(edge, opening.id).toBeDefined();
        if (!edge) continue;
        const a = nodeById.get(edge.a);
        const b = nodeById.get(edge.b);
        if (!a || !b) continue;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        expect(opening.offset).toBeGreaterThan(0);
        expect(opening.offset + opening.width).toBeLessThan(length);
      }
    }
  });

  it("lands every furniture item inside a room on both storeys, no overlaps", () => {
    for (const floor of createSampleBuilding().floors) {
      const derived = deriveFloor(floor);
      expect(derived.unassignedFurniture).toHaveLength(0);
      for (const room of derived.rooms) {
        expectFurnitureInside(room);
      }
      expect(overlappingFurnitureIds(floor.furniture).size).toBe(0);
    }
  });

  it("gives every id in the building a unique value", () => {
    const building = createSampleBuilding();
    const ids = building.floors.flatMap((floor) => [
      floor.id,
      ...floor.nodes.map((n) => n.id),
      ...floor.edges.map((e) => e.id),
      ...floor.openings.map((o) => o.id),
      ...floor.furniture.map((f) => f.id),
      ...floor.rooms.map((r) => r.id),
      ...floor.stairs.map((s) => s.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes the ground floor as the single-floor sample", () => {
    const rooms = deriveFloor(createSampleFloor()).rooms;
    expect(rooms.map((r) => r.name)).toContain("Living room");
  });
});
