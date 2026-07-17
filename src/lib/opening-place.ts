import { type OpeningKind, type Point, sideOfPoint } from "#/lib/model";
import type { PlacementGuide } from "#/lib/place";
import { PLACEMENT_GRID } from "#/lib/place";
import { wallPoint } from "#/lib/plan-scene";
import type { WallSolid } from "#/lib/room-scene";

/**
 * Pure placement math for the door/window tools: where a click or drag along
 * an edge actually lands an opening, and the distance-to-corner guides drawn
 * while it moves. Offsets are edge-local (meters from the edge's node `a`), so
 * they work for walls at any angle — rendering and pointer projection live in
 * `plan-openings.tsx`.
 */

/** Default leaf/frame widths for a freshly inserted opening, meters. */
export const DOOR_WIDTH = 0.9;
export const WINDOW_WIDTH = 1.2;

export function defaultOpeningWidth(kind: OpeningKind): number {
  return kind === "door" ? DOOR_WIDTH : WINDOW_WIDTH;
}

/** Offsets quantize to the same grid furniture placement uses. */
export const OPENING_GRID = PLACEMENT_GRID;

/** How far inside the interior wall face the corner guides draw, meters. */
export const OPENING_GUIDE_INSET = 0.18;

/** Gaps below this read as flush to the corner — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const EPS = 1e-6;

/** An occupied stretch of a wall (an existing opening), wall-local. */
export interface WallSpan {
  start: number;
  width: number;
}

/**
 * Signed distance of a plan point along the wall's direction — the wall-local
 * offset a pointer position corresponds to.
 */
export function offsetAlongWall(solid: WallSolid, point: Point): number {
  return (
    (point.x - solid.start.x) * solid.dir.x +
    (point.y - solid.start.y) * solid.dir.y
  );
}

/**
 * Where an opening of `width` dragged (or clicked) to `rawOffset` actually
 * lands on a wall of `wallLength`: the offset quantizes to the grid, then
 * clamps into the nearest stretch of wall not already occupied by `others`.
 * Returns null when no free stretch fits the width — the opening can't land
 * on this wall at all.
 */
export function slideOpening(
  wallLength: number,
  width: number,
  others: WallSpan[],
  rawOffset: number,
  grid: number = OPENING_GRID,
): number | null {
  if (width > wallLength + EPS) return null;
  const blocked = others
    .map((span) => ({
      start: Math.max(0, span.start),
      end: Math.min(wallLength, span.start + span.width),
    }))
    .filter((span) => span.end - span.start > EPS)
    .sort((a, b) => a.start - b.start);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of blocked) {
    if (span.start - cursor > EPS)
      gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (wallLength - cursor > EPS) gaps.push({ start: cursor, end: wallLength });

  // A non-positive grid means "no quantize" (snap off): the offset still
  // clamps into a free stretch, it just lands exactly where dragged.
  const quantized = grid > 0 ? Math.round(rawOffset / grid) * grid : rawOffset;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    if (gap.end - gap.start < width - EPS) continue;
    // Clamping may leave the grid at a gap edge — flush beats the grid.
    const clamped = Math.min(Math.max(quantized, gap.start), gap.end - width);
    const distance = Math.abs(clamped - rawOffset);
    if (distance < bestDistance - EPS) {
      best = clamped;
      bestDistance = distance;
    }
  }
  return best;
}

/** Narrowest width the chip's field accepts for a door or window, meters. */
export const MIN_OPENING_WIDTH = 0.3;

/**
 * Where a catalog door/window card dragged to a floor point would insert: the
 * host edge, the edge-local near-edge offset, and which face (`side`) it opens
 * onto. The wall solid rides along so the ghost can render the band without
 * re-finding it.
 */
export interface OpeningPlacement {
  edgeId: string;
  /** Edge-local near-edge offset, snapped/clamped clear of `solid.holes`. */
  offset: number;
  width: number;
  /** The face the opening opens onto (`sideOfPoint` sign). */
  side: 1 | -1;
  solid: WallSolid;
  guides: PlacementGuide[];
}

/** Perpendicular distance from `cursor` to the wall segment, and the clamped
 * projection offset (0..length) along it — `mount-place.ts`'s projection,
 * over a WallSolid. */
function projectToSolid(
  solid: WallSolid,
  cursor: Point,
): { along: number; distance: number } {
  const raw = offsetAlongWall(solid, cursor);
  const along = Math.min(Math.max(raw, 0), solid.length);
  const proj = {
    x: solid.start.x + solid.dir.x * along,
    y: solid.start.y + solid.dir.y * along,
  };
  return { along, distance: Math.hypot(cursor.x - proj.x, cursor.y - proj.y) };
}

/** Which face the cursor lies on for a placed opening: the sole room's side
 * on a one-face wall, else the side the cursor sits on (a portal wall can open
 * either way, a dangling wall opens toward the cursor). */
function placementSide(solid: WallSolid, cursor: Point): 1 | -1 {
  if (solid.faces === 1) return solid.faceSides[0];
  const end = {
    x: solid.start.x + solid.dir.x * solid.length,
    y: solid.start.y + solid.dir.y * solid.length,
  };
  return sideOfPoint(solid.start, end, cursor);
}

/**
 * Where an opening of `width` dragged to `cursor` lands across the floor: the
 * nearest edge with a free stretch for it, the offset centered on the cursor's
 * projection then slid clear of the edge's existing holes (both rooms'). Edges
 * that can't fit the width fall through to the next nearest. Null when none
 * fit. A drag near a shared wall opens onto the room the cursor is nearest.
 */
export function openingAt(
  solids: WallSolid[],
  cursor: Point,
  width: number,
  snap = true,
): OpeningPlacement | null {
  const candidates = solids
    .map((solid) => ({ solid, ...projectToSolid(solid, cursor) }))
    .sort((a, b) => a.distance - b.distance);
  for (const { solid, along } of candidates) {
    const offset = slideOpening(
      solid.length,
      width,
      solid.holes,
      along - width / 2,
      snap ? OPENING_GRID : 0,
    );
    if (offset === null) continue;
    return {
      edgeId: solid.edgeId,
      offset,
      width,
      side: placementSide(solid, cursor),
      solid,
      guides: snap ? openingCornerGuides(solid, offset, width) : [],
    };
  }
  return null;
}

/**
 * The distance-to-corner readouts for an opening at `offset`: one guide from
 * each wall corner to the opening's near edge, drawn `inset` meters inside
 * the room. Flush edges produce no guide. The `axis` field only feeds the
 * guide renderer's orientation-agnostic bits; both guides share the wall's
 * dominant axis.
 */
export function openingCornerGuides(
  solid: WallSolid,
  offset: number,
  width: number,
  inset: number = OPENING_GUIDE_INSET,
): PlacementGuide[] {
  const axis: "x" | "y" =
    Math.abs(solid.dir.x) >= Math.abs(solid.dir.y) ? "x" : "y";
  const guides: PlacementGuide[] = [];
  if (offset > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "near",
      from: wallPoint(solid, 0, -inset),
      to: wallPoint(solid, offset, -inset),
      distance: offset,
    });
  }
  const farGap = solid.length - offset - width;
  if (farGap > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "far",
      from: wallPoint(solid, offset + width, -inset),
      to: wallPoint(solid, solid.length, -inset),
      distance: farGap,
    });
  }
  return guides;
}
