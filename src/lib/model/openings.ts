import type { Opening, Room } from "./types";

/**
 * Pure opening mutations for the door/window placement tools. Same contract
 * as `furniture.ts`: every function returns a new Room (and new openings
 * array), and unknown ids return the room unchanged.
 */

/** A wall-click inserting a new door or window. */
export function addOpening(room: Room, opening: Opening): Room {
  return { ...room, openings: [...room.openings, opening] };
}

/** Absolute re-offset along the host wall, from a drag (already snapped). */
export function moveOpening(room: Room, id: string, offset: number): Room {
  return {
    ...room,
    openings: room.openings.map((opening) =>
      opening.id === id ? { ...opening, offset } : opening,
    ),
  };
}

/** Swap a door's hinge to the opposite edge; windows are left unchanged. */
export function flipDoorHinge(room: Room, id: string): Room {
  return {
    ...room,
    openings: room.openings.map((opening) =>
      opening.id === id && opening.kind === "door"
        ? {
            ...opening,
            hinge: (opening.hinge ?? "start") === "start" ? "end" : "start",
          }
        : opening,
    ),
  };
}

export function removeOpening(room: Room, id: string): Room {
  return {
    ...room,
    openings: room.openings.filter((opening) => opening.id !== id),
  };
}
