import type { Floor, Room } from "./types";

/**
 * Pure floor-level helpers. The pure per-room setters (`furniture.ts`,
 * `openings.ts`, `room.ts`, `outline-edit.ts`) keep their Room contract;
 * callers holding a `Floor` address the target room by id through
 * `updateRoomIn`, which extends the setters' no-op guarantee one level up:
 * an update that returns the same Room reference yields the same Floor
 * reference, so no-ops never become history steps or autosave writes.
 */

/** The room with this id, or undefined for an unknown id. */
export function roomById(floor: Floor, roomId: string): Room | undefined {
  return floor.rooms.find((room) => room.id === roomId);
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
