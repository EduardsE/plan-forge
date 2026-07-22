import { describe, expect, it } from "vitest";
import {
  containFurniture,
  containRoomFurniture,
  nudgeFurniture,
  overlappingFurnitureIds,
} from "./collision";
import type { Floor, FurnitureItem, Opening, Room } from "./model";
import { edgeWallObstacles } from "./place";

/**
 * A rectangular graph floor (6.40 × 5.20 m). Walls are centred on the outline,
 * so `edgeWallObstacles` yields four 0.1 m slabs straddling x=0, x=6.4, y=0,
 * y=5.2 — the interior clear space is (0.05..6.35) × (0.05..5.15).
 */
function rectFloor(openings: Opening[] = []): Floor {
  return {
    id: "fixture",
    nodes: [
      { id: "n0", x: 0, y: 0 },
      { id: "n1", x: 6.4, y: 0 },
      { id: "n2", x: 6.4, y: 5.2 },
      { id: "n3", x: 0, y: 5.2 },
    ],
    edges: [
      { id: "e-top", a: "n0", b: "n1" },
      { id: "e-right", a: "n1", b: "n2" },
      { id: "e-bottom", a: "n2", b: "n3" },
      { id: "e-left", a: "n3", b: "n0" },
    ],
    openings,
    furniture: [],
    rooms: [],
    stairs: [],
  };
}

/** The four wall slabs of `rectFloor` (no openings). */
const WALLS = edgeWallObstacles(rectFloor());

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
  it("pushes a spun footprint out of the wall slab it pokes through", () => {
    // The sample desk (2.2 × 0.85) at y=0.73 rotated 90° stands 2.2 m tall,
    // so its top edge (0.73 − 1.1 = −0.37) pokes into the top wall slab.
    const desk = item({
      catalogId: "desk",
      position: { x: 4.7, y: 0.73 },
      rotation: 90,
      footprint: { width: 2.2, depth: 0.85, height: 1.12 },
    });
    const contained = containFurniture(WALLS, desk);
    // Half the rotated depth (1.1) plus the slab's inner face (0.05) clears it.
    expect(contained.position.y).toBeCloseTo(1.15, 10);
    expect(contained.position.x).toBeCloseTo(4.7, 10);
  });

  it("leaves an item clear of every wall untouched (same reference)", () => {
    const desk = item({ position: { x: 3, y: 3 } });
    expect(containFurniture(WALLS, desk)).toBe(desk);
  });

  it("does not quantize a fine position that already fits", () => {
    const desk = item({ position: { x: 3.013, y: 2.997 } });
    expect(containFurniture(WALLS, desk)).toBe(desk);
  });

  it("leaves wall-mounted items anchored to their wall", () => {
    const frame = item({
      catalogId: "picture-frame",
      position: { x: 0.03, y: 1.6 },
      rotation: 90,
      footprint: { width: 0.9, depth: 0.06, height: 0.7 },
      mount: { edgeId: "e", offset: 3.15, side: 1, elevation: 1.5 },
    });
    expect(containFurniture(WALLS, frame)).toBe(frame);
  });

  it("passes a door gap — a piece may sit in the doorway (no slab there)", () => {
    // A door on the right wall (offset 2.0, width 0.9) leaves no slab at
    // y=2.45, so a small item straddling the wall line there stays put.
    const doorWalls = edgeWallObstacles(
      rectFloor([
        {
          id: "d",
          kind: "door",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    const piece = item({
      position: { x: 6.15, y: 2.45 },
      footprint: { width: 0.4, depth: 0.4, height: 1 },
    });
    expect(containFurniture(doorWalls, piece)).toBe(piece);
  });

  it("a window keeps its slab — the same piece is pushed off it", () => {
    const windowWalls = edgeWallObstacles(
      rectFloor([
        {
          id: "w",
          kind: "window",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    const piece = item({
      position: { x: 6.2, y: 2.45 },
      footprint: { width: 0.4, depth: 0.4, height: 1 },
    });
    // Slab inner face 6.35 − half width 0.2 → flush inside at 6.15.
    expect(containFurniture(windowWalls, piece).position.x).toBeCloseTo(
      6.15,
      10,
    );
  });
});

describe("containRoomFurniture", () => {
  it("contains only the named item, leaving the rest as-is", () => {
    const inside = item({ id: "a", position: { x: 3, y: 3 } });
    // Mostly outside the right wall → pushed clear to the exterior face.
    const poking = item({
      id: "b",
      position: { x: 6.5, y: 3 },
      footprint: { width: 1, depth: 1, height: 1 },
    });
    const room: Room = {
      id: "room-1",
      outline: [],
      openings: [],
      furniture: [inside, poking],
    };
    const next = containRoomFurniture(WALLS, room, "b");
    expect(next.furniture[0]).toBe(inside);
    // Outer slab face 6.45 + half width 0.5 → 6.95.
    expect(next.furniture[1].position.x).toBeCloseTo(6.95, 10);
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
      mount: { edgeId: "e", offset: 2, side: 1, elevation: 1.5 },
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
    return { id: "room-1", outline: [], openings: [], furniture };
  }

  it("shifts a floor item clear of every wall by the given delta", () => {
    const next = nudgeFurniture(WALLS, roomWith(item({})), "x", 0.05, -0.05);
    expect(next.furniture[0].position.x).toBeCloseTo(3.05, 10);
    expect(next.furniture[0].position.y).toBeCloseTo(2.95, 10);
  });

  it("pushes up to the wall from inside and stops", () => {
    // Half a metre wide, flush against the right slab's inner face (6.35).
    const flush = item({ position: { x: 5.85, y: 3 } });
    const next = nudgeFurniture(WALLS, roomWith(flush), "x", 0.05, 0);
    expect(next.furniture[0].position.x).toBeCloseTo(5.85, 10);
  });

  it("pushes up to the wall from the open canvas and stops", () => {
    // Flush against the right slab's outer face (6.45) from outside the room.
    const flush = item({ position: { x: 6.95, y: 3 } });
    const next = nudgeFurniture(WALLS, roomWith(flush), "x", -0.05, 0);
    expect(next.furniture[0].position.x).toBeCloseTo(6.95, 10);
  });

  it("passes a doorway gap the same nudge a window would block", () => {
    const piece = item({
      position: { x: 6.15, y: 2.45 },
      footprint: { width: 0.4, depth: 0.4, height: 1 },
    });
    const doorWalls = edgeWallObstacles(
      rectFloor([
        {
          id: "d",
          kind: "door",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    // Through the door gap: the nudge lands where aimed (no slab there).
    expect(
      nudgeFurniture(doorWalls, roomWith(piece), "x", 0.05, 0).furniture[0]
        .position.x,
    ).toBeCloseTo(6.2, 10);
    const windowWalls = edgeWallObstacles(
      rectFloor([
        {
          id: "w",
          kind: "window",
          edgeId: "e-right",
          offset: 2.0,
          width: 0.9,
          side: 1,
        },
      ]),
    );
    // The window keeps its slab: the same nudge is pushed back to flush.
    expect(
      nudgeFurniture(windowWalls, roomWith(piece), "x", 0.05, 0).furniture[0]
        .position.x,
    ).toBeCloseTo(6.15, 10);
  });

  it("leaves wall-mounted items unchanged (same reference)", () => {
    const frame = item({
      catalogId: "picture-frame",
      position: { x: 0.03, y: 1.6 },
      rotation: 90,
      footprint: { width: 0.9, depth: 0.06, height: 0.7 },
      mount: { edgeId: "e", offset: 3.15, side: 1, elevation: 1.5 },
    });
    const room = roomWith(frame);
    expect(nudgeFurniture(WALLS, room, "x", 0.05, 0)).toBe(room);
  });

  it("returns the room unchanged for unknown ids", () => {
    const room = roomWith(item({}));
    expect(nudgeFurniture(WALLS, room, "nope", 0.05, 0)).toBe(room);
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
    const next = nudgeFurniture(
      WALLS,
      roomWith(host, rider),
      "lamp-1",
      0.05,
      0,
    );
    expect(next.furniture[1].stack?.dx).toBeCloseTo(0.45, 10);
    expect(next.furniture[1].position.x).toBeCloseTo(2.45, 10);
    // A nudge past the edge clamps to the top instead of unstacking.
    const clamped = nudgeFurniture(
      WALLS,
      roomWith(host, rider),
      "lamp-1",
      5,
      0,
    );
    expect(clamped.furniture[1].stack?.dx).toBeCloseTo(0.69, 10);
  });
});

describe("stacked riders", () => {
  const host = item({
    id: "table-1",
    catalogId: "dining-table",
    // Pokes past the left wall slab: containment pushes it to x = 0.85.
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
    expect(containFurniture(WALLS, outside)).toBe(outside);
  });

  it("containRoomFurniture carries riders with a pushed host", () => {
    const room: Room = {
      id: "room-1",
      outline: [],
      openings: [],
      furniture: [host, rider],
    };
    const next = containRoomFurniture(WALLS, room, "table-1");
    // Left slab inner face 0.05 + half width 0.8 → 0.85 (moved +0.35).
    expect(next.furniture[0].position.x).toBeCloseTo(0.85);
    expect(next.furniture[1].position.x).toBeCloseTo(1.25);
    expect(next.furniture[1].position.y).toBeCloseTo(3.1);
  });

  it("overlap warnings exempt riders (they stand above the floor)", () => {
    const ids = overlappingFurnitureIds([host, rider]);
    expect(ids.size).toBe(0);
  });
});
