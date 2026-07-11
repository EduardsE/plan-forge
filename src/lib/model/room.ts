import type { Room } from "./types";

/**
 * Pure room-level settings mutations (the Settings popover). Same contract as
 * the furniture setters: a new Room per real change, the same reference for
 * no-ops so callers never push empty history steps.
 */

/** Wall/ceiling height used when a room doesn't set its own (mockup: 2.5 m). */
export const DEFAULT_WALL_HEIGHT = 2.5;
/**
 * Lowest allowed ceiling: the door head (2.05 m) and window head (1.94 m)
 * constants in `room-scene.ts` must stay inside the wall face.
 */
export const MIN_WALL_HEIGHT = 2.2;
/** Highest allowed ceiling — keeps the dollhouse and its camera framing sane. */
export const MAX_WALL_HEIGHT = 6;

/** The room's effective wall/ceiling height, meters. */
export function wallHeightOf(room: Room): number {
  return room.wallHeight ?? DEFAULT_WALL_HEIGHT;
}

/**
 * Rename the room. The name is trimmed; an empty result is invalid input and
 * returns the room unchanged (the field snaps back to the current name).
 */
export function setRoomName(room: Room, name: string): Room {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === room.name) return room;
  return { ...room, name: trimmed };
}

/**
 * Set the room's wall/ceiling height, clamped into
 * [MIN_WALL_HEIGHT, MAX_WALL_HEIGHT]. The default height is stored as an
 * absent field (persisted payloads stay minimal, and "no save" rooms read the
 * same). Wall-mounted furniture re-clamps under the new ceiling so a lowered
 * wall can't leave a mounted body poking out the top; the floor clamp wins
 * for an item taller than the wall.
 */
export function setRoomWallHeight(room: Room, height: number): Room {
  if (!Number.isFinite(height)) return room;
  const clamped = Math.min(Math.max(height, MIN_WALL_HEIGHT), MAX_WALL_HEIGHT);
  if (clamped === wallHeightOf(room)) return room;

  const furniture = room.furniture.map((item) => {
    if (!item.mount) return item;
    const half = item.footprint.height / 2;
    const elevation = Math.max(
      Math.min(item.mount.elevation, clamped - half),
      half,
    );
    if (elevation === item.mount.elevation) return item;
    return { ...item, mount: { ...item.mount, elevation } };
  });

  if (clamped === DEFAULT_WALL_HEIGHT) {
    const { wallHeight: _dropped, ...rest } = room;
    return { ...rest, furniture };
  }
  return { ...room, furniture, wallHeight: clamped };
}
