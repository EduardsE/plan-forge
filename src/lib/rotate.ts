import { type Point, wallsOf } from "#/lib/model";
import { SNAP_TOLERANCE } from "#/lib/place";

/**
 * Pure math for the drag-to-rotate handle on a selected footprint: the
 * pointer's angle in rotation space, the detent set (15° steps plus the
 * tangent angles of any nearby non-axis walls), and the snap that picks the
 * nearest detent. Rendering and the drag session live in the rotate-handle
 * component.
 */

/** Detent step while rotate-dragging with snap on, degrees. */
export const ROTATION_DETENT_DEG = 15;
/** Free-angle rotation (modifier held / snap off) rounds to whole degrees. */
const FREE_STEP_DEG = 1;
/** Below this a wall's span on an axis reads as axis-aligned. */
const AXIS_EPSILON = 1e-6;
/** Two wall angles closer than this are one detent. */
const ANGLE_DEDUPE_DEG = 1e-6;

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Shortest angular distance between two angles, degrees in [0, 180]. */
function circularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return Math.min(diff, 360 - diff);
}

/**
 * The rotation (degrees, [0, 360)) at which a footprint's local +x axis
 * points along the world direction `d`. Rotation is CCW about the footprint
 * center with plan y down (`footprintCorners`' convention), so local +x maps
 * to (cos r, -sin r) — inverting that gives atan2(-dy, dx).
 */
export function rotationAngleOf(d: Point): number {
  return normalizeDeg((Math.atan2(-d.y, d.x) * 180) / Math.PI);
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
 * Tangent angles (normalized to [0, 90)) of the outline's non-axis walls
 * within reach of an item rotating in place: walls whose segment passes
 * within the item's half-diagonal (its farthest sweep) plus the shared wall
 * snap tolerance. Axis-aligned walls contribute nothing — their alignments
 * are already in the 15° detents. Computed once at drag start; the center
 * never moves during a rotation.
 */
export function nearbyWallAngles(
  outline: Point[],
  center: Point,
  halfDiagonal: number,
  tolerance = SNAP_TOLERANCE,
): number[] {
  const angles: number[] = [];
  for (const wall of wallsOf(outline)) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    if (Math.abs(dx) < AXIS_EPSILON || Math.abs(dy) < AXIS_EPSILON) continue;
    if (
      distanceToSegment(center, wall.start, wall.end) >
      halfDiagonal + tolerance
    ) {
      continue;
    }
    // Mod 90: a rectangle aligns to the tangent with either local axis, so
    // one base angle stands for all four alignments (expanded in the snap).
    const angle = rotationAngleOf({ x: dx, y: dy }) % 90;
    if (!angles.some((a) => circularDistance(a, angle) < ANGLE_DEDUPE_DEG)) {
      angles.push(angle);
    }
  }
  return angles;
}

/**
 * Snap a raw drag angle to the nearest detent: multiples of 15°, plus each
 * nearby wall angle's four axis alignments (`angle + k·90°`). Ties prefer
 * the wall angle — sitting parallel to the wall is why it joined the set.
 * With `snap` off (free-angle modifier / snap toggle) the angle only rounds
 * to whole degrees. Always returns a normalized [0, 360) angle.
 */
export function snapRotationDeg(
  raw: number,
  wallAngles: number[] = [],
  snap = true,
): number {
  const angle = normalizeDeg(raw);
  if (!snap) {
    return normalizeDeg(Math.round(angle / FREE_STEP_DEG) * FREE_STEP_DEG);
  }
  let best = normalizeDeg(
    Math.round(angle / ROTATION_DETENT_DEG) * ROTATION_DETENT_DEG,
  );
  let bestDistance = circularDistance(angle, best);
  for (const wallAngle of wallAngles) {
    for (let k = 0; k < 4; k++) {
      const candidate = normalizeDeg(wallAngle + k * 90);
      const distance = circularDistance(angle, candidate);
      if (distance <= bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}
