import {
  deriveMountTransform,
  type EdgeSideHalves,
  edgeSideHalves,
  type Floor,
  type Point,
  sideOfPoint,
  type WallMount,
} from "#/lib/model";
import { slideOpening } from "#/lib/opening-place";
import type { PlacementGuide } from "#/lib/place";
import {
  STUB_WALL_HEIGHT,
  type WallSolid,
  wallStandsFull,
} from "#/lib/room-scene";

/**
 * Pure placement math for wall-mounted items (parallel to `opening-place.ts`
 * for doors/windows): where a cursor over the floor lands a mount on the
 * nearest graph **edge**. Edge-based, so it works at any wall angle and needs
 * no per-room bridge — the single graph is the whole search space. The
 * standing ghost, pointer projection and rendering live in
 * `wall-mount-ghost.tsx` / the move-drag session.
 *
 * Two entry points: `mountAtRay` resolves the 3D pointer ray against the wall
 * faces the user actually sees (cutaway-aware), so aiming at a wall hangs the
 * item on that face; `mountAt` resolves a flat floor point against the nearest
 * edge — the 2D lens's whole story, and the 3D fallback when the ray misses
 * every standing wall.
 */

/** How far inside the interior wall face the corner guides draw, meters. */
const GUIDE_INSET = 0.18;
/** Gaps below this read as flush to the corner — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const EPS = 1e-9;

export interface WallMountResult {
  mount: WallMount;
  /** Derived plan center (flush against the wall). */
  position: Point;
  /** Derived yaw (width axis along the edge). */
  rotation: number;
  /** Distance-to-corner readouts, like an opening's (empty when snap is off). */
  guides: PlacementGuide[];
}

interface EdgeCandidate {
  edgeId: string;
  a: Point;
  b: Point;
  dir: Point;
  length: number;
  /** Clamped projection of the cursor along the edge. */
  along: number;
  /** Perpendicular distance from the cursor to the edge segment. */
  distance: number;
}

/** A point `along` meters from the edge start, `outwardOffset` across it
 * (toward `side`'s left normal). */
function edgePoint(
  candidate: EdgeCandidate,
  side: 1 | -1,
  along: number,
  outwardOffset: number,
): Point {
  const normal = { x: -candidate.dir.y * side, y: candidate.dir.x * side };
  return {
    x: candidate.a.x + candidate.dir.x * along + normal.x * outwardOffset,
    y: candidate.a.y + candidate.dir.y * along + normal.y * outwardOffset,
  };
}

/** The distance-to-corner readouts for a mount at near-edge `offset`, drawn
 * inside the room (toward `side`). */
function cornerGuides(
  candidate: EdgeCandidate,
  side: 1 | -1,
  offset: number,
  width: number,
): PlacementGuide[] {
  const axis: "x" | "y" =
    Math.abs(candidate.dir.x) >= Math.abs(candidate.dir.y) ? "x" : "y";
  const guides: PlacementGuide[] = [];
  if (offset > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "near",
      from: edgePoint(candidate, side, 0, GUIDE_INSET),
      to: edgePoint(candidate, side, offset, GUIDE_INSET),
      distance: offset,
    });
  }
  const farGap = candidate.length - offset - width;
  if (farGap > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "far",
      from: edgePoint(candidate, side, offset + width, GUIDE_INSET),
      to: edgePoint(candidate, side, candidate.length, GUIDE_INSET),
      distance: farGap,
    });
  }
  return guides;
}

/** Near-edge offset clamped to the edge without the snap grid (snap off). */
function clampOffset(
  raw: number,
  edgeLength: number,
  width: number,
): number | null {
  if (width > edgeLength) return null;
  return Math.min(Math.max(raw, 0), edgeLength - width);
}

/** A candidate resolved into a mount on a given face: offset quantized
 * (`snap`) or plain-clamped, transform derived. Null when the edge is too
 * short for the item or its graph geometry is gone. */
function resolveCandidate(
  floor: Floor,
  candidate: EdgeCandidate,
  side: 1 | -1,
  footprint: { width: number; depth: number },
  elevation: number,
  snap: boolean,
  sideHalves: Map<string, EdgeSideHalves>,
): WallMountResult | null {
  const raw = candidate.along - footprint.width / 2;
  const offset = snap
    ? slideOpening(candidate.length, footprint.width, [], raw)
    : clampOffset(raw, candidate.length, footprint.width);
  if (offset === null) return null;
  const mount: WallMount = {
    edgeId: candidate.edgeId,
    offset,
    side,
    elevation,
  };
  const transform = deriveMountTransform(mount, floor, footprint, sideHalves);
  if (!transform) return null;
  const guides = snap
    ? cornerGuides(candidate, side, offset, footprint.width)
    : [];
  return {
    mount,
    position: transform.position,
    rotation: transform.rotation,
    guides,
  };
}

/**
 * Where a wall item dragged to `cursor` (a floor point) mounts on the graph:
 * the nearest edge that fits it, with the near-edge offset quantized (`snap`)
 * or plain-clamped, and the `side` the cursor sits on. Edges too short for
 * the item are skipped, so the mount falls through to the next-nearest
 * fitting edge. Null when no edge fits.
 */
export function mountAt(
  floor: Floor,
  cursor: Point,
  footprint: { width: number; depth: number },
  elevation: number,
  snap = true,
): WallMountResult | null {
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]));
  const candidates: EdgeCandidate[] = [];
  for (const edge of floor.edges) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < EPS) continue;
    const dir = { x: dx / length, y: dy / length };
    const raw = (cursor.x - a.x) * dir.x + (cursor.y - a.y) * dir.y;
    const along = Math.min(Math.max(raw, 0), length);
    const proj = { x: a.x + dir.x * along, y: a.y + dir.y * along };
    const distance = Math.hypot(cursor.x - proj.x, cursor.y - proj.y);
    candidates.push({ edgeId: edge.id, a, b, dir, length, along, distance });
  }
  candidates.sort((x, y) => x.distance - y.distance);

  const sideHalves = edgeSideHalves(floor);
  for (const candidate of candidates) {
    const side = sideOfPoint(candidate.a, candidate.b, cursor);
    const result = resolveCandidate(
      floor,
      candidate,
      side,
      footprint,
      elevation,
      snap,
      sideHalves,
    );
    if (result) return result;
  }
  return null;
}

/** A 3D vector in floor-local space: x/z are plan coordinates (world x/z), y
 * up from this storey's floor. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The pointer ray, floor-local (subtract the storey's elevation from world
 * y before calling). */
export interface MountRay {
  origin: Vec3;
  dir: Vec3;
}

/**
 * Where a wall item aimed along the pointer `ray` mounts: the nearest wall
 * face the ray actually strikes, hung on the side the ray came from. This is
 * what makes 3D placement land on the face under the cursor — projecting the
 * pointer onto the floor plane would land *behind* the aimed wall and flip
 * the mount to its back face.
 *
 * Cutaway-aware via `camera` (floor-local like the ray): a wall the dollhouse
 * currently stubs is only hittable up to the stub height, so aiming over it
 * reaches the standing wall behind — exactly what the user sees. Holes
 * (doorways, windows) let the ray pass through. Walls too short for the item
 * fall through to the next hit. Null when no standing wall face is under the
 * pointer (aiming at open floor, or the 2D lens's straight-down rays) — fall
 * back to `mountAt` with the floor point.
 */
export function mountAtRay(
  floor: Floor,
  solids: WallSolid[],
  ray: MountRay,
  camera: Vec3,
  footprint: { width: number; depth: number },
  elevation: number,
  snap = true,
): WallMountResult | null {
  const hits: Array<{ t: number; solid: WallSolid; along: number }> = [];
  for (const solid of solids) {
    // Vertical plane through the edge centerline (horizontal normal). The
    // wall's thickness is ignored: crossing the centerline within the body's
    // height is close enough for aiming.
    const nx = -solid.dir.y;
    const nz = solid.dir.x;
    const denom = ray.dir.x * nx + ray.dir.z * nz;
    if (Math.abs(denom) < EPS) continue;
    const t =
      ((solid.start.x - ray.origin.x) * nx +
        (solid.start.y - ray.origin.z) * nz) /
      denom;
    if (t <= EPS) continue;
    const up = ray.origin.y + ray.dir.y * t;
    const hx = ray.origin.x + ray.dir.x * t;
    const hz = ray.origin.z + ray.dir.z * t;
    const along =
      (hx - solid.start.x) * solid.dir.x + (hz - solid.start.y) * solid.dir.y;
    if (along < 0 || along > solid.length) continue;
    const height = wallStandsFull(solid, camera)
      ? solid.height
      : STUB_WALL_HEIGHT;
    if (up < 0 || up > height) continue;
    const inHole = solid.holes.some(
      (hole) =>
        along >= hole.start &&
        along <= hole.start + hole.width &&
        up >= hole.bottom &&
        up <= Math.min(hole.top, height),
    );
    if (inHole) continue;
    hits.push({ t, solid, along });
  }
  hits.sort((x, y) => x.t - y.t);

  const sideHalves = edgeSideHalves(floor);
  const originPlan = { x: ray.origin.x, y: ray.origin.z };
  for (const hit of hits) {
    const { solid } = hit;
    const a = solid.start;
    const b = {
      x: solid.start.x + solid.dir.x * solid.length,
      y: solid.start.y + solid.dir.y * solid.length,
    };
    const candidate: EdgeCandidate = {
      edgeId: solid.edgeId,
      a,
      b,
      dir: solid.dir,
      length: solid.length,
      along: hit.along,
      distance: 0,
    };
    // The ray strikes the face it came from: the origin's side of the wall.
    const side = sideOfPoint(a, b, originPlan);
    const result = resolveCandidate(
      floor,
      candidate,
      side,
      footprint,
      elevation,
      snap,
      sideHalves,
    );
    if (result) return result;
  }
  return null;
}
