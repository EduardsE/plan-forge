import { DRAW_GRID_STEP, quantizeToStep } from "#/lib/draw";
import type { Floor, Opening, Point, WallEdge, WallNode } from "#/lib/model";
import {
  NODE_MERGE_TOLERANCE,
  openingVerticals,
  reconcileFloor,
  verticalsOverlap,
} from "#/lib/model";
import { slideOpening } from "#/lib/opening-place";

/**
 * Pure graph-edit operations for draw mode. Every op is `Floor → Floor`,
 * clones only what changes, and — except the mid-drag `moveNodePreview` —
 * ends in `reconcileFloor` so stored state stays normalized + identity-matched.
 * Unknown ids and no-op edits return the same floor reference (the pure-setter
 * contract). Ids are minted through an injectable factory so tests stay
 * deterministic.
 *
 * These replace the retired per-room `outline-edit.ts`: dragging a node moves
 * every wall that shares it, chains draw open, welding replaces the old
 * outer-face "attach", and deleting an edge merges the faces it divided.
 */

const EPS = 1e-6;

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Splits landing closer than this to a corner are refused (meters) — the
 * click was aimed at the corner, not the wall. Ported from `outline-edit.ts`. */
export const SPLIT_CORNER_CLEARANCE = 0.25;

/** A corner a dragged node snapped its x or y to — a guide to draw in-scene. */
export interface NodeGuide {
  nodeId: string;
  axis: "x" | "y";
}

export interface NodeDragSnap {
  point: Point;
  /** At most one guide per axis. */
  guides: NodeGuide[];
}

/**
 * Raw move of `nodeId` to `point` — **no** normalize, so a mid-drag weld can't
 * fire irreversibly while the pointer is still down. Unknown ids / a
 * coincident position return the same floor reference.
 */
export function moveNodePreview(
  floor: Floor,
  nodeId: string,
  point: Point,
): Floor {
  const node = floor.nodes.find((n) => n.id === nodeId);
  if (!node) return floor;
  const x = round(point.x);
  const y = round(point.y);
  if (node.x === x && node.y === y) return floor;
  const nodes = floor.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n));
  return { ...floor, nodes };
}

/**
 * Move `nodeId` to `point` and reconcile: welding (of a node dragged within
 * `NODE_MERGE_TOLERANCE` of another), T-junction splits, and opening re-fits
 * all happen here, at gesture end.
 */
export function settleNodeMove(
  floor: Floor,
  nodeId: string,
  point: Point,
): Floor {
  const moved = moveNodePreview(floor, nodeId, point);
  if (moved === floor && !floor.nodes.some((n) => n.id === nodeId)) {
    return floor;
  }
  return reconcileFloor(moved);
}

/**
 * Snap a dragged node's cursor: each coordinate locks to the nearest *other*
 * node's matching coordinate within `tolerance` (recording a guide), and
 * whatever stays free quantizes to the drawing grid. Welding replaces the old
 * wall-slab "attach", so there are no wall targets here — landing on another
 * node's coordinate lines the drag up to weld onto it. With `snap` off the raw
 * cursor passes straight through. Port of `snapCornerDrag`.
 */
export function snapNodeDrag(
  floor: Floor,
  nodeId: string,
  cursor: Point,
  tolerance: number,
  snap = true,
): NodeDragSnap {
  if (!snap) return { point: { x: cursor.x, y: cursor.y }, guides: [] };
  const point: Point = { x: cursor.x, y: cursor.y };
  const guides: NodeGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    let best: WallNode | null = null;
    let bestDistance = tolerance;
    for (const node of floor.nodes) {
      if (node.id === nodeId) continue;
      const d = Math.abs(cursor[axis] - node[axis]);
      if (d < bestDistance) {
        bestDistance = d;
        best = node;
      }
    }
    if (best) {
      point[axis] = best[axis];
      guides.push({ nodeId: best.id, axis });
    } else {
      point[axis] = quantizeToStep(point[axis], DRAW_GRID_STEP);
    }
  }
  return { point, guides };
}

/**
 * Add a wall between `from` and `to`: each endpoint reuses a node within
 * `NODE_MERGE_TOLERANCE` (welding onto an existing corner) or mints a fresh
 * one, then the edge is added and the graph reconciled — landing on an edge's
 * interior splits it (a T-junction), closing a loop births a face.
 */
export function addWallSegment(
  floor: Floor,
  from: Point,
  to: Point,
  newId: () => string = () => crypto.randomUUID(),
): Floor {
  let nodes = floor.nodes;
  const findOrAdd = (p: Point): string => {
    const existing = nodes.find((n) => distance(n, p) < NODE_MERGE_TOLERANCE);
    if (existing) return existing.id;
    const node: WallNode = { id: newId(), x: round(p.x), y: round(p.y) };
    nodes = [...nodes, node];
    return node.id;
  };
  const a = findOrAdd(from);
  const b = findOrAdd(to);
  const edge: WallEdge = { id: newId(), a, b };
  return reconcileFloor({ ...floor, nodes, edges: [...floor.edges, edge] });
}

/**
 * Split edge `edgeId` at the (grid-quantized) projection of `point` onto it,
 * inserting a node there so `reconcileFloor` cuts the edge in two. Refused —
 * same floor reference — within `SPLIT_CORNER_CLEARANCE` of either end, on too
 * short an edge, or for an unknown id. Port of `splitPointOnWall`.
 */
export function splitEdgeAt(
  floor: Floor,
  edgeId: string,
  point: Point,
  newId: () => string = () => crypto.randomUUID(),
): Floor {
  const edge = floor.edges.find((e) => e.id === edgeId);
  if (!edge) return floor;
  const a = floor.nodes.find((n) => n.id === edge.a);
  const b = floor.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return floor;
  const length = distance(a, b);
  if (length < 2 * SPLIT_CORNER_CLEARANCE) return floor;
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const along = quantizeToStep(
    (point.x - a.x) * dir.x + (point.y - a.y) * dir.y,
    DRAW_GRID_STEP,
  );
  if (
    along < SPLIT_CORNER_CLEARANCE ||
    along > length - SPLIT_CORNER_CLEARANCE
  ) {
    return floor;
  }
  const node: WallNode = {
    id: newId(),
    x: round(a.x + dir.x * along),
    y: round(a.y + dir.y * along),
  };
  return reconcileFloor({ ...floor, nodes: [...floor.nodes, node] });
}

/**
 * Delete edge `edgeId` and its openings; `reconcileFloor` drops any node left
 * orphaned. On a shared edge the two faces it divided merge into one.
 */
export function deleteEdge(floor: Floor, edgeId: string): Floor {
  if (!floor.edges.some((e) => e.id === edgeId)) return floor;
  const edges = floor.edges.filter((e) => e.id !== edgeId);
  const openings = floor.openings.filter((o) => o.edgeId !== edgeId);
  return reconcileFloor({ ...floor, edges, openings });
}

interface UnitLine {
  origin: Point;
  dir: Point;
}

/** The a→b unit line of an edge, or null when degenerate. */
function edgeLine(floor: Floor, edge: WallEdge): UnitLine | null {
  const a = floor.nodes.find((n) => n.id === edge.a);
  const b = floor.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return null;
  const length = distance(a, b);
  if (length < EPS) return null;
  return {
    origin: a,
    dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
  };
}

/**
 * Delete node `nodeId`. Degree 2: its two edges merge into one straight edge
 * a→c, and their openings re-project onto it by world center (slid clear of
 * one another with `slideOpening`, side/hinge flipped when the merged edge runs
 * opposite the host). Any other degree: the node, its incident edges, and
 * their openings go, and reconcile cleans up. Port of `removeOutlineCorner`'s
 * slide logic onto the graph.
 */
export function deleteNode(
  floor: Floor,
  nodeId: string,
  newId: () => string = () => crypto.randomUUID(),
): Floor {
  const node = floor.nodes.find((n) => n.id === nodeId);
  if (!node) return floor;
  const incident = floor.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  const otherEnd = (e: WallEdge) => (e.a === nodeId ? e.b : e.a);

  if (incident.length === 2) {
    const [e1, e2] = incident;
    const xId = otherEnd(e1);
    const yId = otherEnd(e2);
    const x = floor.nodes.find((n) => n.id === xId);
    const y = floor.nodes.find((n) => n.id === yId);
    if (x && y && xId !== yId) {
      const mergedId = newId();
      const merged: WallEdge = { id: mergedId, a: xId, b: yId };
      const mergedLength = distance(x, y);
      const mergedDir =
        mergedLength < EPS
          ? null
          : { x: (y.x - x.x) / mergedLength, y: (y.y - x.y) / mergedLength };
      const spans: Array<{
        start: number;
        width: number;
        bottom: number;
        top: number;
      }> = [];
      const openings: Opening[] = [];
      for (const o of floor.openings) {
        if (o.edgeId !== e1.id && o.edgeId !== e2.id) {
          openings.push(o);
          continue;
        }
        const host = edgeLine(floor, o.edgeId === e1.id ? e1 : e2);
        if (!host || !mergedDir) continue;
        const center = {
          x: host.origin.x + host.dir.x * (o.offset + o.width / 2),
          y: host.origin.y + host.dir.y * (o.offset + o.width / 2),
        };
        const along =
          (center.x - x.x) * mergedDir.x + (center.y - x.y) * mergedDir.y;
        // Only already-placed openings on an overlapping vertical band block —
        // a stacked pair re-projects without shoving each other sideways.
        const band = openingVerticals(o);
        const offset = slideOpening(
          mergedLength,
          o.width,
          spans.filter((span) => verticalsOverlap(band, span)),
          along - o.width / 2,
        );
        if (offset === null) continue;
        spans.push({ start: offset, width: o.width, ...band });
        const sameDir =
          host.dir.x * mergedDir.x + host.dir.y * mergedDir.y >= 0;
        const next: Opening = { ...o, edgeId: mergedId, offset };
        if (!sameDir) {
          next.side = o.side === 1 ? -1 : 1;
          if (o.hinge) next.hinge = o.hinge === "start" ? "end" : "start";
        }
        openings.push(next);
      }
      const edges = floor.edges
        .filter((e) => e.id !== e1.id && e.id !== e2.id)
        .concat(merged);
      const nodes = floor.nodes.filter((n) => n.id !== nodeId);
      return reconcileFloor({ ...floor, nodes, edges, openings });
    }
  }

  const incidentIds = new Set(incident.map((e) => e.id));
  const edges = floor.edges.filter((e) => !incidentIds.has(e.id));
  const openings = floor.openings.filter((o) => !incidentIds.has(o.edgeId));
  const nodes = floor.nodes.filter((n) => n.id !== nodeId);
  return reconcileFloor({ ...floor, nodes, edges, openings });
}

/**
 * Set edge `edgeId`'s length to `length`, keeping its direction: the `fixed`
 * end stays and the other node slides along the edge to the new distance —
 * dragging every wall that shares the moved node with it. Invalid / non-positive
 * / unchanged lengths and unknown ids return the same floor reference.
 */
export function setEdgeLength(
  floor: Floor,
  edgeId: string,
  length: number,
  fixed: "a" | "b",
): Floor {
  if (!Number.isFinite(length) || length <= 0) return floor;
  const edge = floor.edges.find((e) => e.id === edgeId);
  if (!edge) return floor;
  const a = floor.nodes.find((n) => n.id === edge.a);
  const b = floor.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return floor;
  const current = distance(a, b);
  if (current < EPS || Math.abs(length - current) < EPS) return floor;
  const anchor = fixed === "a" ? a : b;
  const mover = fixed === "a" ? b : a;
  const dir = {
    x: (mover.x - anchor.x) / current,
    y: (mover.y - anchor.y) / current,
  };
  const moved: WallNode = {
    ...mover,
    x: round(anchor.x + dir.x * length),
    y: round(anchor.y + dir.y * length),
  };
  const nodes = floor.nodes.map((n) => (n.id === mover.id ? moved : n));
  return reconcileFloor({ ...floor, nodes });
}
