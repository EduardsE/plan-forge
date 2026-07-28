import type { Opening, Point } from "./types";

/**
 * The planar wall graph: rooms are no longer stored as closed per-room
 * outlines but derived from a shared graph of nodes (corners/T-junctions),
 * edges (wall runs), and openings anchored to an edge. This module is the
 * pure core — types plus `normalizeGraph`, which repairs a graph edited by
 * drawing/dragging into a well-formed one (welded nodes, no degenerate or
 * duplicate edges, every crossing and T-junction turned into a real node,
 * every opening re-homed and re-fit). Nothing else imports this module yet;
 * wiring into `Floor` happens in a later task.
 */

/** A graph vertex: a wall corner or T-junction, in plan coordinates. */
export interface WallNode {
  id: string;
  x: number;
  y: number;
}

/** A wall run between two nodes. */
export interface WallEdge {
  id: string;
  a: string;
  b: string;
  /**
   * Optional per-wall thickness override, meters (clamped by
   * `setEdgeThickness`). An exterior (1-face) wall grows outward with its
   * interior face pinned; a shared (2-face) or dangling wall grows
   * symmetrically about its centerline (`edgeSideHalves`, model/faces.ts).
   */
  thickness?: number;
}

export interface GraphState {
  nodes: WallNode[];
  edges: WallEdge[];
  openings: Opening[];
}

/** Below DRAW_GRID_STEP (0.05) so grid-snapped neighbors never weld. */
export const NODE_MERGE_TOLERANCE = 0.03;

const EPS = 1e-6;
const MAX_PASSES = 32;

export function nodeById(state: GraphState, id: string): WallNode | undefined {
  return state.nodes.find((n) => n.id === id);
}

export function edgeLength(state: GraphState, edge: WallEdge): number {
  const a = nodeById(state, edge.a);
  const b = nodeById(state, edge.b);
  if (!a || !b) return 0;
  return distance(a, b);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * 1. Weld nodes closer than `NODE_MERGE_TOLERANCE`: the earlier node in
 * array order (the "keeper") survives at its own position and absorbs every
 * later node within tolerance of it; edges are rewritten onto the keeper.
 */
function weldNodes(
  nodes: WallNode[],
  edges: WallEdge[],
): { nodes: WallNode[]; edges: WallEdge[]; changed: boolean } {
  const remap = new Map<string, string>();
  const kept: WallNode[] = [];
  for (const n of nodes) {
    const keeper = kept.find((k) => distance(k, n) < NODE_MERGE_TOLERANCE);
    if (keeper) {
      remap.set(n.id, keeper.id);
    } else {
      kept.push(n);
    }
  }
  if (remap.size === 0) return { nodes, edges, changed: false };
  const nextEdges = edges.map((e) => {
    const a = remap.get(e.a) ?? e.a;
    const b = remap.get(e.b) ?? e.b;
    return a === e.a && b === e.b ? e : { ...e, a, b };
  });
  return { nodes: kept, edges: nextEdges, changed: true };
}

/**
 * 2. Drop edges with equal endpoints, endpoints closer than `EPS`, or an
 * endpoint that resolves to no node — a dangling reference is malformed, so
 * it's dropped rather than carried into the face walk (defensive: normal
 * pipeline input never has one, but persisted/hand-edited state might).
 */
function dropDegenerateEdges(
  edges: WallEdge[],
  nodes: WallNode[],
): { edges: WallEdge[]; changed: boolean } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = edges.filter((e) => {
    if (e.a === e.b) return false;
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return false;
    return distance(a, b) >= EPS;
  });
  return { edges: next, changed: next.length !== edges.length };
}

/**
 * 3. Collapse edges sharing the same unordered node pair: the first survives,
 * later duplicates' openings re-home onto it (mirrored if the duplicate ran
 * the opposite direction).
 */
function dedupeEdges(
  edges: WallEdge[],
  nodes: WallNode[],
  openings: Opening[],
): { edges: WallEdge[]; openings: Opening[]; changed: boolean } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Map<string, WallEdge>();
  const kept: WallEdge[] = [];
  const remap = new Map<string, { keeper: WallEdge; reversed: boolean }>();
  for (const e of edges) {
    const key = [e.a, e.b].sort().join("|");
    const keeper = seen.get(key);
    if (!keeper) {
      seen.set(key, e);
      kept.push(e);
    } else {
      remap.set(e.id, { keeper, reversed: keeper.a !== e.a });
    }
  }
  if (remap.size === 0) return { edges, openings, changed: false };
  const nextOpenings = openings.map((o) => {
    const r = remap.get(o.edgeId);
    if (!r) return o;
    if (!r.reversed) return { ...o, edgeId: r.keeper.id };
    const a = byId.get(r.keeper.a);
    const b = byId.get(r.keeper.b);
    const length = a && b ? distance(a, b) : 0;
    const next: Opening = {
      ...o,
      edgeId: r.keeper.id,
      offset: length - o.offset - o.width,
      side: o.side === 1 ? -1 : 1,
    };
    if (o.hinge) next.hinge = o.hinge === "start" ? "end" : "start";
    return next;
  });
  return { edges: kept, openings: nextOpenings, changed: true };
}

/**
 * Replace `edge` with two pieces split at distance `t` (0 < t < length) from
 * `edge.a`, joined through `splitNodeId`. Openings on `edge` re-home by center.
 */
function splitEdgeAt(
  edges: WallEdge[],
  openings: Opening[],
  edge: WallEdge,
  length: number,
  t: number,
  splitNodeId: string,
  newId: () => string,
): { edges: WallEdge[]; openings: Opening[] } {
  const carry =
    edge.thickness !== undefined ? { thickness: edge.thickness } : {};
  const pieceA: WallEdge = { id: newId(), a: edge.a, b: splitNodeId, ...carry };
  const pieceB: WallEdge = { id: newId(), a: splitNodeId, b: edge.b, ...carry };
  const nextEdges = edges.flatMap((e) =>
    e.id === edge.id ? [pieceA, pieceB] : [e],
  );
  const nextOpenings: Opening[] = [];
  for (const o of openings) {
    if (o.edgeId !== edge.id) {
      nextOpenings.push(o);
      continue;
    }
    const center = o.offset + o.width / 2;
    if (center <= t) {
      if (o.width <= t + EPS) {
        nextOpenings.push({
          ...o,
          edgeId: pieceA.id,
          offset: Math.max(0, Math.min(o.offset, t - o.width)),
        });
      }
    } else {
      const pieceLength = length - t;
      if (o.width <= pieceLength + EPS) {
        nextOpenings.push({
          ...o,
          edgeId: pieceB.id,
          offset: Math.max(0, Math.min(o.offset - t, pieceLength - o.width)),
        });
      }
    }
  }
  return { edges: nextEdges, openings: nextOpenings };
}

/**
 * 4. Split an edge at a node that lands on its interior (a T-junction): the
 * node snaps onto the line and the edge becomes two, one split at a time so
 * the caller's outer loop re-checks from a clean state.
 */
function splitAtNodes(
  nodes: WallNode[],
  edges: WallEdge[],
  openings: Opening[],
  newId: () => string,
): {
  nodes: WallNode[];
  edges: WallEdge[];
  openings: Opening[];
  changed: boolean;
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b) continue;
    const length = distance(a, b);
    if (length < EPS) continue;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (const n of nodes) {
      if (n.id === edge.a || n.id === edge.b) continue;
      const t = (n.x - a.x) * dir.x + (n.y - a.y) * dir.y;
      if (t <= EPS || t >= length - EPS) continue;
      const proj = { x: a.x + dir.x * t, y: a.y + dir.y * t };
      if (distance(n, proj) >= NODE_MERGE_TOLERANCE) continue;
      const movedNode: WallNode = { ...n, x: round(proj.x), y: round(proj.y) };
      const nextNodes = nodes.map((nn) => (nn.id === n.id ? movedNode : nn));
      const split = splitEdgeAt(edges, openings, edge, length, t, n.id, newId);
      return { nodes: nextNodes, ...split, changed: true };
    }
  }
  return { nodes, edges, openings, changed: false };
}

/** Intersection of two segments a1→b1 and a2→b2, with each hit's parameter
 * (0..1) along its own segment. Null when parallel (or nearly so). `denom` is
 * the cross product of the two direction vectors, so its units are length²;
 * the `EPS` (1e-6) parallel guard is therefore a length² threshold. That's
 * acceptable here: edges are whole meters, so a genuine crossing's denom is
 * O(1), far above 1e-6, and the split-tolerance regime (NODE_MERGE_TOLERANCE)
 * already absorbs near-parallel edges before they'd matter. */
function segmentIntersection(
  a1: Point,
  b1: Point,
  a2: Point,
  b2: Point,
): { t1: number; t2: number; point: Point } | null {
  const d1x = b1.x - a1.x;
  const d1y = b1.y - a1.y;
  const d2x = b2.x - a2.x;
  const d2y = b2.y - a2.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const t1 = (dx * d2y - dy * d2x) / denom;
  const t2 = (dx * d1y - dy * d1x) / denom;
  return { t1, t2, point: { x: a1.x + d1x * t1, y: a1.y + d1y * t1 } };
}

/**
 * 5. Split two edges at a proper interior crossing (no shared endpoint) by
 * inserting a new node there and splitting both, one crossing at a time.
 */
function splitCrossings(
  nodes: WallNode[],
  edges: WallEdge[],
  openings: Opening[],
  newId: () => string,
): {
  nodes: WallNode[];
  edges: WallEdge[];
  openings: Opening[];
  changed: boolean;
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i];
    const a1 = byId.get(e1.a);
    const b1 = byId.get(e1.b);
    if (!a1 || !b1) continue;
    for (let j = i + 1; j < edges.length; j++) {
      const e2 = edges[j];
      if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) {
        continue;
      }
      const a2 = byId.get(e2.a);
      const b2 = byId.get(e2.b);
      if (!a2 || !b2) continue;
      const hit = segmentIntersection(a1, b1, a2, b2);
      if (!hit) continue;
      if (
        hit.t1 <= EPS ||
        hit.t1 >= 1 - EPS ||
        hit.t2 <= EPS ||
        hit.t2 >= 1 - EPS
      ) {
        continue;
      }
      const splitNodeId = newId();
      const newNode: WallNode = {
        id: splitNodeId,
        x: round(hit.point.x),
        y: round(hit.point.y),
      };
      const len1 = distance(a1, b1);
      const len2 = distance(a2, b2);
      const split1 = splitEdgeAt(
        edges,
        openings,
        e1,
        len1,
        hit.t1 * len1,
        splitNodeId,
        newId,
      );
      const split2 = splitEdgeAt(
        split1.edges,
        split1.openings,
        e2,
        len2,
        hit.t2 * len2,
        splitNodeId,
        newId,
      );
      return {
        nodes: [...nodes, newNode],
        edges: split2.edges,
        openings: split2.openings,
        changed: true,
      };
    }
  }
  return { nodes, edges, openings, changed: false };
}

/** 6. Drop nodes referenced by no edge. */
function dropOrphanNodes(
  nodes: WallNode[],
  edges: WallEdge[],
): { nodes: WallNode[]; changed: boolean } {
  const referenced = new Set<string>();
  for (const e of edges) {
    referenced.add(e.a);
    referenced.add(e.b);
  }
  const next = nodes.filter((n) => referenced.has(n.id));
  return { nodes: next, changed: next.length !== nodes.length };
}

/**
 * 7. Drop openings whose edge no longer exists or is now too short to fit
 * them; clamp the rest onto their (possibly shorter) edge.
 */
function fitOpenings(
  openings: Opening[],
  edges: WallEdge[],
  nodes: WallNode[],
): { openings: Opening[]; changed: boolean } {
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const next: Opening[] = [];
  let changed = false;
  for (const o of openings) {
    const edge = edgesById.get(o.edgeId);
    if (!edge) {
      changed = true;
      continue;
    }
    const a = nodesById.get(edge.a);
    const b = nodesById.get(edge.b);
    const length = a && b ? distance(a, b) : 0;
    if (o.width > length + EPS) {
      changed = true;
      continue;
    }
    const offset = Math.max(0, Math.min(o.offset, length - o.width));
    if (offset === o.offset) {
      next.push(o);
    } else {
      next.push({ ...o, offset });
      changed = true;
    }
  }
  return { openings: next, changed };
}

/**
 * Repair a graph edited by drawing/dragging into a well-formed one: welds
 * near-coincident nodes, drops degenerate/duplicate edges (re-homing their
 * openings), turns every T-junction and edge crossing into a real shared
 * node, drops orphan nodes, and re-fits every opening onto its (possibly
 * resized) edge. Idempotent, and returns the input object itself (same
 * reference) when nothing changed. Runs the passes above to a fixed point
 * (capped at `MAX_PASSES` full rounds).
 */
export function normalizeGraph(
  state: GraphState,
  newId: () => string = () => crypto.randomUUID(),
): GraphState {
  let nodes = state.nodes;
  let edges = state.edges;
  let openings = state.openings;
  let changedOverall = false;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    const welded = weldNodes(nodes, edges);
    nodes = welded.nodes;
    edges = welded.edges;
    changed ||= welded.changed;

    const degenFree = dropDegenerateEdges(edges, nodes);
    edges = degenFree.edges;
    changed ||= degenFree.changed;

    const deduped = dedupeEdges(edges, nodes, openings);
    edges = deduped.edges;
    openings = deduped.openings;
    changed ||= deduped.changed;

    const nodeSplit = splitAtNodes(nodes, edges, openings, newId);
    nodes = nodeSplit.nodes;
    edges = nodeSplit.edges;
    openings = nodeSplit.openings;
    changed ||= nodeSplit.changed;

    const crossingSplit = splitCrossings(nodes, edges, openings, newId);
    nodes = crossingSplit.nodes;
    edges = crossingSplit.edges;
    openings = crossingSplit.openings;
    changed ||= crossingSplit.changed;

    const noOrphans = dropOrphanNodes(nodes, edges);
    nodes = noOrphans.nodes;
    changed ||= noOrphans.changed;

    const fitted = fitOpenings(openings, edges, nodes);
    openings = fitted.openings;
    changed ||= fitted.changed;

    if (!changed) break;
    changedOverall = true;
  }

  return changedOverall ? { nodes, edges, openings } : state;
}
