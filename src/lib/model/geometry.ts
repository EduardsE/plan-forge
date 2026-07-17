import type { Bounds, Point, Wall } from "./types";

/**
 * Wall thickness (meters): walls extrude this far, and a room's interior
 * outline is the graph face inset by half of it. Defined here in the pure
 * model layer (rather than `room-scene.ts`) so model code — `deriveFloor`,
 * mounts — can read it without importing the render layer (which imports the
 * model, closing a load-time cycle). `room-scene.ts` re-exports it.
 */
export const WALL_THICKNESS = 0.1;

/**
 * Derive the wall segments of a closed outline. Each corner starts one wall;
 * the last wall closes the loop back to the first corner. Outlines with
 * fewer than 2 corners have no walls.
 */
export function wallsOf(outline: Point[]): Wall[] {
  if (outline.length < 2) return [];
  return outline.map((start, index) => ({
    index,
    start,
    end: outline[(index + 1) % outline.length],
  }));
}

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

/** Length of every wall of the outline, in wall order. */
export function wallLengths(outline: Point[]): number[] {
  return wallsOf(outline).map(wallLength);
}

/**
 * Area enclosed by the outline (shoelace formula). Winding-independent;
 * returns 0 for degenerate outlines (fewer than 3 corners).
 */
export function floorArea(outline: Point[]): number {
  if (outline.length < 3) return 0;
  let twiceSigned = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    twiceSigned += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceSigned) / 2;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq),
        );
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/**
 * Whether a point lies inside the closed outline. Points within `tolerance`
 * of the boundary count as inside — furniture flush against a wall sits
 * exactly on it, where a bare even-odd raycast is unstable.
 */
export function pointInOutline(
  outline: Point[],
  point: Point,
  tolerance = 0,
): boolean {
  if (outline.length < 3) return false;
  if (tolerance > 0) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (distanceToSegment(point, a, b) <= tolerance) return true;
    }
  }
  // Even-odd raycast along +x.
  let inside = false;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a.y > point.y !== b.y > point.y) {
      const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < crossX) inside = !inside;
    }
  }
  return inside;
}

/** Axis-aligned bounding box of the outline, or null when it has no corners. */
export function outlineBounds(outline: Point[]): Bounds | null {
  if (outline.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of outline) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width: maxX - minX,
    height: maxY - minY,
  };
}
