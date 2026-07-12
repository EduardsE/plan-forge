import {
  type Point,
  type Room,
  type Wall,
  wallFrames,
  wallsOf,
} from "#/lib/model";
import { WALL_THICKNESS } from "#/lib/room-scene";

/**
 * Pure geometry for the draw-mode flow (mockup screen 1c): snapping the
 * cursor while placing outline corners, and re-lengthening a drafted wall
 * segment from its inline input. No three.js, no React (same pattern as
 * `plan-scene.ts` / `camera.ts`).
 *
 * All values are meters in plan coordinates (x right, y down). Tolerances
 * are passed in by the caller, which derives them from screen pixels at the
 * current camera zoom so snapping feels the same at any zoom level.
 */

/**
 * Quantization step for un-snapped cursor coordinates. Fine enough (5 cm)
 * that drawing feels free while every label still lands on a clean value;
 * the inline length input is the way to exact dimensions. (The visual grid
 * is 0.5 m — snapping hard to it couldn't produce the mockup's own 6.40 m /
 * 3.20 m walls.)
 */
export const DRAW_GRID_STEP = 0.05;

/** An axis alignment between the cursor and an earlier corner. */
export interface AlignmentSnap {
  cornerIndex: number;
  /** Matched coordinate: "x" draws a vertical guide, "y" a horizontal one. */
  axis: "x" | "y";
}

/** A target wall plus the side its solid extrudes to: the rendered slab
 * spans one `WALL_THICKNESS` along `outward` from the wall line. */
export interface SnapWall extends Wall {
  outward: Point;
}

/**
 * Corners and walls of the floor's *other* rooms, as snap targets while
 * drawing or reshaping — new corners land exactly on them so rooms sit
 * flush (M4's abutment detection needs exact shared coordinates).
 */
export interface SnapTargets {
  corners: Point[];
  walls: SnapWall[];
}

export const NO_SNAP_TARGETS: SnapTargets = { corners: [], walls: [] };

/** A closed outline's walls tagged with their outward normals. */
export function snapWallsOf(outline: Point[]): SnapWall[] {
  const walls = wallsOf(outline);
  return wallFrames(outline).map((frame) => ({
    ...walls[frame.index],
    outward: frame.outward,
  }));
}

export function snapTargetsOf(rooms: Room[]): SnapTargets {
  const corners: Point[] = [];
  const walls: SnapWall[] = [];
  for (const room of rooms) {
    corners.push(...room.outline);
    walls.push(...snapWallsOf(room.outline));
  }
  return { corners, walls };
}

/** How the snapped point locked onto another room, for in-scene feedback. */
export type FloorSnap =
  | { kind: "corner"; at: Point }
  | { kind: "wall"; wall: Wall }
  /** Aligned with a room corner's x or y beyond its walls' spans. */
  | { kind: "align"; at: Point; axis: "x" | "y" };

const AXIS_EPS = 1e-9;

/**
 * Best snap for one free coordinate against the targets: wall *slabs* within
 * the wall's own span, then corner coordinates (alignment past a span). The
 * whole rendered thickness captures — a cursor anywhere on the slab (line to
 * `WALL_THICKNESS` outward, padded by `tolerance` on both sides) snaps to the
 * wall line, so clicking any part of an existing wall means "share this
 * wall" and always yields the flush (gap 0) seam. Slab hits rank above
 * corner alignments; back-to-back twin walls (coincident slabs) tie-break to
 * the nearer wall line.
 */
export function targetAxisCandidate(
  targets: SnapTargets,
  axis: "x" | "y",
  cursor: Point,
  tolerance: number,
): { value: number; distance: number; snap: FloorSnap } | null {
  const cross: "x" | "y" = axis === "x" ? "y" : "x";
  let best: { value: number; distance: number; snap: FloorSnap } | null = null;
  /** Among equal-distance (on-slab) hits, the nearer wall line wins. */
  let bestLineDistance = Number.POSITIVE_INFINITY;
  for (const wall of targets.walls) {
    // Only walls running along the cross axis pin this coordinate.
    if (Math.abs(wall.start[axis] - wall.end[axis]) > AXIS_EPS) continue;
    const lo = Math.min(wall.start[cross], wall.end[cross]) - tolerance;
    const hi = Math.max(wall.start[cross], wall.end[cross]) + tolerance;
    if (cursor[cross] < lo || cursor[cross] > hi) continue;
    const line = wall.start[axis];
    // Signed offset along outward: [0, WALL_THICKNESS] is on the slab.
    const along = (cursor[axis] - line) * (wall.outward[axis] || 1);
    const distance =
      along < 0 ? -along : along > WALL_THICKNESS ? along - WALL_THICKNESS : 0;
    const lineDistance = Math.abs(cursor[axis] - line);
    if (
      distance < tolerance &&
      (!best ||
        distance < best.distance ||
        (distance === best.distance && lineDistance < bestLineDistance))
    ) {
      best = { value: line, distance, snap: { kind: "wall", wall } };
      bestLineDistance = lineDistance;
    }
  }
  for (const corner of targets.corners) {
    const distance = Math.abs(cursor[axis] - corner[axis]);
    if (distance < tolerance && (!best || distance < best.distance)) {
      best = {
        value: corner[axis],
        distance,
        snap: { kind: "align", at: corner, axis },
      };
    }
  }
  return best;
}

/** The nearest target corner within `tolerance` on *both* axes, if any —
 * the strongest snap: the new corner meets the existing room exactly. */
export function nearestTargetCorner(
  corners: Point[],
  cursor: Point,
  tolerance: number,
): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const corner of corners) {
    if (
      Math.abs(cursor.x - corner.x) >= tolerance ||
      Math.abs(cursor.y - corner.y) >= tolerance
    ) {
      continue;
    }
    const d = Math.hypot(cursor.x - corner.x, cursor.y - corner.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = corner;
    }
  }
  return best;
}

export interface DraftSnap {
  point: Point;
  /** True when the preview segment locked horizontal/vertical from the last corner. */
  axisSnapped: boolean;
  /**
   * Turn angle between the previous segment and the preview segment
   * (degrees, 0 = straight on, 90 = right angle). Only reported while
   * axis-snapped with at least two corners placed.
   */
  turnAngleDeg: number | null;
  /** Guide-line alignment with an earlier corner, if any. */
  alignment: AlignmentSnap | null;
  /** Lock onto another room's corner or wall, if any. */
  floorSnap: FloorSnap | null;
}

/**
 * Snap a value to the drawing grid. Re-rounds to sub-millimeter precision:
 * 0.05 isn't exact in binary, so the raw product leaks float junk
 * (4.800000000000001) straight into labels.
 */
export function quantizeToStep(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1e4) / 1e4;
}

const quantize = quantizeToStep;

/**
 * Snap the cursor while placing the next corner. Snaps compose in priority
 * order: first the cursor may land exactly on another room's corner (the
 * flush seam beats everything), else the segment from the last corner locks
 * to an axis (within `tolerance` meters), then the still-free coordinates
 * may pin to another room's wall line or corner coordinate, then align with
 * an earlier draft corner, and whatever remains free quantizes to
 * `DRAW_GRID_STEP`.
 *
 * With `snap` off (the snap toggle), the raw cursor passes straight through —
 * no axis lock, no alignment, no quantize — for free-hand corner placement.
 */
export function snapDraftPoint(
  corners: Point[],
  cursor: Point,
  tolerance: number,
  snap = true,
  targets: SnapTargets = NO_SNAP_TARGETS,
): DraftSnap {
  if (!snap) {
    return {
      point: { x: cursor.x, y: cursor.y },
      axisSnapped: false,
      turnAngleDeg: null,
      alignment: null,
      floorSnap: null,
    };
  }
  let x = cursor.x;
  let y = cursor.y;
  let axisSnapped = false;
  /** Which coordinates are already exact and must not be re-quantized. */
  let xLocked = false;
  let yLocked = false;
  let floorSnap: FloorSnap | null = null;

  const last = corners.at(-1);

  const exactCorner = nearestTargetCorner(targets.corners, cursor, tolerance);
  if (exactCorner) {
    x = exactCorner.x;
    y = exactCorner.y;
    xLocked = true;
    yLocked = true;
    floorSnap = { kind: "corner", at: exactCorner };
    // The badge logic below still applies when the met corner happens to
    // continue the draft at a right angle.
    axisSnapped = last ? x === last.x || y === last.y : false;
  }

  if (!xLocked && !yLocked && last) {
    const dx = Math.abs(x - last.x);
    const dy = Math.abs(y - last.y);
    if (dy <= dx && dy < tolerance) {
      y = last.y;
      axisSnapped = true;
      yLocked = true;
    } else if (dx < tolerance) {
      x = last.x;
      axisSnapped = true;
      xLocked = true;
    }
  }

  // Free coordinates pin to another room's walls/corners before the draft's
  // own alignment pass — flush against the neighbor beats internal guides.
  if (!floorSnap) {
    for (const axis of ["x", "y"] as const) {
      if (axis === "x" ? xLocked : yLocked) continue;
      const candidate = targetAxisCandidate(targets, axis, { x, y }, tolerance);
      if (!candidate) continue;
      if (axis === "x") {
        x = candidate.value;
        xLocked = true;
      } else {
        y = candidate.value;
        yLocked = true;
      }
      if (!floorSnap) floorSnap = candidate.snap;
    }
  }

  // Alignment with earlier corners (the last corner's alignments are the
  // axis snap above). One guide at most: the closest match on a free axis.
  let alignment: AlignmentSnap | null = null;
  let bestDistance = tolerance;
  for (let i = 0; i < corners.length - 1; i++) {
    const corner = corners[i];
    if (!xLocked) {
      const d = Math.abs(x - corner.x);
      if (d < bestDistance) {
        bestDistance = d;
        alignment = { cornerIndex: i, axis: "x" };
      }
    }
    if (!yLocked) {
      const d = Math.abs(y - corner.y);
      if (d < bestDistance) {
        bestDistance = d;
        alignment = { cornerIndex: i, axis: "y" };
      }
    }
  }
  if (alignment) {
    const corner = corners[alignment.cornerIndex];
    if (alignment.axis === "x") {
      x = corner.x;
      xLocked = true;
    } else {
      y = corner.y;
      yLocked = true;
    }
  }

  if (!xLocked) x = quantize(x, DRAW_GRID_STEP);
  if (!yLocked) y = quantize(y, DRAW_GRID_STEP);

  let turnAngleDeg: number | null = null;
  if (axisSnapped && corners.length >= 2 && last) {
    const prev = corners[corners.length - 2];
    const previous = Math.atan2(last.y - prev.y, last.x - prev.x);
    const next = Math.atan2(y - last.y, x - last.x);
    if (x !== last.x || y !== last.y) {
      let delta = Math.abs(next - previous);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      turnAngleDeg = Math.round((delta * 180) / Math.PI);
    }
  }

  return { point: { x, y }, axisSnapped, turnAngleDeg, alignment, floorSnap };
}

/** A rectangle side thinner than this (meters) is degenerate — no room. */
const MIN_RECT_SIDE = 0.01;

/**
 * Snap a free cursor for the rect tool: each coordinate may pin to another
 * room's corner or wall line (within `tolerance`, so the rectangle sits
 * flush), and whatever stays free quantizes to the draw grid (there's no
 * last corner to axis-lock against — the two corners are placed
 * independently). Raw cursor through when `snap` is off.
 */
export function snapRectPoint(
  cursor: Point,
  snap = true,
  targets: SnapTargets = NO_SNAP_TARGETS,
  tolerance = 0,
): Point {
  if (!snap) return { x: cursor.x, y: cursor.y };
  const point = { x: cursor.x, y: cursor.y };
  for (const axis of ["x", "y"] as const) {
    const candidate = targetAxisCandidate(targets, axis, cursor, tolerance);
    point[axis] =
      candidate !== null
        ? candidate.value
        : quantize(cursor[axis], DRAW_GRID_STEP);
  }
  return point;
}

/**
 * The four corners of the axis-aligned rectangle spanning opposite corners
 * `a` and `b`, wound clockwise in plan coords (x right, y down: top-left →
 * top-right → bottom-right → bottom-left) to match the outline convention.
 * Null when either side collapses (the two clicks landed on the same row or
 * column) — the caller ignores such a second click.
 */
export function rectangleOutline(a: Point, b: Point): Point[] | null {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX - minX < MIN_RECT_SIDE || maxY - minY < MIN_RECT_SIDE) return null;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Set the true length of the drafted segment from corner `segmentIndex` to
 * the next corner, keeping its direction. The segment's end corner moves,
 * and every corner placed after it shifts by the same delta so the rest of
 * the draft stays rigid. Returns the input unchanged for invalid indices,
 * non-positive lengths, or a degenerate (zero-length) segment.
 */
export function setSegmentLength(
  corners: Point[],
  segmentIndex: number,
  length: number,
): Point[] {
  if (segmentIndex < 0 || segmentIndex >= corners.length - 1) return corners;
  if (!Number.isFinite(length) || length <= 0) return corners;
  const start = corners[segmentIndex];
  const end = corners[segmentIndex + 1];
  const current = Math.hypot(end.x - start.x, end.y - start.y);
  if (current === 0) return corners;
  const scale = length / current;
  const delta = {
    x: start.x + (end.x - start.x) * scale - end.x,
    y: start.y + (end.y - start.y) * scale - end.y,
  };
  return corners.map((corner, i) =>
    i <= segmentIndex
      ? corner
      : { x: corner.x + delta.x, y: corner.y + delta.y },
  );
}
