import {
  floorArea,
  outlineBounds,
  pointInOutline,
  wallLengths,
} from "./geometry";
import type { Bounds, Point, Room } from "./types";

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

/** The room owning this opening, or undefined for an unknown id. */
export function roomOfOpening(
  rooms: Room[],
  openingId: string,
): Room | undefined {
  return rooms.find((room) =>
    room.openings.some((opening) => opening.id === openingId),
  );
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
