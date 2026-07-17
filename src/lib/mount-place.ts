import {
  deriveMountTransform,
  type Floor,
  type Point,
  sideOfPoint,
  type WallMount,
  type WallNode,
} from "#/lib/model";
import { slideOpening } from "#/lib/opening-place";
import type { PlacementGuide } from "#/lib/place";

/**
 * Pure placement math for wall-mounted items (parallel to `opening-place.ts`
 * for doors/windows): where a cursor over the floor lands a mount on the
 * nearest graph **edge**. Edge-based, so it works at any wall angle and needs
 * no per-room bridge — the single graph is the whole search space. The
 * standing ghost, pointer projection and rendering live in
 * `wall-mount-ghost.tsx` / the move-drag session.
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
  a: WallNode;
  b: WallNode;
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

  for (const candidate of candidates) {
    const raw = candidate.along - footprint.width / 2;
    const offset = snap
      ? slideOpening(candidate.length, footprint.width, [], raw)
      : clampOffset(raw, candidate.length, footprint.width);
    if (offset === null) continue;
    const side = sideOfPoint(candidate.a, candidate.b, cursor);
    const mount: WallMount = {
      edgeId: candidate.edgeId,
      offset,
      side,
      elevation,
    };
    const transform = deriveMountTransform(mount, floor, footprint);
    if (!transform) continue;
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
  return null;
}
