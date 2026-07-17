import { describe, expect, it } from "vitest";
import { overlappingFurnitureIds } from "#/lib/collision";
import { deriveFloor, portalLabel } from "./derived";
import { floorArea, outlineBounds, wallLength, wallsOf } from "./geometry";
import { createSampleFloor } from "./sample-room";
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

describe("createSampleFloor", () => {
  it("derives two named rooms sitting back-to-back across the shared edge", () => {
    const derived = deriveFloor(createSampleFloor());
    expect(derived.rooms).toHaveLength(2);
    const names = derived.rooms.map((r) => r.name).sort();
    expect(names).toEqual(["Kitchen", "Living room"]);
    // Interior outlines land at the wall centerlines inset by t/2: the living
    // room ends at x ≈ 6.35, the kitchen starts at x ≈ 6.45 (0.1 m apart).
    const living = derived.rooms.find((r) => r.id === "living-room");
    const kitchen = derived.rooms.find((r) => r.id === "kitchen");
    expect(outlineBounds(living?.outline ?? [])?.max.x).toBeCloseTo(6.35, 4);
    expect(outlineBounds(kitchen?.outline ?? [])?.min.x).toBeCloseTo(6.45, 4);
    // Areas come straight from the derived outlines — never hardcoded.
    expect(floorArea(living?.outline ?? [])).toBeCloseTo(6.35 * 5.2, 4);
    expect(floorArea(kitchen?.outline ?? [])).toBeCloseTo(2.95 * 5.2, 4);
  });

  it("connects the two rooms through the door on the shared edge", () => {
    const floor = createSampleFloor();
    const derived = deriveFloor(floor);
    const label = portalLabel(derived.rooms, floor, "door-1");
    expect(label).toBeTruthy();
    expect(label?.split(" ↔ ").sort()).toEqual(["Kitchen", "Living room"]);
    // The windows sit on exterior edges — no portal.
    expect(portalLabel(derived.rooms, floor, "window-1")).toBeNull();
    expect(portalLabel(derived.rooms, floor, "kitchen-window-1")).toBeNull();
  });

  it("lands every furniture item inside a room, no overlaps", () => {
    const floor = createSampleFloor();
    const derived = deriveFloor(floor);
    expect(derived.unassignedFurniture).toHaveLength(0);
    expect(overlappingFurnitureIds(floor.furniture).size).toBe(0);
  });

  it("gives every node, edge, opening and furniture item a unique id", () => {
    const floor = createSampleFloor();
    const ids = [
      ...floor.nodes.map((n) => n.id),
      ...floor.edges.map((e) => e.id),
      ...floor.openings.map((o) => o.id),
      ...floor.furniture.map((f) => f.id),
      ...floor.rooms.map((r) => r.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
