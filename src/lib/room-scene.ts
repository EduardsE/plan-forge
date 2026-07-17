import type { DerivedRoom } from "#/lib/model";
import {
  DEFAULT_WALL_HEIGHT,
  type Floor,
  type Opening,
  type Point,
  WALL_THICKNESS,
  wallHeightOf,
} from "#/lib/model";

/**
 * Pure scene-preparation math for the 3D/2D lenses: turns the wall **graph**
 * into wall "solids" a renderer can extrude — one solid per graph edge, no
 * three.js, no React, so it stays unit-testable (same pattern as `camera.ts`).
 *
 * A wall is the edge's centerline extruded WALL_THICKNESS / 2 to **both**
 * sides, with holes cut for every opening on that edge (from either room's
 * side — there is one solid, so both sides share the cut). This replaces the
 * old per-room outline extrusion + seam-halving: a shared wall is now a single
 * solid instead of two half-thickness halves, and a dangling edge (bordering
 * no room) renders as a plain wall.
 *
 * All values are meters in plan coordinates (x right, y down — see
 * `model/types.ts`). The vertical extent of openings isn't in the model yet,
 * so this module owns the defaults, measured from the mockup's 3D scene
 * (walls 250 px = 2.5 m at 100 px/m, window at top:56/height:158 px).
 */

/** Default wall height; rooms can override it (`Room.wallHeight`). */
export const WALL_HEIGHT = DEFAULT_WALL_HEIGHT;
export { WALL_THICKNESS };
/** Thickness of the dollhouse floor platform (mockup slab edge: 18 px). */
export const SLAB_THICKNESS = 0.18;
export const DOOR_HEIGHT = 2.05;
export const WINDOW_SILL = 0.36;
export const WINDOW_HEAD = 1.94;
/**
 * Height of a cut-down wall in the dollhouse cutaway (Sims-style): occluding
 * walls drop to this stub instead of hiding, tall enough to read as a wall
 * (baseboard + a sliver of face), low enough to keep furniture visible.
 */
export const STUB_WALL_HEIGHT = 0.3;

const MIN_HOLE_SIZE = 1e-6;

/** A stretch along a wall, as distances from the wall's start corner (node a). */
export interface Span {
  start: number;
  end: number;
}

/** A rectangular cut in a wall, in edge-local coordinates. */
export interface WallHole {
  /** Id of the model opening the hole came from (picking needs it). */
  id: string;
  kind: Opening["kind"];
  /** Distance from the edge's node `a` to the hole's near edge. */
  start: number;
  width: number;
  /** Height of the hole's lower edge above the floor. */
  bottom: number;
  /** Height of the hole's upper edge above the floor. */
  top: number;
  /** Doors only: hinge edge, carried through from the opening. */
  hinge?: "start" | "end";
  /**
   * Face the opening belongs to / the door swings toward — the `sideOfPoint`
   * sign of the room it opens into (`Opening.side`). Symbols, dressing and
   * pick targets orient by it; both faces of the one solid get the cut.
   */
  side: 1 | -1;
}

/** One wall ready to extrude: an edge's centerline with holes cut into it. */
export interface WallSolid {
  /** Sequence index in `floor.edges`, for stable React keys. */
  index: number;
  /** The graph edge this solid renders — opening placement anchors to it. */
  edgeId: string;
  /** Plan position of the edge's node `a`. */
  start: Point;
  /** Unit direction along the edge, a → b. */
  dir: Point;
  /**
   * Unit normal: toward the face-less side when exactly one side has a room,
   * else the `+1` (`sideOfPoint`-positive) normal. The wall body extrudes
   * symmetrically about the line, so this only orients symbols/dressing.
   */
  outward: Point;
  length: number;
  /** Wall/ceiling height: max of the adjacent rooms, DEFAULT for none. */
  height: number;
  holes: WallHole[];
  /**
   * Number of adjacent room faces (0, 1 or 2). Two → the wall always occludes
   * one of its rooms, so it always stubs in the cutaway; 0/1 keep the
   * camera-facing test.
   */
  faces: number;
  /** The `sideOfPoint` sign of each adjacent room (length === `faces`). */
  faceSides: Array<1 | -1>;
}

/** A filler post at a graph node where non-collinear walls meet. */
export interface NodePost {
  nodeId: string;
  /** Plan position of the node (post center). */
  center: Point;
  /** Solid indices of the edges meeting here (for the cutaway tall-check). */
  edgeIndices: number[];
  /** Post height: the tallest incident wall. */
  height: number;
}

const leftNormal = (dir: Point): Point => ({ x: -dir.y + 0, y: dir.x + 0 });
const rightNormal = (dir: Point): Point => ({ x: dir.y + 0, y: -dir.x + 0 });

/** Push a door/window `opening` onto `holes` in edge-local coordinates,
 * clamped to the edge and (vertically) to the wall height, exactly the old
 * `cutHole` rules. */
function cutHole(
  holes: WallHole[],
  opening: Opening,
  length: number,
  height: number,
): void {
  const start = Math.min(Math.max(opening.offset, 0), length);
  const end = Math.min(Math.max(opening.offset + opening.width, 0), length);
  const bottom = opening.kind === "window" ? WINDOW_SILL : 0;
  const top = Math.min(
    opening.kind === "window" ? WINDOW_HEAD : DOOR_HEIGHT,
    height,
  );
  if (end - start < MIN_HOLE_SIZE || top - bottom < MIN_HOLE_SIZE) return;
  holes.push({
    id: opening.id,
    kind: opening.kind,
    start,
    width: end - start,
    bottom,
    top,
    ...(opening.hinge ? { hinge: opening.hinge } : {}),
    side: opening.side,
  });
}

/**
 * One wall solid per graph edge: the edge's centerline (nodes `a`→`b`), the
 * openings on it as holes (both rooms' — there is one solid), and the wall
 * height as the max of its adjacent rooms (DEFAULT for a dangling edge). The
 * adjacency (`faces`/`faceSides`) comes from the derived rooms' `wallRefs`.
 */
export function buildEdgeSolids(
  floor: Floor,
  rooms: DerivedRoom[],
): WallSolid[] {
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, Array<{ height: number; side: 1 | -1 }>>();
  for (const room of rooms) {
    const height = wallHeightOf(room);
    for (const ref of room.wallRefs) {
      const list = adjacency.get(ref.edgeId);
      if (list) list.push({ height, side: ref.side });
      else adjacency.set(ref.edgeId, [{ height, side: ref.side }]);
    }
  }
  const openingsByEdge = new Map<string, Opening[]>();
  for (const opening of floor.openings) {
    const list = openingsByEdge.get(opening.edgeId);
    if (list) list.push(opening);
    else openingsByEdge.set(opening.edgeId, [opening]);
  }

  const solids: WallSolid[] = [];
  floor.edges.forEach((edge, index) => {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_HOLE_SIZE) return;
    const dir = { x: dx / length, y: dy / length };

    const adj = adjacency.get(edge.id) ?? [];
    const faceSides = adj.map((entry) => entry.side);
    const height = adj.length
      ? Math.max(...adj.map((entry) => entry.height))
      : DEFAULT_WALL_HEIGHT;
    // One face → outward points to the empty (exterior) side, so symbols hang
    // inside the room; otherwise the sign-positive normal, arbitrary but fixed.
    const outward =
      adj.length === 1
        ? faceSides[0] === 1
          ? rightNormal(dir)
          : leftNormal(dir)
        : leftNormal(dir);

    const holes: WallHole[] = [];
    for (const opening of openingsByEdge.get(edge.id) ?? []) {
      cutHole(holes, opening, length, height);
    }
    holes.sort((x, y) => x.start - y.start);

    solids.push({
      index,
      edgeId: edge.id,
      start: { x: a.x, y: a.y },
      dir,
      outward,
      length,
      height,
      holes,
      faces: adj.length,
      faceSides,
    });
  });
  return solids;
}

/**
 * The stretches a wall's cut-down stub still covers: holes reaching below the
 * stub top become full gaps — doors keep reading as openings in the low wall —
 * while windows (sill above the stub) don't cut it. Spans are edge-local,
 * sorted, disjoint.
 */
export function stubSpans(solid: WallSolid): Span[] {
  const gaps = solid.holes
    .filter((hole) => hole.bottom < STUB_WALL_HEIGHT)
    .sort((a, b) => a.start - b.start);
  const spans: Span[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start - cursor > MIN_HOLE_SIZE) {
      spans.push({ start: cursor, end: gap.start });
    }
    cursor = Math.max(cursor, gap.start + gap.width);
  }
  if (solid.length - cursor > MIN_HOLE_SIZE) {
    spans.push({ start: cursor, end: solid.length });
  }
  return spans;
}

/**
 * Filler posts at graph nodes where walls actually need one: junctions
 * (degree ≥ 3) and corners (degree 2, non-collinear). A straight pass-through
 * (degree 2, collinear) needs none — the two walls already coincide — and a
 * dangling end (degree 1) gets none either. `solids` must be the
 * `buildEdgeSolids` output for the floor.
 */
export function nodePosts(floor: Floor, solids: WallSolid[]): NodePost[] {
  const solidByEdge = new Map(solids.map((solid) => [solid.edgeId, solid]));
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const incident = new Map<
    string,
    Array<{ dir: Point; index: number; height: number }>
  >();
  const add = (nodeId: string, dir: Point, index: number, height: number) => {
    const list = incident.get(nodeId);
    if (list) list.push({ dir, index, height });
    else incident.set(nodeId, [{ dir, index, height }]);
  };
  for (const edge of floor.edges) {
    const solid = solidByEdge.get(edge.id);
    if (!solid) continue;
    add(edge.a, solid.dir, solid.index, solid.height);
    add(
      edge.b,
      { x: -solid.dir.x, y: -solid.dir.y },
      solid.index,
      solid.height,
    );
  }

  const posts: NodePost[] = [];
  for (const [nodeId, list] of incident) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (list.length < 2) continue;
    if (list.length === 2) {
      const dot = list[0].dir.x * list[1].dir.x + list[0].dir.y * list[1].dir.y;
      if (dot < -1 + 1e-6) continue; // collinear straight run — no post
    }
    posts.push({
      nodeId,
      center: { x: node.x, y: node.y },
      edgeIndices: list.map((entry) => entry.index),
      height: Math.max(...list.map((entry) => entry.height)),
    });
  }
  return posts;
}
