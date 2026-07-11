import {
  floorArea,
  outlineBounds,
  pointInOutline,
  wallLengths,
} from "./geometry";
import type { Bounds, Floor, Point, Room } from "./types";

/**
 * Pure floor-level helpers. The pure per-room setters (`furniture.ts`,
 * `openings.ts`, `room.ts`, `outline-edit.ts`) keep their Room contract;
 * callers holding a `Floor` address the target room by id through
 * `updateRoomIn`, which extends the setters' no-op guarantee one level up:
 * an update that returns the same Room reference yields the same Floor
 * reference, so no-ops never become history steps or autosave writes.
 *
 * Selection, readouts, and placement are floor-wide (no "active room" mode):
 * "which room" is always derived — from a furniture/opening id for edits, or
 * from a plan point for drops — never stored.
 */

/** The room with this id, or undefined for an unknown id. */
export function roomById(floor: Floor, roomId: string): Room | undefined {
  return floor.rooms.find((room) => room.id === roomId);
}

/** The room owning this furniture item, or undefined for an unknown id. */
export function roomOfFurniture(
  floor: Floor,
  itemId: string,
): Room | undefined {
  return floor.rooms.find((room) =>
    room.furniture.some((item) => item.id === itemId),
  );
}

/** The room owning this opening, or undefined for an unknown id. */
export function roomOfOpening(
  floor: Floor,
  openingId: string,
): Room | undefined {
  return floor.rooms.find((room) =>
    room.openings.some((opening) => opening.id === openingId),
  );
}

/**
 * The room whose outline contains this plan point (boundary-tolerant), or
 * undefined when the point lies in no room. First match wins — rooms sit
 * flush rather than overlapping, so ties only happen on shared walls.
 */
export function roomAtPoint(
  floor: Floor,
  point: Point,
  tolerance = 0,
): Room | undefined {
  return floor.rooms.find((room) =>
    pointInOutline(room.outline, point, tolerance),
  );
}

/** Bounding box of every room outline together, or null with no corners. */
export function floorBounds(floor: Floor): Bounds | null {
  const boxes = floor.rooms
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
export function totalFloorArea(floor: Floor): number {
  return floor.rooms.reduce((sum, room) => sum + floorArea(room.outline), 0);
}

/** Summed wall perimeter of every room, meters. */
export function totalPerimeter(floor: Floor): number {
  return floor.rooms.reduce(
    (sum, room) =>
      room.outline.length >= 3
        ? sum + wallLengths(room.outline).reduce((s, len) => s + len, 0)
        : sum,
    0,
  );
}

/**
 * Apply a per-room update to the room with this id. Unknown ids and updates
 * that return the room unchanged (same reference) return the floor unchanged
 * (same reference).
 */
export function updateRoomIn(
  floor: Floor,
  roomId: string,
  update: (room: Room) => Room,
): Floor {
  const room = roomById(floor, roomId);
  if (!room) return floor;
  const next = update(room);
  if (next === room) return floor;
  return {
    ...floor,
    rooms: floor.rooms.map((entry) => (entry.id === roomId ? next : entry)),
  };
}
