import type { Building, Floor, Point, Stair } from "#/lib/model";
import { floorIndexOf, footprintCorners, storeyHeightOf } from "#/lib/model";
import type { Obstacle } from "#/lib/place";
import { edgeWallObstacles } from "#/lib/place";

/**
 * Pure stair geometry: run derivation, footprint polygon, climb direction,
 * the voids stairs cut into the floor above, and cross-floor placement
 * validity. Nothing here stores state — a `Stair` is just an id, a position,
 * a rotation, and a width; everything else (risers, run length, the void it
 * cuts) is derived from it plus the storey it climbs from.
 */

// Bounds live in `model/stairs.ts` (shared with persistence validation and
// `updateStair`'s clamp); re-exported here so this module's public surface
// matches the geometry-and-setters split.
export {
  DEFAULT_STAIR_WIDTH,
  MAX_STAIR_WIDTH,
  MIN_STAIR_WIDTH,
} from "#/lib/model/stairs";

/** Maximum riser height, meters — governs how many risers a storey needs. */
export const MAX_RISER = 0.19;
/** Depth of one tread, meters — the run's per-riser horizontal length. */
export const TREAD_DEPTH = 0.25;

/** Shrink obstacles inward by this much before the SAT test so a stair flush
 * against a wall (touching, not overlapping) still validates. */
const CONTACT_EPS = 0.001;

/**
 * Risers and total horizontal run for a stair climbing `storeyHeight`
 * (ceiling + slab, see `storeyHeightOf`). Risers step up in whole numbers
 * capped at `MAX_RISER`; run is riser count × `TREAD_DEPTH`. Floored at 3
 * risers so a near-zero storey height still yields a stair-shaped run.
 */
export function stairRun(storeyHeight: number): {
  risers: number;
  run: number;
} {
  const risers = Math.max(3, Math.ceil(storeyHeight / MAX_RISER));
  return { risers, run: risers * TREAD_DEPTH };
}

/**
 * The stair's footprint corners in plan coordinates: width across the local
 * x axis, `run` along the local y (climb) axis, rotated like any other
 * footprint (`footprintCorners`'s convention — local +x → `(cos r, -sin r)`).
 */
export function stairPolygon(stair: Stair, run: number): Point[] {
  return footprintCorners({
    id: stair.id,
    catalogId: "stairs",
    position: stair.position,
    rotation: stair.rotation,
    footprint: { width: stair.width, depth: run, height: 0 },
  });
}

/**
 * Unit vector a stair climbs toward: the footprint's local +y (depth) axis
 * rotated into plan coordinates. Rotation 0 → `{ x: 0, y: 1 }` (+y, matching
 * `stairPolygon`'s run axis); rotation 90 → `{ x: 1, y: 0 }` (CCW in the
 * y-down plan plane).
 */
export function stairClimbDir(rotation: number): Point {
  const r = (rotation * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** The four corners of an obstacle's true rectangle: the oriented slab's
 * angled corners when present, else the axis-aligned box's corners. */
function obstacleCorners(ob: Obstacle): Point[] {
  if (ob.oriented) {
    const { p0, t, n, length, half } = ob.oriented;
    const p1 = { x: p0.x + t.x * length, y: p0.y + t.y * length };
    return [
      { x: p0.x + n.x * half, y: p0.y + n.y * half },
      { x: p0.x - n.x * half, y: p0.y - n.y * half },
      { x: p1.x + n.x * half, y: p1.y + n.y * half },
      { x: p1.x - n.x * half, y: p1.y - n.y * half },
    ];
  }
  return [
    { x: ob.min.x, y: ob.min.y },
    { x: ob.max.x, y: ob.min.y },
    { x: ob.max.x, y: ob.max.y },
    { x: ob.min.x, y: ob.max.y },
  ];
}

/** Min/max projection of `points` onto unit `axis`. */
function project(points: Point[], axis: Point): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * Separating-axis test between the stair polygon and one obstacle: the
 * candidate axes are world x, world y, and — for an oriented (angled) wall
 * slab — its own tangent/normal. The obstacle is shrunk inward by
 * `CONTACT_EPS` on every axis first, so a stair sitting flush against a wall
 * (touching, not overlapping) reads as clear rather than colliding.
 */
export function polygonIntersectsObstacle(
  poly: Point[],
  ob: Obstacle,
): boolean {
  const corners = obstacleCorners(ob);
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  if (ob.oriented) axes.push(ob.oriented.t, ob.oriented.n);
  for (const axis of axes) {
    const [polyMin, polyMax] = project(poly, axis);
    const [rawMin, rawMax] = project(corners, axis);
    const eps = Math.min(CONTACT_EPS, (rawMax - rawMin) / 2);
    const obMin = rawMin + eps;
    const obMax = rawMax - eps;
    if (polyMax <= obMin || polyMin >= obMax) return false;
  }
  return true;
}

/**
 * The void obstacle each stair on `floor` cuts into the floor **above** it —
 * an AABB sized to the run (from `storeyHeight`, the climbing floor's own
 * storey height), plus an `oriented` slab when the stair sits off-axis so
 * `snapPlacement`'s angled path still sees it.
 */
export function stairVoidObstacles(
  floor: Floor,
  storeyHeight: number,
): Obstacle[] {
  const { run } = stairRun(storeyHeight);
  return floor.stairs.map((stair) => {
    const poly = stairPolygon(stair, run);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const obstacle: Obstacle = {
      min: { x: Math.min(...xs), y: Math.min(...ys) },
      max: { x: Math.max(...xs), y: Math.max(...ys) },
    };
    if (stair.rotation % 90 !== 0) {
      const dir = stairClimbDir(stair.rotation);
      const half = run / 2;
      obstacle.oriented = {
        id: `stair-${stair.id}`,
        p0: {
          x: stair.position.x - dir.x * half,
          y: stair.position.y - dir.y * half,
        },
        t: dir,
        n: { x: -dir.y, y: dir.x },
        length: run,
        half: stair.width / 2,
      };
    }
    return obstacle;
  });
}

/**
 * Whether `stair` can live on `floorId`: the floor must not be the top of the
 * stack (a stair needs a floor above to cut into), and its run polygon must
 * clear the wall slabs of both its own floor and the floor above.
 */
export function stairValid(
  building: Building,
  floorId: string,
  stair: Stair,
): boolean {
  const index = floorIndexOf(building, floorId);
  if (index === -1 || index === building.floors.length - 1) return false;
  const floor = building.floors[index];
  const above = building.floors[index + 1];
  const { run } = stairRun(storeyHeightOf(floor));
  const poly = stairPolygon(stair, run);
  const obstacles = [...edgeWallObstacles(floor), ...edgeWallObstacles(above)];
  return !obstacles.some((ob) => polygonIntersectsObstacle(poly, ob));
}
