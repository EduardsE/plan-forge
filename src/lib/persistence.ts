import type { FurnitureItem, Opening, Point, Room } from "#/lib/model";
import { MAX_WALL_HEIGHT, MIN_WALL_HEIGHT } from "#/lib/model";
import type { Unit } from "#/lib/units";

/**
 * localStorage autosave for the room model. The model is plain JSON already;
 * this module owns the storage payload — serialization, and the paranoid
 * deserialization that keeps a stale or hand-edited save from crashing the
 * scenes (anything malformed hydrates as "no save").
 */

export const STORAGE_KEY = "planforge.room";

/** Bumped whenever the payload shape changes; older saves are discarded. */
const STORAGE_VERSION = 3;

/**
 * Versions this build can still read. v1 predates the optional
 * `FurnitureItem.colorway`, v2 the optional `Room.wallHeight`; both fields
 * are purely additive, so older saves validate unchanged (absent field =
 * default) and load rather than being thrown away — the bumps only mark the
 * newer write shapes.
 */
const READABLE_VERSIONS = new Set([1, 2, STORAGE_VERSION]);

export interface SavedState {
  room: Room;
  /** Display unit the user last picked. */
  unit: Unit;
  /** Epoch ms of the write, so a reload reports "saved 5 min ago" honestly. */
  savedAt: number;
}

export function serializeSavedState(state: SavedState): string {
  return JSON.stringify({ version: STORAGE_VERSION, ...state });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isOpening(value: unknown, wallCount: number): value is Opening {
  if (typeof value !== "object" || value === null) return false;
  const opening = value as Record<string, unknown>;
  return (
    typeof opening.id === "string" &&
    (opening.kind === "door" || opening.kind === "window") &&
    Number.isInteger(opening.wallIndex) &&
    (opening.wallIndex as number) >= 0 &&
    (opening.wallIndex as number) < wallCount &&
    isFiniteNumber(opening.offset) &&
    isFiniteNumber(opening.width) &&
    opening.width > 0 &&
    (opening.hinge === undefined ||
      opening.hinge === "start" ||
      opening.hinge === "end")
  );
}

function isWallMount(value: unknown, wallCount: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const mount = value as Record<string, unknown>;
  return (
    Number.isInteger(mount.wallIndex) &&
    (mount.wallIndex as number) >= 0 &&
    (mount.wallIndex as number) < wallCount &&
    isFiniteNumber(mount.offset) &&
    isFiniteNumber(mount.elevation)
  );
}

function isStack(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const stack = value as Record<string, unknown>;
  return (
    typeof stack.hostId === "string" &&
    isFiniteNumber(stack.dx) &&
    isFiniteNumber(stack.dy)
  );
}

function isFurnitureItem(
  value: unknown,
  wallCount: number,
): value is FurnitureItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const footprint = item.footprint as Record<string, unknown> | null;
  return (
    typeof item.id === "string" &&
    typeof item.catalogId === "string" &&
    isPoint(item.position) &&
    isFiniteNumber(item.rotation) &&
    typeof footprint === "object" &&
    footprint !== null &&
    isFiniteNumber(footprint.width) &&
    footprint.width > 0 &&
    isFiniteNumber(footprint.depth) &&
    footprint.depth > 0 &&
    isFiniteNumber(footprint.height) &&
    footprint.height > 0 &&
    (item.mount === undefined || isWallMount(item.mount, wallCount)) &&
    (item.stack === undefined || (isStack(item.stack) && !item.mount)) &&
    (item.colorway === undefined || typeof item.colorway === "string")
  );
}

/** Every stack anchor must point at a real, floor-standing host — a missing
 * host would render at a stale position forever, and a stacked/mounted one
 * would make the derivation recursive. */
function stacksResolve(furniture: FurnitureItem[]): boolean {
  const byId = new Map(furniture.map((item) => [item.id, item]));
  return furniture.every((item) => {
    if (!item.stack) return true;
    const host = byId.get(item.stack.hostId);
    return (
      host !== undefined && host.id !== item.id && !host.stack && !host.mount
    );
  });
}

function isRoom(value: unknown): value is Room {
  if (typeof value !== "object" || value === null) return false;
  const room = value as Record<string, unknown>;
  if (room.name !== undefined && typeof room.name !== "string") return false;
  // The setter keeps wallHeight inside the clamp range; a hand-edited value
  // outside it fails the whole save, like any other broken invariant.
  if (
    room.wallHeight !== undefined &&
    (!isFiniteNumber(room.wallHeight) ||
      room.wallHeight < MIN_WALL_HEIGHT ||
      room.wallHeight > MAX_WALL_HEIGHT)
  ) {
    return false;
  }
  if (!Array.isArray(room.outline) || !room.outline.every(isPoint)) {
    return false;
  }
  // An empty outline is a legal room (a "new room" awaiting its first draw),
  // and it derives zero walls — so every stored wallIndex must be rejected.
  const wallCount = room.outline.length >= 2 ? room.outline.length : 0;
  return (
    Array.isArray(room.openings) &&
    room.openings.every((opening) => isOpening(opening, wallCount)) &&
    Array.isArray(room.furniture) &&
    room.furniture.every((item) => isFurnitureItem(item, wallCount)) &&
    stacksResolve(room.furniture as FurnitureItem[])
  );
}

/**
 * Parse a raw localStorage payload back into saved state. Returns null —
 * meaning "start fresh" — for missing, unparsable, wrong-version, or
 * structurally invalid saves.
 */
export function deserializeSavedState(json: string | null): SavedState | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const state = parsed as Record<string, unknown>;
  if (
    typeof state.version !== "number" ||
    !READABLE_VERSIONS.has(state.version)
  )
    return null;
  if (state.unit !== "cm" && state.unit !== "m") return null;
  if (!isFiniteNumber(state.savedAt)) return null;
  if (!isRoom(state.room)) return null;
  return { room: state.room, unit: state.unit, savedAt: state.savedAt };
}

/** "saved just now" → "saved 5 min ago" → "saved 3 h ago" → "saved 2 d ago". */
export function formatSavedStatus(savedAt: number, now: number): string {
  const seconds = Math.max(0, (now - savedAt) / 1000);
  if (seconds < 60) return "saved just now";
  if (seconds < 3600) return `saved ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `saved ${Math.floor(seconds / 3600)} h ago`;
  return `saved ${Math.floor(seconds / 86400)} d ago`;
}
