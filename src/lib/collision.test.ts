import { describe, expect, it } from "vitest";
import {
  containFurniture,
  containRoomFurniture,
  nudgeFurniture,
  overlappingFurnitureIds,
} from "./collision";
import type { FurnitureItem, Room } from "./model";

/** The sample room's rectangle: 6.40 × 5.20 m, origin top-left. */
const RECT = [
  { x: 0, y: 0 },
  { x: 6.4, y: 0 },
  { x: 6.4, y: 5.2 },
  { x: 0, y: 5.2 },
];

function item(overrides: Partial<FurnitureItem>): FurnitureItem {
  return {
    id: "x",
    catalogId: "desk",
    position: { x: 3, y: 3 },
    rotation: 0,
    footprint: { width: 1, depth: 1, height: 1 },
    ...overrides,
  };
}

describe("containFurniture", () => {
  it("pushes a spun footprint back inside the wall it pokes through", () => {
    // The sample desk (2.2 × 0.85) at y=0.73 rotated 90° stands 2.2 m tall,
    // so its top edge (0.73 − 1.1 = −0.37) pokes past the top wall.
    const desk = item({
      catalogId: "desk",
      position: { x: 4.7, y: 0.73 },
      rotation: 90,
      footprint: { width: 2.2, depth: 0.85, height: 1.12 },
    });
    const contained = containFurniture(RECT, desk);
    // Half the rotated depth (2.2 / 2 = 1.1) clears the top wall.
    expect(contained.position.y).toBeCloseTo(1.1, 10);
    expect(contained.position.x).toBeCloseTo(4.7, 10);
  });

  it("leaves an already-contained item untouched (same reference)", () => {
    const desk = item({ position: { x: 3, y: 3 } });
    expect(containFurniture(RECT, desk)).toBe(desk);
  });

  it("does not quantize a fine position that already fits", () => {
    const desk = item({ position: { x: 3.013, y: 2.997 } });
    expect(containFurniture(RECT, desk)).toBe(desk);
  });

  it("leaves wall-mounted items anchored to their wall", () => {
    const frame = item({
      catalogId: "picture-frame",
      position: { x: 0.03, y: 1.6 },
      rotation: 90,
      footprint: { width: 0.9, depth: 0.06, height: 0.7 },
      mount: { wallIndex: 3, offset: 3.15, elevation: 1.5 },
    });
    expect(containFurniture(RECT, frame)).toBe(frame);
  });
});

describe("containRoomFurniture", () => {
  it("contains only the named item, leaving the rest as-is", () => {
    const inside = item({ id: "a", position: { x: 3, y: 3 } });
    const poking = item({
      id: "b",
      position: { x: 6.5, y: 3 },
      footprint: { width: 1, depth: 1, height: 1 },
    });
    const room: Room = {
      outline: RECT,
      openings: [],
      furniture: [inside, poking],
    };
    const next = containRoomFurniture(room, "b");
    expect(next.furniture[0]).toBe(inside);
    expect(next.furniture[1].position.x).toBeCloseTo(6.4 - 0.5, 10);
  });
});

describe("overlappingFurnitureIds", () => {
  it("flags both items when footprints overlap", () => {
    const a = item({ id: "a", position: { x: 3, y: 3 } });
    const b = item({ id: "b", position: { x: 3.4, y: 3.4 } });
    expect([...overlappingFurnitureIds([a, b])].sort()).toEqual(["a", "b"]);
  });

  it("does not flag flush-adjacent footprints (shared edge only)", () => {
    const a = item({ id: "a", position: { x: 3, y: 3 } });
    // b sits exactly one width to the right — edges touch, no penetration.
    const b = item({ id: "b", position: { x: 4, y: 3 } });
    expect(overlappingFurnitureIds([a, b]).size).toBe(0);
  });

  it("does not flag well-separated footprints", () => {
    const a = item({ id: "a", position: { x: 1, y: 1 } });
    const b = item({ id: "b", position: { x: 5, y: 4 } });
    expect(overlappingFurnitureIds([a, b]).size).toBe(0);
  });

  it("ignores rugs — furniture is meant to sit on them", () => {
    const rug = item({
      id: "rug",
      catalogId: "rug",
      position: { x: 3, y: 3 },
      footprint: { width: 2.8, depth: 2, height: 0.01 },
    });
    const desk = item({ id: "desk", position: { x: 3, y: 3 } });
    expect([...overlappingFurnitureIds([rug, desk])]).toEqual([]);
  });

  it("ignores wall-mounted items hanging above the floor", () => {
    const frame = item({
      id: "frame",
      catalogId: "picture-frame",
      position: { x: 3, y: 3 },
      footprint: { width: 0.9, depth: 0.06, height: 0.7 },
      mount: { wallIndex: 0, offset: 2, elevation: 1.5 },
    });
    const desk = item({ id: "desk", position: { x: 3, y: 3 } });
    expect([...overlappingFurnitureIds([frame, desk])]).toEqual([]);
  });

  it("catches overlap between rotated footprints", () => {
    const a = item({
      id: "a",
      position: { x: 3, y: 3 },
      rotation: 45,
      footprint: { width: 2, depth: 0.5, height: 1 },
    });
    const b = item({
      id: "b",
      position: { x: 3, y: 3.4 },
      rotation: 0,
      footprint: { width: 0.5, depth: 0.5, height: 1 },
    });
    expect(overlappingFurnitureIds([a, b]).size).toBe(2);
  });
});

describe("nudgeFurniture", () => {
  function roomWith(...furniture: FurnitureItem[]): Room {
    return { outline: RECT, openings: [], furniture };
  }

  it("shifts a floor item by the given delta", () => {
    const next = nudgeFurniture(roomWith(item({})), "x", 0.05, -0.05);
    expect(next.furniture[0].position.x).toBeCloseTo(3.05, 10);
    expect(next.furniture[0].position.y).toBeCloseTo(2.95, 10);
  });

  it("clamps a nudge at the wall instead of escaping", () => {
    // Half a metre wide: flush against the right wall at x = 5.9.
    const flush = item({ position: { x: 5.9, y: 3 } });
    const next = nudgeFurniture(roomWith(flush), "x", 0.05, 0);
    expect(next.furniture[0].position.x).toBeCloseTo(5.9, 10);
  });

  it("leaves wall-mounted items unchanged (same reference)", () => {
    const frame = item({
      catalogId: "picture-frame",
      position: { x: 0.03, y: 1.6 },
      rotation: 90,
      footprint: { width: 0.9, depth: 0.06, height: 0.7 },
      mount: { wallIndex: 3, offset: 3.15, elevation: 1.5 },
    });
    const room = roomWith(frame);
    expect(nudgeFurniture(room, "x", 0.05, 0)).toBe(room);
  });

  it("returns the room unchanged for unknown ids", () => {
    const room = roomWith(item({}));
    expect(nudgeFurniture(room, "nope", 0.05, 0)).toBe(room);
  });

  it("keeps a stacked rider anchored on its host's top", () => {
    const host = item({
      id: "table-1",
      catalogId: "dining-table",
      position: { x: 2, y: 3 },
      footprint: { width: 1.6, depth: 0.9, height: 0.75 },
    });
    const rider = item({
      id: "lamp-1",
      catalogId: "table-lamp",
      position: { x: 2.4, y: 3.1 },
      footprint: { width: 0.22, depth: 0.22, height: 0.48 },
      stack: { hostId: "table-1", dx: 0.4, dy: 0.1 },
    });
    const next = nudgeFurniture(roomWith(host, rider), "lamp-1", 0.05, 0);
    expect(next.furniture[1].stack?.dx).toBeCloseTo(0.45, 10);
    expect(next.furniture[1].position.x).toBeCloseTo(2.45, 10);
    // A nudge past the edge clamps to the top instead of unstacking.
    const clamped = nudgeFurniture(roomWith(host, rider), "lamp-1", 5, 0);
    expect(clamped.furniture[1].stack?.dx).toBeCloseTo(0.69, 10);
  });
});

describe("stacked riders", () => {
  const host = item({
    id: "table-1",
    catalogId: "dining-table",
    // Pokes 0.3 m past the left wall: containment slides it to x = 0.8.
    position: { x: 0.5, y: 3 },
    footprint: { width: 1.6, depth: 0.9, height: 0.75 },
  });
  const rider = item({
    id: "lamp-1",
    catalogId: "table-lamp",
    position: { x: 0.9, y: 3.1 },
    footprint: { width: 0.22, depth: 0.22, height: 0.48 },
    stack: { hostId: "table-1", dx: 0.4, dy: 0.1 },
  });

  it("containFurniture passes a rider through untouched", () => {
    const outside = item({
      id: "lamp-1",
      position: { x: -2, y: -2 },
      stack: { hostId: "table-1", dx: 0, dy: 0 },
    });
    expect(containFurniture(RECT, outside)).toBe(outside);
  });

  it("containRoomFurniture carries riders with a slid host", () => {
    const room: Room = {
      outline: RECT,
      openings: [],
      furniture: [host, rider],
    };
    const next = containRoomFurniture(room, "table-1");
    expect(next.furniture[0].position.x).toBeCloseTo(0.8);
    expect(next.furniture[1].position.x).toBeCloseTo(1.2);
    expect(next.furniture[1].position.y).toBeCloseTo(3.1);
  });

  it("overlap warnings exempt riders (they stand above the floor)", () => {
    const ids = overlappingFurnitureIds([host, rider]);
    expect(ids.size).toBe(0);
  });
});
