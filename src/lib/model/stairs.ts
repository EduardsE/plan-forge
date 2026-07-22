import type { Floor, Stair } from "./types";

/**
 * Pure per-floor stair setters. Stairs live outside the wall graph — no
 * anchors, no faces — so unlike the wall/opening/furniture setters these
 * never call `reconcileFloor`.
 */

/** A stair's footprint width is clamped to this range everywhere in the app
 * (persistence validation and `updateStair`'s clamp share these). */
export const MIN_STAIR_WIDTH = 0.7;
export const MAX_STAIR_WIDTH = 2.0;
export const DEFAULT_STAIR_WIDTH = 0.9;

/**
 * Append a stair. No-op (same reference) if a stair with that id already
 * exists.
 */
export function addStair(floor: Floor, stair: Stair): Floor {
  if (floor.stairs.some((s) => s.id === stair.id)) return floor;
  return { ...floor, stairs: [...floor.stairs, stair] };
}

/**
 * Patch a stair by id, clamping `width` into
 * [MIN_STAIR_WIDTH, MAX_STAIR_WIDTH]. No-op (same reference) on an unknown id
 * or a patch that changes nothing.
 */
export function updateStair(
  floor: Floor,
  stairId: string,
  patch: Partial<Omit<Stair, "id">>,
): Floor {
  const stair = floor.stairs.find((s) => s.id === stairId);
  if (!stair) return floor;
  const merged: Stair = { ...stair, ...patch };
  const width = Math.min(
    Math.max(merged.width, MIN_STAIR_WIDTH),
    MAX_STAIR_WIDTH,
  );
  const next: Stair = { ...merged, width };
  if (
    next.position.x === stair.position.x &&
    next.position.y === stair.position.y &&
    next.rotation === stair.rotation &&
    next.width === stair.width
  ) {
    return floor;
  }
  return {
    ...floor,
    stairs: floor.stairs.map((s) => (s.id === stairId ? next : s)),
  };
}

/** Remove a stair by id. No-op (same reference) on an unknown id. */
export function removeStair(floor: Floor, stairId: string): Floor {
  if (!floor.stairs.some((s) => s.id === stairId)) return floor;
  return { ...floor, stairs: floor.stairs.filter((s) => s.id !== stairId) };
}
