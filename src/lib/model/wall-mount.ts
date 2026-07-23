import { catalogItemById } from "./catalog";
import { WALL_THICKNESS, wallsOf } from "./geometry";
import type { WallEdge, WallNode } from "./graph";
import type { Point, WallMount } from "./types";

/**
 * Pure geometry for wall-mounted furniture (picture frames, clocks): the plan
 * transform a mount resolves into, plus the wall frames a *derived* room's
 * outline exposes (still handy for outline-space rendering/hit-testing).
 * Rendering-agnostic like the rest of the model — placement snapping (nearest
 * edge, offset clamping, guide pills) lives in `src/lib/mount-place.ts`.
 *
 * A mount is anchored to a graph **edge**: a near-edge `offset` along a→b, the
 * `side` it hangs on, and a vertical `elevation`. `deriveMountTransform` turns
 * that into the item's plan `position` (centered on the wall, pushed off the
 * edge centerline by half the wall plus half its depth, so its back sits flush
 * on the interior face) and `rotation` (its width axis aligned to the edge).
 */

const EPS = 1e-9;

/** A wall reduced to the frame a mount needs: no holes, no thickness. */
export interface WallFrame {
  /** Plan position of the wall's start corner. */
  start: Point;
  /** Unit direction along the wall, start → end. */
  dir: Point;
  /** Unit normal pointing away from the room interior. */
  outward: Point;
  length: number;
}

/** A `WallFrame` tagged with its outline wall index. */
export interface MountFrame extends WallFrame {
  index: number;
}

/** Twice the signed area; its sign encodes the outline winding. */
function signedDoubleArea(outline: Point[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * The wall frames of a closed outline, indexed by wall index. Mirrors the
 * outward-normal derivation in `room-scene.ts` (interior on the wall's left
 * for the sample's winding). Degenerate outlines (< 3 corners) yield no frames.
 */
export function wallFrames(outline: Point[]): MountFrame[] {
  if (outline.length < 3) return [];
  const winding = Math.sign(signedDoubleArea(outline)) || 1;
  const frames: MountFrame[] = [];
  for (const wall of wallsOf(outline)) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < EPS) continue;
    const dir = { x: dx / length, y: dy / length };
    // `+ 0` folds the -0 the sign flips produce on axis-aligned walls.
    const outward = { x: dir.y * winding + 0, y: -dir.x * winding + 0 };
    frames.push({ index: wall.index, start: wall.start, dir, outward, length });
  }
  return frames;
}

/** Center elevations for a freshly mounted item, by catalog id (meters). */
const MOUNT_ELEVATIONS: Record<string, number> = {
  "picture-frame": 1.5,
  "wall-clock": 1.9,
  // A wall-mounted TV hangs with its center around seated eye level.
  tv: 1.2,
};
export const DEFAULT_MOUNT_ELEVATION = 1.5;

/** The default center height a fresh wall mount hangs at, by catalog id. */
export function defaultMountElevation(catalogId: string): number {
  return MOUNT_ELEVATIONS[catalogId] ?? DEFAULT_MOUNT_ELEVATION;
}

/** Whether a catalog item mounts to a wall (the "wall-items" category). */
export function isWallItem(catalogId: string): boolean {
  return catalogItemById(catalogId)?.category === "wall-items";
}

/** The graph geometry `deriveMountTransform` reads. */
export interface EdgeGraph {
  nodes: WallNode[];
  edges: WallEdge[];
}

/**
 * The plan `position` and `rotation` a mount resolves to against the graph:
 * the item centered `offset + width/2` along its edge (a→b), pushed
 * `WALL_THICKNESS / 2 + depth / 2` toward `side` so its back sits on the
 * interior face, with its width axis turned to the edge direction. Null when
 * the edge (or its nodes) is gone, or degenerate.
 */
export function deriveMountTransform(
  mount: WallMount,
  graph: EdgeGraph,
  footprint: { width: number; depth: number },
): { position: Point; rotation: number } | null {
  const edge = graph.edges.find((e) => e.id === mount.edgeId);
  if (!edge) return null;
  const a = graph.nodes.find((n) => n.id === edge.a);
  const b = graph.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return null;
  const dir = { x: dx / length, y: dy / length };
  // Left normal (−dir.y, dir.x) points to `side === 1` (positive cross
  // product); `side` picks which face the mount hangs on.
  const normal = { x: -dir.y * mount.side, y: dir.x * mount.side };
  // Keep the item on the edge even if an edit (duplicate, reshape) nudged its
  // offset past the end — the transform is the flush truth, re-derived here.
  const offset = Math.min(
    Math.max(mount.offset, 0),
    Math.max(0, length - footprint.width),
  );
  const centerAlong = offset + footprint.width / 2;
  const push = WALL_THICKNESS / 2 + footprint.depth / 2;
  const position = {
    x: a.x + dir.x * centerAlong + normal.x * push,
    y: a.y + dir.y * centerAlong + normal.y * push,
  };
  const deg = (Math.atan2(-dir.y, dir.x) * 180) / Math.PI;
  const rotation = ((deg % 360) + 360) % 360;
  return { position, rotation };
}
