import { pointInOutline } from "./geometry";
import type { WallEdge, WallNode } from "./graph";
import type { Point } from "./types";

/**
 * Faces of the wall graph: the bounded regions (rooms) enclosed by cycles of
 * edges. Pure math over `GraphState`'s node/edge shape — no room identity,
 * no persistence; Task G3 layers room records on top of what this module
 * finds. Also carries the small polygon-geometry helpers a face needs: a
 * label point that's guaranteed inside (even for concave shapes), an inward
 * inset for rendering the room's floor/label area shrunk off the walls, and
 * a signed side test for anchoring which way an opening swings/faces.
 */

/** A bounded region of the graph. `edgeIds[i]` joins `nodeIds[i]` to
 * `nodeIds[(i + 1) % n]`; `polygon` is the raw centerline loop (node
 * positions, not inset); `area` is always positive, in square meters. */
export interface Face {
  nodeIds: string[];
  edgeIds: string[];
  polygon: Point[];
  area: number;
}

const EPS = 1e-6;
/** Cycles smaller than this (m²) are traversal noise, not real faces. */
const MIN_FACE_AREA = 1e-4;
/** Lattice spacing for the concave-polygon label-point fallback scan. */
const LABEL_LATTICE = 0.2;
/** Smallest lattice step the label scan will shrink to for tiny polygons. */
const LABEL_LATTICE_FLOOR = 1e-3;

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** Twice the signed area; sign encodes winding (positive for the sample). */
function signedDoubleArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

interface HalfEdge {
  edgeId: string;
  from: string;
  to: string;
  angle: number;
}

/**
 * Extract every bounded face of the planar graph via half-edge traversal:
 * every edge yields two directed half-edges, and at each node the outgoing
 * half-edges are sorted by direction angle. A half-edge's successor is the
 * PREVIOUS entry (in ascending angle order, wrapping) before its twin in the
 * far node's sorted list — the standard face walk for a planar
 * straight-line graph, sign pinned by the two-rectangles-sharing-an-edge
 * test (the plain-rectangle test alone can't distinguish "next" from
 * "previous": every node there has degree 2, where the two conventions
 * coincide). Successor is a bijection on half-edges, so the traversal always
 * decomposes into disjoint cycles with no extra bookkeeping; a cycle is kept
 * as a face when its shoelace sum is positive (the sample winding) and its
 * area clears the noise floor. That filter also discards the outer
 * (unbounded) cycle of each component and dangling stubs traced there and
 * back — both land with non-positive or ~0 signed area.
 */
export function extractFaces(state: {
  nodes: WallNode[];
  edges: WallEdge[];
}): Face[] {
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));
  const key = (from: string, to: string) => `${from}->${to}`;
  const outgoing = new Map<string, HalfEdge[]>();
  const halfEdgeByKey = new Map<string, HalfEdge>();

  const addHalfEdge = (he: HalfEdge) => {
    halfEdgeByKey.set(key(he.from, he.to), he);
    const list = outgoing.get(he.from);
    if (list) list.push(he);
    else outgoing.set(he.from, [he]);
  };

  for (const e of state.edges) {
    const a = nodesById.get(e.a);
    const b = nodesById.get(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < EPS) continue;
    addHalfEdge({
      edgeId: e.id,
      from: e.a,
      to: e.b,
      angle: Math.atan2(dy, dx),
    });
    addHalfEdge({
      edgeId: e.id,
      from: e.b,
      to: e.a,
      angle: Math.atan2(-dy, -dx),
    });
  }
  for (const list of outgoing.values()) {
    list.sort((x, y) => x.angle - y.angle);
  }

  const successor = (he: HalfEdge): HalfEdge => {
    const twin = halfEdgeByKey.get(key(he.to, he.from));
    const list = outgoing.get(he.to);
    if (!twin || !list || list.length === 0) return he;
    const idx = list.indexOf(twin);
    return list[(idx - 1 + list.length) % list.length];
  };

  const used = new Set<string>();
  const faces: Face[] = [];
  const totalHalfEdges = halfEdgeByKey.size;

  for (const start of halfEdgeByKey.values()) {
    if (used.has(key(start.from, start.to))) continue;

    const cycle: HalfEdge[] = [];
    let cur = start;
    for (let guard = 0; guard <= totalHalfEdges; guard++) {
      used.add(key(cur.from, cur.to));
      cycle.push(cur);
      const next = successor(cur);
      if (next === start) break;
      cur = next;
    }

    const polygon = cycle.map((he) => {
      const n = nodesById.get(he.from);
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    });
    const sum = signedDoubleArea(polygon);
    const area = Math.abs(sum) / 2;
    if (sum > 0 && area >= MIN_FACE_AREA) {
      faces.push({
        nodeIds: cycle.map((he) => he.from),
        edgeIds: cycle.map((he) => he.edgeId),
        polygon,
        area,
      });
    }
  }

  return faces;
}

/** Standard polygon centroid (area-weighted). Falls back to the vertex
 * average for a (near-)zero-area polygon. */
function polygonCentroid(polygon: Point[]): Point {
  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % polygon.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    signedArea += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < EPS) {
    const n = polygon.length || 1;
    const sx = polygon.reduce((s, p) => s + p.x, 0) / n;
    const sy = polygon.reduce((s, p) => s + p.y, 0) / n;
    return { x: sx, y: sy };
  }
  return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) };
}

/** Whether `p` lies in the closed triangle (a, b, c): all edge cross
 * products carry the same sign (boundary counts as inside). */
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * A point strictly inside any simple polygon — the classic construction
 * (O'Rourke): the lowest-leftmost vertex `v` is convex; with neighbors `p`
 * and `n`, either no other vertex intrudes into triangle (p, v, n) and its
 * centroid is interior, or the intruding vertex `q` farthest from line p–n
 * sees `v` across the interior, so the midpoint of v–q is interior.
 *
 * Caveat: this assumes a *simple* polygon. A face traced through a stub edge
 * visits a vertex twice (the same node going out and back), so the loop isn't
 * strictly simple; the repeated-vertex guards (`c === prev`/`c === next` and
 * the coincident-coordinate skip) keep it from picking the stub tip as `q`,
 * but this is only reached as `faceLabelPoint`'s last-resort fallback — real
 * faces resolve on the centroid or lattice scan first.
 */
function guaranteedInteriorPoint(polygon: Point[]): Point {
  const count = polygon.length;
  let vi = 0;
  for (let i = 1; i < count; i++) {
    const c = polygon[i];
    const v = polygon[vi];
    if (c.x < v.x || (c.x === v.x && c.y < v.y)) vi = i;
  }
  const v = polygon[vi];
  const prev = polygon[(vi - 1 + count) % count];
  const next = polygon[(vi + 1) % count];

  let q: Point | null = null;
  let qDist = -1;
  for (let i = 0; i < count; i++) {
    if (i === vi) continue;
    const c = polygon[i];
    if ((c.x === v.x && c.y === v.y) || c === prev || c === next) continue;
    if (!pointInTriangle(c, prev, v, next)) continue;
    // Distance from line prev–next, up to a constant factor: |cross|.
    const dist = Math.abs(
      (next.x - prev.x) * (c.y - prev.y) - (next.y - prev.y) * (c.x - prev.x),
    );
    if (dist > qDist) {
      qDist = dist;
      q = c;
    }
  }
  if (!q) {
    return {
      x: (prev.x + v.x + next.x) / 3,
      y: (prev.y + v.y + next.y) / 3,
    };
  }
  return { x: (v.x + q.x) / 2, y: (v.y + q.y) / 2 };
}

/**
 * A point inside `polygon` suitable for placing a room's area/name label:
 * the area centroid when it lands inside (convex and most real rooms), or
 * else the inside sample of a bbox lattice scan nearest the centroid — step
 * 0.2 m, shrunk to an eighth of the bbox for small polygons so tiny faces
 * still get samples. If even the lattice finds nothing (a sliver dodging
 * every sample), falls back to `guaranteedInteriorPoint`, so the result is
 * inside for any simple polygon with positive area.
 */
export function faceLabelPoint(polygon: Point[]): Point {
  const centroid = polygonCentroid(polygon);
  if (pointInOutline(polygon, centroid)) return centroid;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const step = Math.max(
    LABEL_LATTICE_FLOOR,
    Math.min(LABEL_LATTICE, (maxX - minX) / 8, (maxY - minY) / 8),
  );

  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let x = minX; x <= maxX + EPS; x += step) {
    for (let y = minY; y <= maxY + EPS; y += step) {
      const p = { x, y };
      if (!pointInOutline(polygon, p)) continue;
      const dist = Math.hypot(p.x - centroid.x, p.y - centroid.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
  }
  return best ?? guaranteedInteriorPoint(polygon);
}

/**
 * Shrink a (positively or negatively wound) polygon inward by `inset`
 * meters: offset each edge's line along its inward normal, then re-vertex at
 * the intersection of consecutive offset lines. Near-parallel consecutive
 * edges use the offset point directly. Returns null when the inset
 * degenerates — a non-finite vertex, a winding flip, or non-positive area —
 * meaning the polygon has no interior left at that inset.
 */
export function insetPolygon(polygon: Point[], inset: number): Point[] | null {
  const n = polygon.length;
  if (n < 3) return null;
  const sign = Math.sign(signedDoubleArea(polygon)) || 1;

  const offsetLines: { point: Point; dir: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % n];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    const dir = { x: dx / len, y: dy / len };
    // room-scene.ts convention: outward is the right
    // normal for the sample's positive winding; inward is its negation.
    const outward = { x: dir.y * sign, y: -dir.x * sign };
    const inward = { x: -outward.x, y: -outward.y };
    offsetLines.push({
      point: { x: p0.x + inward.x * inset, y: p0.y + inward.y * inset },
      dir,
    });
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = offsetLines[(i - 1 + n) % n];
    const cur = offsetLines[i];
    const cross = prev.dir.x * cur.dir.y - prev.dir.y * cur.dir.x;
    let vertex: Point;
    if (Math.abs(cross) < 1e-9) {
      vertex = cur.point;
    } else {
      const dx = cur.point.x - prev.point.x;
      const dy = cur.point.y - prev.point.y;
      const t = (dx * cur.dir.y - dy * cur.dir.x) / cross;
      vertex = {
        x: prev.point.x + prev.dir.x * t,
        y: prev.point.y + prev.dir.y * t,
      };
    }
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return null;
    result.push({ x: round(vertex.x), y: round(vertex.y) });
  }

  const resultSum = signedDoubleArea(result);
  if (Math.sign(resultSum) !== sign) return null;
  if (Math.abs(resultSum) / 2 <= 0) return null;
  return result;
}

/**
 * Which side of line a→b point `p` falls on: the sign of the cross product
 * `(b-a) × (p-a)`. `+1` for a positive cross; `0` (p on the line) falls to
 * `-1` — callers never ask about points on the line itself.
 */
export function sideOfPoint(a: Point, b: Point, p: Point): 1 | -1 {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross > 0 ? 1 : -1;
}
