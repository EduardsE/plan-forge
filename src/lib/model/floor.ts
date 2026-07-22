import {
  floorArea,
  outlineBounds,
  pointInOutline,
  wallLengths,
} from "./geometry";
import type { Bounds, Floor, FurnitureItem, Point, Room } from "./types";

/**
 * Pure floor-level helpers over **derived** rooms. The floor stores a wall
 * graph (`model/types.ts`); scenes and readouts work with the `Room[]` that
 * `deriveFloor` produces, so these lookups take `rooms: Room[]` and resolve
 * "which room" from geometry — a furniture/opening id for edits, a plan point
 * for drops. The write path (edits back onto the graph) lives in
 * `updateDerivedRoom` (`model/derived.ts`), not here.
 *
 * `floorBounds` is the exception: camera framing wants the whole graph, so it
 * reads `floor.nodes` directly (dangling walls included).
 */

/** The room with this id, or undefined for an unknown id. */
export function roomById(rooms: Room[], roomId: string): Room | undefined {
  return rooms.find((room) => room.id === roomId);
}

/** The room owning this furniture item, or undefined for an unknown id. */
export function roomOfFurniture(
  rooms: Room[],
  itemId: string,
): Room | undefined {
  return rooms.find((room) =>
    room.furniture.some((item) => item.id === itemId),
  );
}

/**
 * A synthetic room whose furniture is the *whole floor's*. Furniture edits are
 * floor-level now — a piece may sit in any room, in the dead band at a shared
 * wall, or out on the open canvas, and "which room" is only a derived readout —
 * so the per-room pure setters (`furniture.ts`, `collision.ts`) run against
 * this and `withFloorFurniture` writes the result back onto `floor.furniture`.
 * The synthetic outline is empty; the setters read only `furniture`.
 */
export function furnitureRoom(floor: Floor): Room {
  return {
    id: "__floor__",
    outline: [],
    openings: [],
    furniture: floor.furniture,
  };
}

/** Put an edited furniture array back on the floor, keeping the same floor
 * reference when the array is unchanged (the no-op contract). Furniture is
 * orthogonal to the wall graph, so no `reconcileFloor` is needed. */
export function withFloorFurniture(
  floor: Floor,
  furniture: FurnitureItem[],
): Floor {
  return furniture === floor.furniture ? floor : { ...floor, furniture };
}

/**
 * Run a furniture edit (any per-room setter, expressed over `furnitureRoom`)
 * against the whole floor and write it back. Same floor reference on a no-op.
 */
export function updateFloorFurniture(
  floor: Floor,
  fn: (room: Room) => Room,
): Floor {
  return withFloorFurniture(floor, fn(furnitureRoom(floor)).furniture);
}

/** Every derived furniture item of the floor (assigned to a room *plus* the
 * unassigned — dangling/open-canvas — items), for a floor-wide selection or
 * host lookup. */
export function allFurnitureOf(
  rooms: Room[],
  unassigned: FurnitureItem[],
): FurnitureItem[] {
  return [...rooms.flatMap((room) => room.furniture), ...unassigned];
}

/**
 * The room whose outline contains this plan point (boundary-tolerant), or
 * undefined when the point lies in no room. First match wins — rooms sit
 * flush rather than overlapping, so ties only happen on shared walls.
 */
export function roomAtPoint(
  rooms: Room[],
  point: Point,
  tolerance = 0,
): Room | undefined {
  return rooms.find((room) => pointInOutline(room.outline, point, tolerance));
}

/** Bounding box of every room outline together, or null with no corners. */
export function floorBounds(rooms: Room[]): Bounds | null {
  const boxes = rooms
    .map((room) => outlineBounds(room.outline))
    .filter((bounds): bounds is Bounds => bounds !== null);
  if (boxes.length === 0) return null;
  const min = {
    x: Math.min(...boxes.map((b) => b.min.x)),
    y: Math.min(...boxes.map((b) => b.min.y)),
  };
  const max = {
    x: Math.max(...boxes.map((b) => b.max.x)),
    y: Math.max(...boxes.map((b) => b.max.y)),
  };
  return { min, max, width: max.x - min.x, height: max.y - min.y };
}

/** Bounding box containing both `a` and `b`, or whichever is non-null when
 * the other is null, or null when both are. Used to union camera/pool/shadow
 * framing across every visible storey of a multifloor stack. */
export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  const min = { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) };
  const max = { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) };
  return { min, max, width: max.x - min.x, height: max.y - min.y };
}

/** Summed floor area of every room, m² (degenerate outlines count 0). */
export function totalFloorArea(rooms: Room[]): number {
  return rooms.reduce((sum, room) => sum + floorArea(room.outline), 0);
}

/** Summed wall perimeter of every room, meters. */
export function totalPerimeter(rooms: Room[]): number {
  return rooms.reduce(
    (sum, room) =>
      room.outline.length >= 3
        ? sum + wallLengths(room.outline).reduce((s, len) => s + len, 0)
        : sum,
    0,
  );
}
