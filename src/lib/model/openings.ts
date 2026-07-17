import { reconcileFloor } from "./derived";
import type { Floor, Opening, Room, RoomOpening } from "./types";

/**
 * Pure opening mutations. Two families:
 *
 * - The **Room** setters (`addOpening`/`moveOpening`/`flipDoorHinge`/
 *   `removeOpening`) work on a derived room's `RoomOpening[]` — same contract
 *   as `furniture.ts`: a new Room per change, the same reference for no-ops.
 *
 * - The **Floor** setters (`addFloorOpening`, `moveFloorOpening`,
 *   `resizeFloorOpening`, `flipFloorOpeningHinge`, `flipFloorOpeningSide`,
 *   `removeFloorOpening`) edit `floor.openings` directly, in **edge**
 *   coordinates — the graph is the single source of truth now that walls are
 *   one solid per edge. Each is `Floor → Floor`, returns the same reference on
 *   a no-op, and ends in `reconcileFloor` so stored state stays normalized.
 */

/** A wall-click inserting a new door or window. */
export function addOpening(room: Room, opening: RoomOpening): Room {
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

// —— Floor-level (edge-coordinate) setters ——————————————————————————————

const MIN_FLOOR_OPENING_WIDTH = 0.3;
const EPS = 1e-6;

/** Length of the edge an opening sits on, or null when it's gone/degenerate. */
function edgeLengthOf(floor: Floor, edgeId: string): number | null {
  const edge = floor.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const a = floor.nodes.find((n) => n.id === edge.a);
  const b = floor.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length < EPS ? null : length;
}

/** Map `floor.openings`, reconciling only when a real change lands. */
function withOpenings(floor: Floor, openings: Opening[]): Floor {
  return reconcileFloor({ ...floor, openings });
}

/** Insert an opening in edge coordinates. */
export function addFloorOpening(floor: Floor, opening: Opening): Floor {
  return withOpenings(floor, [...floor.openings, opening]);
}

/** Absolute re-offset along the host edge (already snapped), clamped to the
 * edge. Same reference when nothing moves. */
export function moveFloorOpening(
  floor: Floor,
  id: string,
  offset: number,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening) return floor;
  const length = edgeLengthOf(floor, opening.edgeId);
  if (length === null) return floor;
  const clamped = Math.max(0, Math.min(offset, length - opening.width));
  if (clamped === opening.offset) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) => (o.id === id ? { ...o, offset: clamped } : o)),
  );
}

/**
 * Set an opening's width from the chip's field, keeping its center where the
 * edge allows. Clamps into the free stretch around it — the edge minus the
 * other openings on it (both sides). Unknown ids / non-finite widths no-op.
 */
export function resizeFloorOpening(
  floor: Floor,
  id: string,
  width: number,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening || !Number.isFinite(width)) return floor;
  const length = edgeLengthOf(floor, opening.edgeId);
  if (length === null) return floor;
  let gapStart = 0;
  let gapEnd = length;
  for (const other of floor.openings) {
    if (other.id === id || other.edgeId !== opening.edgeId) continue;
    const end = other.offset + other.width;
    if (end <= opening.offset + EPS) gapStart = Math.max(gapStart, end);
    if (other.offset + EPS >= opening.offset + opening.width) {
      gapEnd = Math.min(gapEnd, other.offset);
    }
  }
  const clampedWidth = Math.min(
    Math.max(width, MIN_FLOOR_OPENING_WIDTH),
    gapEnd - gapStart,
  );
  const center = opening.offset + opening.width / 2;
  const offset = Math.min(
    Math.max(center - clampedWidth / 2, gapStart),
    gapEnd - clampedWidth,
  );
  if (clampedWidth === opening.width && offset === opening.offset) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id ? { ...o, offset, width: clampedWidth } : o,
    ),
  );
}

/** Swap a door's hinge edge; windows and unknown ids no-op. */
export function flipFloorOpeningHinge(floor: Floor, id: string): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening || opening.kind !== "door") return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id
        ? { ...o, hinge: (o.hinge ?? "start") === "start" ? "end" : "start" }
        : o,
    ),
  );
}

/** Flip which face a portal opening opens onto (its `side`). */
export function flipFloorOpeningSide(floor: Floor, id: string): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id ? { ...o, side: o.side === 1 ? -1 : 1 } : o,
    ),
  );
}

/** Remove an opening; unknown ids no-op. */
export function removeFloorOpening(floor: Floor, id: string): Floor {
  if (!floor.openings.some((o) => o.id === id)) return floor;
  return withOpenings(
    floor,
    floor.openings.filter((o) => o.id !== id),
  );
}
