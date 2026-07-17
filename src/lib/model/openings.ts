import { reconcileFloor } from "./derived";
import type { Floor, Opening } from "./types";

/**
 * Pure opening mutations, all **Floor** setters editing `floor.openings`
 * directly in **edge** coordinates — the graph is the single source of truth
 * now that walls are one solid per edge and derived rooms carry no per-wall
 * opening copies. (`addFloorOpening`, `moveFloorOpening`, `resizeFloorOpening`,
 * `flipFloorOpeningHinge`, `flipFloorOpeningSide`, `removeFloorOpening`.) Each
 * is `Floor → Floor`, returns the same reference on a no-op, and ends in
 * `reconcileFloor` so stored state stays normalized.
 */

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

/** The occupied spans of every *other* opening on `edgeId`. */
function otherSpansOnEdge(
  floor: Floor,
  edgeId: string,
  excludeId: string,
): Array<{ start: number; end: number }> {
  return floor.openings
    .filter((o) => o.edgeId === edgeId && o.id !== excludeId)
    .map((o) => ({ start: o.offset, end: o.offset + o.width }));
}

/**
 * Clamp a near-edge `rawOffset` into the free stretch of an edge of `length`,
 * given the spans `occupied` by the other openings on it — the same gap logic
 * `slideOpening` runs, minus the grid quantize (the callers pass an
 * already-snapped offset). The nearest fitting gap wins; null when none fits.
 * This lives here (rather than reusing `lib/opening-place.ts`) so the model
 * stays free of a lib→model cycle.
 */
function slideIntoGap(
  length: number,
  width: number,
  occupied: Array<{ start: number; end: number }>,
  rawOffset: number,
): number | null {
  if (width > length + EPS) return null;
  const blocked = occupied
    .map((s) => ({
      start: Math.max(0, s.start),
      end: Math.min(length, s.end),
    }))
    .filter((s) => s.end - s.start > EPS)
    .sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of blocked) {
    if (span.start - cursor > EPS)
      gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (length - cursor > EPS) gaps.push({ start: cursor, end: length });
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    if (gap.end - gap.start < width - EPS) continue;
    const clamped = Math.min(Math.max(rawOffset, gap.start), gap.end - width);
    const distance = Math.abs(clamped - rawOffset);
    if (distance < bestDistance - EPS) {
      best = clamped;
      bestDistance = distance;
    }
  }
  return best;
}

/** Insert an opening in edge coordinates, slid clear of the edge's other
 * openings (the setter owns the gap logic, not just the UI callers). */
export function addFloorOpening(floor: Floor, opening: Opening): Floor {
  const length = edgeLengthOf(floor, opening.edgeId);
  let placed = opening;
  if (length !== null) {
    const slid = slideIntoGap(
      length,
      opening.width,
      otherSpansOnEdge(floor, opening.edgeId, opening.id),
      opening.offset,
    );
    if (slid !== null && slid !== opening.offset) {
      placed = { ...opening, offset: slid };
    }
  }
  return withOpenings(floor, [...floor.openings, placed]);
}

/** Absolute re-offset along the host edge (already snapped), slid into the
 * nearest free stretch clear of the edge's other openings. Same reference when
 * nothing moves. */
export function moveFloorOpening(
  floor: Floor,
  id: string,
  offset: number,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening) return floor;
  const length = edgeLengthOf(floor, opening.edgeId);
  if (length === null) return floor;
  const slid = slideIntoGap(
    length,
    opening.width,
    otherSpansOnEdge(floor, opening.edgeId, id),
    offset,
  );
  if (slid === null || slid === opening.offset) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) => (o.id === id ? { ...o, offset: slid } : o)),
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
