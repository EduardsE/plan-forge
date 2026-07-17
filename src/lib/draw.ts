import type { Floor, Point, Wall } from "#/lib/model";

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

/** A target wall — a graph edge's centerline segment. A drawn point landing on
 * it snaps to the centerline (welding onto that wall), not offset by a slab. */
export type SnapWall = Wall;

/**
 * Corners and walls of the whole wall graph, as snap targets while drawing or
 * dragging — new corners land exactly on existing nodes/edges so rooms weld
 * onto them at shared coordinates.
 */
export interface SnapTargets {
  corners: Point[];
  walls: SnapWall[];
}

export const NO_SNAP_TARGETS: SnapTargets = { corners: [], walls: [] };

/**
 * Snap targets from the graph floor: every node is a corner, every edge a wall
 * centerline. Replaces the per-room `snapTargetsOf(rooms)` — the graph is one
 * shared space, so there are no "other rooms" to exclude.
 */
export function snapTargetsOfGraph(floor: Floor): SnapTargets {
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const corners: Point[] = floor.nodes.map((n) => ({ x: n.x, y: n.y }));
  const walls: SnapWall[] = [];
  floor.edges.forEach((edge, index) => {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) return;
    walls.push({ index, start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
  });
  return { corners, walls };
}

/** How the snapped point locked onto another room, for in-scene feedback. */
export type FloorSnap =
  | { kind: "wall"; wall: Wall }
  /** Aligned with a room corner's x or y beyond its walls' spans. */
  | { kind: "align"; at: Point; axis: "x" | "y" };

const AXIS_EPS = 1e-9;

/**
 * Best snap for one free coordinate against the targets: a wall *centerline*
 * within the wall's own span, then corner coordinates (alignment past a span).
 * A cursor within `tolerance` of an existing edge's line snaps **onto** that
 * line — the drawn point lands on the wall (welding onto it), the old
 * outer-face push is gone (welding replaces attaching). Wall hits rank above
 * corner alignments; the nearer line wins among candidates.
 */
export function targetAxisCandidate(
  targets: SnapTargets,
  axis: "x" | "y",
  cursor: Point,
  tolerance: number,
): { value: number; distance: number; snap: FloorSnap } | null {
  const cross: "x" | "y" = axis === "x" ? "y" : "x";
  let best: { value: number; distance: number; snap: FloorSnap } | null = null;
  for (const wall of targets.walls) {
    // Only walls running along the cross axis pin this coordinate.
    if (Math.abs(wall.start[axis] - wall.end[axis]) > AXIS_EPS) continue;
    const lo = Math.min(wall.start[cross], wall.end[cross]) - tolerance;
    const hi = Math.max(wall.start[cross], wall.end[cross]) + tolerance;
    if (cursor[cross] < lo || cursor[cross] > hi) continue;
    const line = wall.start[axis];
    const distance = Math.abs(cursor[axis] - line);
    if (distance < tolerance && (!best || distance < best.distance)) {
      best = { value: line, distance, snap: { kind: "wall", wall } };
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
 * order: the segment from the last corner locks to an axis (within
 * `tolerance` meters), then the still-free coordinates pin to an existing
 * wall's centerline or a node's coordinate (landing on it to weld), then
 * align with an earlier chain corner, and whatever remains free quantizes to
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

  if (last) {
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
  // own alignment pass — attaching to the neighbor beats internal guides.
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
