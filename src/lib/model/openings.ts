import { reconcileFloor } from "./derived";
import type { Floor, Opening, OpeningKind } from "./types";

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

/**
 * Default vertical extents, measured from the mockup's 3D scene (walls
 * 250 px = 2.5 m at 100 px/m, window at top:56/height:158 px). An opening
 * stores `sill`/`head` only when it departs from these — `openingVerticals`
 * resolves the effective extent.
 */
export const DOOR_HEIGHT = 2.05;
export const WINDOW_SILL = 0.36;
export const WINDOW_HEAD = 1.94;
/** Shortest vertical extent the setters allow, meters. */
export const MIN_OPENING_HEIGHT = 0.3;

/** Effective vertical extent of an opening's hole, floor-relative meters. */
export function openingVerticals(opening: Opening): {
  bottom: number;
  top: number;
} {
  if (opening.kind === "door") {
    return { bottom: 0, top: opening.head ?? DOOR_HEIGHT };
  }
  return {
    bottom: opening.sill ?? WINDOW_SILL,
    top: opening.head ?? WINDOW_HEAD,
  };
}

/** The vertical extent a freshly inserted opening of `kind` gets. */
export function defaultVerticals(kind: OpeningKind): {
  bottom: number;
  top: number;
} {
  return kind === "door"
    ? { bottom: 0, top: DOOR_HEIGHT }
    : { bottom: WINDOW_SILL, top: WINDOW_HEAD };
}

/** Whether two 1D ranges genuinely overlap (sharing an endpoint doesn't). */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd - EPS && bStart < aEnd - EPS;
}

/**
 * Whether two openings' vertical bands overlap. Openings block each other
 * along the wall only when they do — vertically disjoint bands may share a
 * stretch of wall (two windows stacked, a transom window over a door).
 */
export function verticalsOverlap(
  a: { bottom: number; top: number },
  b: { bottom: number; top: number },
): boolean {
  return rangesOverlap(a.bottom, a.top, b.bottom, b.top);
}

/** Write `bottom`/`top` back onto an opening, storing defaults as absent
 * fields (so an untouched opening keeps its pre-verticals shape). */
function withVerticals(opening: Opening, bottom: number, top: number): Opening {
  const next = { ...opening };
  const defaultSill = opening.kind === "door" ? 0 : WINDOW_SILL;
  const defaultHead = opening.kind === "door" ? DOOR_HEIGHT : WINDOW_HEAD;
  if (opening.kind === "door" || Math.abs(bottom - defaultSill) < EPS) {
    delete next.sill;
  } else {
    next.sill = bottom;
  }
  if (Math.abs(top - defaultHead) < EPS) delete next.head;
  else next.head = top;
  return next;
}

/**
 * The vertical room an opening has on its wall: the floor and ceiling,
 * tightened by any *other* opening sharing a stretch of the same edge —
 * a neighbor below raises the floor to its top, one above lowers the
 * ceiling to its bottom. (Openings on the same span are vertically
 * disjoint by invariant, so every such neighbor is entirely above or
 * entirely below.)
 */
function verticalBounds(
  floor: Floor,
  opening: Opening,
  ceiling: number,
): { floorY: number; ceilingY: number } {
  const current = openingVerticals(opening);
  let floorY = 0;
  let ceilingY = ceiling;
  for (const other of floor.openings) {
    if (other.id === opening.id || other.edgeId !== opening.edgeId) continue;
    if (
      !rangesOverlap(
        opening.offset,
        opening.offset + opening.width,
        other.offset,
        other.offset + other.width,
      )
    ) {
      continue;
    }
    const band = openingVerticals(other);
    if (band.top <= current.bottom + EPS) {
      floorY = Math.max(floorY, band.top);
    } else if (band.bottom >= current.top - EPS) {
      ceilingY = Math.min(ceilingY, band.bottom);
    }
  }
  return { floorY, ceilingY };
}

/**
 * Set an opening's vertical extent from the inspector's fields: the window
 * sill (`bottom`) and/or the hole top (`top`), each clamped to the floor, the
 * `ceiling`, any opening stacked on the same stretch of wall, and a minimum
 * `MIN_OPENING_HEIGHT` extent against the other edge. Doors pin `bottom` to
 * the floor. Non-finite values and unknown ids no-op.
 */
export function setOpeningVerticals(
  floor: Floor,
  id: string,
  verticals: { bottom?: number; top?: number },
  ceiling: number,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening) return floor;
  const current = openingVerticals(opening);
  const { floorY, ceilingY } = verticalBounds(floor, opening, ceiling);
  let bottom = current.bottom;
  let top = current.top;
  if (verticals.top !== undefined && Number.isFinite(verticals.top)) {
    top = Math.min(
      Math.max(verticals.top, bottom + MIN_OPENING_HEIGHT),
      ceilingY,
    );
  }
  if (
    opening.kind === "window" &&
    verticals.bottom !== undefined &&
    Number.isFinite(verticals.bottom)
  ) {
    bottom = Math.min(
      Math.max(verticals.bottom, floorY),
      top - MIN_OPENING_HEIGHT,
    );
  }
  if (
    Math.abs(bottom - current.bottom) < EPS &&
    Math.abs(top - current.top) < EPS
  ) {
    return floor;
  }
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id ? withVerticals(o, bottom, top) : o,
    ),
  );
}

/**
 * Slide a window vertically along its wall, preserving its height: `bottom`
 * quantizes to `grid` (non-positive = no quantize) and clamps into the
 * nearest free vertical stretch of [0, ceiling] — the wall's height minus
 * the bands of other openings sharing this stretch of wall, so a window
 * can ride over or under a stacked neighbor but never through it. Doors sit
 * on the floor — they no-op, as does a window with no free stretch left.
 */
export function shiftOpeningVertical(
  floor: Floor,
  id: string,
  bottom: number,
  ceiling: number,
  grid = 0,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening || opening.kind !== "window" || !Number.isFinite(bottom)) {
    return floor;
  }
  const current = openingVerticals(opening);
  const height = current.top - current.bottom;
  const quantized = grid > 0 ? Math.round(bottom / grid) * grid : bottom;
  const blocked = floor.openings
    .filter(
      (other) =>
        other.id !== id &&
        other.edgeId === opening.edgeId &&
        rangesOverlap(
          opening.offset,
          opening.offset + opening.width,
          other.offset,
          other.offset + other.width,
        ),
    )
    .map((other) => {
      const band = openingVerticals(other);
      return { start: band.bottom, end: band.top };
    });
  const clamped = slideIntoGap(ceiling, height, blocked, quantized);
  if (clamped === null || Math.abs(clamped - current.bottom) < EPS) {
    return floor;
  }
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id ? withVerticals(o, clamped, clamped + height) : o,
    ),
  );
}

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

/** The occupied spans of every *other* opening on `edgeId` whose vertical
 * band overlaps `band` — vertically disjoint openings don't block the slide,
 * which is what lets windows stack. */
function otherSpansOnEdge(
  floor: Floor,
  edgeId: string,
  excludeId: string,
  band: { bottom: number; top: number },
): Array<{ start: number; end: number }> {
  return floor.openings
    .filter(
      (o) =>
        o.edgeId === edgeId &&
        o.id !== excludeId &&
        verticalsOverlap(band, openingVerticals(o)),
    )
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
      otherSpansOnEdge(
        floor,
        opening.edgeId,
        opening.id,
        openingVerticals(opening),
      ),
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
    otherSpansOnEdge(floor, opening.edgeId, id, openingVerticals(opening)),
    offset,
  );
  if (slid === null || slid === opening.offset) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) => (o.id === id ? { ...o, offset: slid } : o)),
  );
}

/** An edge's other opening as a wall-local footprint, for a combined drag. */
export interface OpeningSpan {
  start: number;
  width: number;
  bottom: number;
  top: number;
}

/** Where a combined drag lands a window: the along-edge `offset` (null when no
 * free stretch fits) and the whole-hole `bottom`. */
export interface OpeningDragResult {
  offset: number | null;
  bottom: number;
}

/**
 * Resolve one combined 3D window drag to a target `(offset, bottom)` — the
 * geometry the live preview (`RoomOpenings`) and the commit (`dragOpeningTo`)
 * share so they can never disagree. That disagreement is what used to fling a
 * window aside instead of stacking it: the preview judged the along-slide
 * against a raw bottom sitting a grid-step *inside* the neighbor below, so the
 * bands overlapped and the window shoved sideways, while a naive quantize could
 * never land the bottom on a neighbor's off-grid top (no 0 gap ever).
 *
 * Both axes resolve against the *target* column, not the window's current spot:
 *
 *  1. The bottom snaps flush into the free vertical stretch left by the
 *     neighbors sharing the target column (one below raises the floor, one
 *     above lowers the ceiling) — dragging onto another window's column lands
 *     exactly on its top, grid or no grid ("flush beats grid", per
 *     `slideIntoGap`).
 *  2. The offset then slides clear only of neighbors whose band still overlaps
 *     that snapped band — which, after the flush snap, excludes the very
 *     neighbor being stacked on, so the window keeps the column.
 *
 * `others` are the edge's *other* openings; a door pins `bottom` to 0.
 */
export function resolveOpeningDrag(
  wallLength: number,
  wallHeight: number,
  isWindow: boolean,
  width: number,
  height: number,
  currentBottom: number,
  others: OpeningSpan[],
  targetOffset: number,
  targetBottom: number,
  grid: number,
): OpeningDragResult {
  let bottom = 0;
  if (isWindow) {
    const column = others
      .filter((o) =>
        rangesOverlap(
          targetOffset,
          targetOffset + width,
          o.start,
          o.start + o.width,
        ),
      )
      .map((o) => ({ start: o.bottom, end: o.top }));
    const quantized =
      grid > 0 ? Math.round(targetBottom / grid) * grid : targetBottom;
    bottom =
      slideIntoGap(wallHeight, height, column, quantized) ?? currentBottom;
  }
  const top = bottom + height;
  const row = others
    .filter((o) => rangesOverlap(bottom, top, o.bottom, o.top))
    .map((o) => ({ start: o.start, end: o.start + o.width }));
  const quantized =
    grid > 0 ? Math.round(targetOffset / grid) * grid : targetOffset;
  return { offset: slideIntoGap(wallLength, width, row, quantized), bottom };
}

/**
 * Commit a combined 3D opening drag: slide `id` toward the raw, pre-snap
 * `(targetOffset, targetBottom)` via `resolveOpeningDrag`. Doors stay
 * floor-pinned (their `targetBottom` is ignored). Same reference on a no-op.
 */
export function dragOpeningTo(
  floor: Floor,
  id: string,
  targetOffset: number,
  targetBottom: number,
  ceiling: number,
  grid = 0,
): Floor {
  const opening = floor.openings.find((o) => o.id === id);
  if (!opening) return floor;
  const length = edgeLengthOf(floor, opening.edgeId);
  if (length === null) return floor;
  const current = openingVerticals(opening);
  const height = current.top - current.bottom;
  const others: OpeningSpan[] = floor.openings
    .filter((o) => o.id !== id && o.edgeId === opening.edgeId)
    .map((o) => {
      const band = openingVerticals(o);
      return {
        start: o.offset,
        width: o.width,
        bottom: band.bottom,
        top: band.top,
      };
    });
  const { offset, bottom } = resolveOpeningDrag(
    length,
    ceiling,
    opening.kind === "window",
    opening.width,
    height,
    current.bottom,
    others,
    targetOffset,
    targetBottom,
    grid,
  );
  if (offset === null) return floor;
  const offsetMoved = Math.abs(offset - opening.offset) > EPS;
  const bottomMoved =
    opening.kind === "window" && Math.abs(bottom - current.bottom) > EPS;
  if (!offsetMoved && !bottomMoved) return floor;
  return withOpenings(
    floor,
    floor.openings.map((o) =>
      o.id === id
        ? withVerticals({ ...o, offset }, bottom, bottom + height)
        : o,
    ),
  );
}

/**
 * Set an opening's width from the chip's field, keeping its center where the
 * edge allows. Clamps into the free stretch around it — the edge minus the
 * other openings on it (both sides) whose vertical band overlaps this one's
 * (a stacked window doesn't cap the one under it). Unknown ids / non-finite
 * widths no-op.
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
  const band = openingVerticals(opening);
  let gapStart = 0;
  let gapEnd = length;
  for (const other of floor.openings) {
    if (other.id === id || other.edgeId !== opening.edgeId) continue;
    if (!verticalsOverlap(band, openingVerticals(other))) continue;
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
