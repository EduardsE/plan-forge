import { Path, Shape } from "three";
import type { DerivedRoom } from "#/lib/model";
import {
  DEFAULT_PANE_COLS,
  DEFAULT_PANE_ROWS,
  DEFAULT_WALL_HEIGHT,
  DOOR_HEIGHT,
  type Floor,
  type Opening,
  openingPaneGrid,
  openingSill,
  openingVerticals,
  type Point,
  SLAB_THICKNESS,
  WALL_THICKNESS,
  WINDOW_HEAD,
  WINDOW_SILL,
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
 * `model/types.ts`). Opening vertical extents live on the model now
 * (`Opening.sill`/`head`, defaults in `model/openings.ts`).
 */

/** Default wall height; rooms can override it (`Room.wallHeight`). */
export const WALL_HEIGHT = DEFAULT_WALL_HEIGHT;
export {
  DOOR_HEIGHT,
  SLAB_THICKNESS,
  WALL_THICKNESS,
  WINDOW_HEAD,
  WINDOW_SILL,
};
/**
 * Height of a cut-down wall in the dollhouse cutaway (Sims-style): occluding
 * walls drop to this stub instead of hiding, tall enough to read as a wall
 * (baseboard + a sliver of face), low enough to keep furniture visible.
 */
export const STUB_WALL_HEIGHT = 0.3;

const MIN_HOLE_SIZE = 1e-6;

/**
 * Cutaway threshold on the wall-to-camera facing dot: slightly negative so
 * near-edge-on walls cut down too instead of lingering as slivers.
 */
export const HIDE_FACING_THRESHOLD = -0.06;
/** Above this upness the camera is plan-like and every wall stays full. */
export const PLAN_UPNESS = 0.94;

/**
 * Whether the dollhouse cutaway keeps `solid` at full height for a camera at
 * `camera` (floor-local: x/z are plan coordinates, y up from this storey's
 * floor). One implementation for the per-frame wall display and the pointer
 * ray-pick (`mountAtRay`), so what placement hits is what the user sees: a
 * two-face wall always stubs while orbiting, a 0/1-face wall stubs only when
 * it faces the camera, and a plan-like (near-overhead) view keeps every wall
 * full.
 */
export function wallStandsFull(
  solid: WallSolid,
  camera: { x: number; y: number; z: number },
): boolean {
  const midX = solid.start.x + (solid.dir.x * solid.length) / 2;
  const midZ = solid.start.y + (solid.dir.y * solid.length) / 2;
  const toCamX = camera.x - midX;
  const toCamY = camera.y - solid.height / 2;
  const toCamZ = camera.z - midZ;
  const distance = Math.hypot(toCamX, toCamY, toCamZ) || 1;
  const facing =
    (toCamX * solid.outward.x + toCamZ * solid.outward.y) / distance;
  const planLike = toCamY / distance > PLAN_UPNESS;
  return planLike || (solid.faces < 2 && facing < HIDE_FACING_THRESHOLD);
}

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
  /** Windows only: resolved sill overhang past the interior face, meters. */
  sillOverhang?: number;
  /** Windows only: resolved sill board material. */
  sillMaterial?: "white" | "wood";
  /** Windows only: resolved pane columns of the frame grid. */
  paneCols?: number;
  /** Windows only: resolved pane rows of the frame grid. */
  paneRows?: number;
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
   * else the `+1` (`sideOfPoint`-positive) normal. The wall body sits
   * `outwardShift` along this normal (symmetric only when the shift is 0), so
   * it both orients symbols/dressing and directs the band's offset.
   */
  outward: Point;
  length: number;
  /** Wall/ceiling height: max of the adjacent rooms, DEFAULT for none. */
  height: number;
  /** Effective wall thickness (per-edge override, any adjacency). */
  thickness: number;
  /**
   * Signed offset of the body's mid-plane from the edge centerline along
   * `outward`, meters. Zero for default/symmetric walls; positive when a
   * thickened 1-face wall bulks outward, negative when a thinned one pulls
   * in — either way the interior face stays pinned at WALL_THICKNESS / 2.
   */
  outwardShift: number;
  /** +1 when `outward` is the leftNormal of `dir`, −1 for the rightNormal.
   * Converts outward-coordinates to the 3D wall-local z axis (which is the
   * leftNormal): localZ = outwardSign * outwardCoordinate. */
  outwardSign: 1 | -1;
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
  /** Plan-coordinate polygon (4 corners) the post fills: the span of each
   * principal incident wall's band (interior face → exterior face), so a
   * thickened wall's corner is covered; exterior overshoot is acceptable. */
  corners: Point[];
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
  const verticals = openingVerticals(opening);
  const bottom = Math.max(verticals.bottom, 0);
  const top = Math.min(verticals.top, height);
  if (end - start < MIN_HOLE_SIZE || top - bottom < MIN_HOLE_SIZE) return;
  const sill = opening.kind === "window" ? openingSill(opening) : null;
  const grid = opening.kind === "window" ? openingPaneGrid(opening) : null;
  holes.push({
    id: opening.id,
    kind: opening.kind,
    start,
    width: end - start,
    bottom,
    top,
    ...(opening.hinge ? { hinge: opening.hinge } : {}),
    side: opening.side,
    ...(sill
      ? { sillOverhang: sill.overhang, sillMaterial: sill.material }
      : {}),
    ...(grid ? { paneCols: grid.cols, paneRows: grid.rows } : {}),
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

    // Effective thickness: the per-edge override, everywhere. A 1-face wall
    // grows outward — interior face pinned at WALL_THICKNESS / 2, so the room
    // interior doesn't move — while a shared (2-face) or dangling edge grows
    // symmetrically about the centerline (each room yields half). Mirrors
    // `edgeSideHalves` (model/faces.ts), which room insets/collision/mounts
    // read.
    const thickness = edge.thickness ?? WALL_THICKNESS;
    const outwardShift =
      adj.length === 1 ? (thickness - WALL_THICKNESS) / 2 : 0;
    const outwardSign: 1 | -1 = adj.length === 1 && faceSides[0] === 1 ? -1 : 1;

    solids.push({
      index,
      edgeId: edge.id,
      start: { x: a.x, y: a.y },
      dir,
      outward,
      length,
      height,
      thickness,
      outwardShift,
      outwardSign,
      holes,
      faces: adj.length,
      faceSides,
    });
  });
  return solids;
}

/** Outward-coordinate extents of a wall body (use with `wallPoint`). */
export function wallBandRange(solid: WallSolid): {
  inner: number;
  outer: number;
} {
  return {
    inner: solid.outwardShift - solid.thickness / 2,
    outer: solid.outwardShift + solid.thickness / 2,
  };
}

/** Outward-coordinate of the wall face on leftNormal-signed `side`. */
export function faceOutwardOffset(solid: WallSolid, side: 1 | -1): number {
  return solid.outwardShift + solid.outwardSign * side * (solid.thickness / 2);
}

/** 3D wall-local z where the extrusion (local 0..thickness) starts. */
export function wallZOffset(solid: WallSolid): number {
  return solid.outwardSign * solid.outwardShift - solid.thickness / 2;
}

/** 3D wall-local z of the body's mid-plane. */
export function wallZCenter(solid: WallSolid): number {
  return solid.outwardSign * solid.outwardShift;
}

/** Depth of the window unit (frame + glass) within the wall. */
export function windowUnitDepth(solid: WallSolid): number {
  return Math.min(WALL_THICKNESS, solid.thickness);
}

/**
 * 3D wall-local z of the window unit's center plane: the unit occupies the
 * outer `windowUnitDepth` of the wall — flush against the face opposite the
 * hole's room side — leaving the interior reveal for the sill. On a default
 * 10 cm wall this is the wall center (today's placement, unchanged).
 */
export function windowUnitZ(
  solid: WallSolid,
  hole: Pick<WallHole, "side">,
): number {
  const farFace = wallZCenter(solid) - hole.side * (solid.thickness / 2);
  return farFace + hole.side * (windowUnitDepth(solid) / 2);
}

/** Border frame bar size of a window unit, meters. */
export const WINDOW_FRAME_SIZE = 0.09;
/** Muntin (pane divider) bar thickness, meters. */
const MUNTIN_SIZE = 0.06;

/** The frame/muntin bar layout of one window hole (wall-local): [key, x, y,
 * width, height, depth]. Shared by the visible dressing and the shadow
 * proxy, so the muntin grid in the sun patch matches the drawn frame. The
 * hole's resolved pane grid decides the muntins: cols−1 vertical and
 * rows−1 horizontal bars, evenly spaced inside the border frame. */
export function windowBars(
  solid: WallSolid,
  hole: WallHole,
): Array<[string, number, number, number, number, number]> {
  const f = WINDOW_FRAME_SIZE;
  const cx = hole.start + hole.width / 2;
  const cy = (hole.bottom + hole.top) / 2;
  const height = hole.top - hole.bottom;
  const unit = windowUnitDepth(solid);
  const frameDepth = unit + 0.02;
  // Frame bars sit inside the hole, border-box style; the muntins stay
  // within the unit's depth.
  const bars: Array<[string, number, number, number, number, number]> = [
    ["sill", cx, hole.bottom + f / 2, hole.width, f, frameDepth],
    ["head", cx, hole.top - f / 2, hole.width, f, frameDepth],
    ["jamb-l", hole.start + f / 2, cy, f, height - 2 * f, frameDepth],
    [
      "jamb-r",
      hole.start + hole.width - f / 2,
      cy,
      f,
      height - 2 * f,
      frameDepth,
    ],
  ];
  const cols = hole.paneCols ?? DEFAULT_PANE_COLS;
  const rows = hole.paneRows ?? DEFAULT_PANE_ROWS;
  const innerWidth = hole.width - 2 * f;
  const innerHeight = height - 2 * f;
  for (let i = 1; i < cols; i++) {
    const x = hole.start + f + (innerWidth * i) / cols;
    bars.push([`muntin-v${i}`, x, cy, MUNTIN_SIZE, innerHeight, unit]);
  }
  for (let j = 1; j < rows; j++) {
    const y = hole.bottom + f + (innerHeight * j) / rows;
    bars.push([`muntin-h${j}`, cx, y, innerWidth, MUNTIN_SIZE, unit]);
  }
  return bars;
}

/** Sill board thickness (drops below the hole bottom), meters. */
export const SILL_THICKNESS = 0.04;
/** How far the board extends past the hole on each side, meters. */
export const SILL_EAR = 0.04;

/** One window's sill board, in wall-local coordinates (x along the wall,
 * y up from the floor, z on the local leftNormal axis). */
export interface SillBox {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  material: "white" | "wood";
}

/**
 * The sill board of a window hole: top face flush with `hole.bottom`, running
 * from the window unit's interior face to `sillOverhang` past the interior
 * wall face on the hole's room side (`hole.side`), with `SILL_EAR` ears. Null
 * for doors, and when the board would be zero-deep (default-thickness wall
 * with overhang 0 — no reveal, nothing to draw).
 */
export function sillBox(solid: WallSolid, hole: WallHole): SillBox | null {
  if (hole.kind !== "window") return null;
  const overhang = hole.sillOverhang ?? 0;
  const depth = solid.thickness - windowUnitDepth(solid) + overhang;
  if (depth < MIN_HOLE_SIZE) return null;
  const unitInterior =
    windowUnitZ(solid, hole) + hole.side * (windowUnitDepth(solid) / 2);
  return {
    x: hole.start + hole.width / 2,
    y: hole.bottom - SILL_THICKNESS / 2,
    z: unitInterior + hole.side * (depth / 2),
    width: hole.width + 2 * SILL_EAR,
    height: SILL_THICKNESS,
    depth,
    material: hole.sillMaterial ?? "white",
  };
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
    Array<{ dir: Point; index: number; height: number; solid: WallSolid }>
  >();
  const add = (
    nodeId: string,
    dir: Point,
    index: number,
    height: number,
    solid: WallSolid,
  ) => {
    const list = incident.get(nodeId);
    if (list) list.push({ dir, index, height, solid });
    else incident.set(nodeId, [{ dir, index, height, solid }]);
  };
  for (const edge of floor.edges) {
    const solid = solidByEdge.get(edge.id);
    if (!solid) continue;
    add(edge.a, solid.dir, solid.index, solid.height, solid);
    add(
      edge.b,
      { x: -solid.dir.x, y: -solid.dir.y },
      solid.index,
      solid.height,
      solid,
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
    // Principal axes: the first incident wall, and the first whose outward
    // is not parallel to it. Ranges start as each wall's own band and are
    // widened by any further incident wall on the nearer axis.
    const a = list[0].solid;
    const b =
      list.find(
        (entry) =>
          Math.abs(
            entry.solid.outward.x * a.outward.y -
              entry.solid.outward.y * a.outward.x,
          ) > 1e-6,
      )?.solid ?? null;
    const axisA = a.outward;
    const axisB = b ? b.outward : { x: -a.outward.y, y: a.outward.x };
    const bandA = wallBandRange(a);
    const rangeA = { lo: bandA.inner, hi: bandA.outer };
    const rangeB = b
      ? { lo: wallBandRange(b).inner, hi: wallBandRange(b).outer }
      : { lo: -WALL_THICKNESS / 2, hi: WALL_THICKNESS / 2 };
    for (const entry of list) {
      if (entry.solid === a || entry.solid === b) continue;
      const band = wallBandRange(entry.solid);
      const dotA =
        entry.solid.outward.x * axisA.x + entry.solid.outward.y * axisA.y;
      const dotB =
        entry.solid.outward.x * axisB.x + entry.solid.outward.y * axisB.y;
      const [axisDot, range] =
        Math.abs(dotA) >= Math.abs(dotB) ? [dotA, rangeA] : [dotB, rangeB];
      const mapped = [band.inner * axisDot, band.outer * axisDot];
      range.lo = Math.min(range.lo, ...mapped);
      range.hi = Math.max(range.hi, ...mapped);
    }
    const corner = (u: number, v: number): Point => ({
      x: node.x + axisA.x * u + axisB.x * v,
      y: node.y + axisA.y * u + axisB.y * v,
    });
    posts.push({
      nodeId,
      center: { x: node.x, y: node.y },
      corners: [
        corner(rangeA.lo, rangeB.lo),
        corner(rangeA.hi, rangeB.lo),
        corner(rangeA.hi, rangeB.hi),
        corner(rangeA.lo, rangeB.hi),
      ],
      edgeIndices: list.map((entry) => entry.index),
      height: Math.max(...list.map((entry) => entry.height)),
    });
  }
  return posts;
}

/**
 * A capped lower storey's ceiling slab, ready to extrude: the room's interior
 * outline as a three `Shape`, with one `Path` hole per void in `holes` (empty
 * until V7 wires stair voids through). Plan y is mirrored to world z, the same
 * convention `Platform`'s `planShape` uses, so the caller can extrude it the
 * same way (rotate -90° about x, sink by the extrusion depth to land the top
 * cap where it belongs). Null for a degenerate (< 3 point) outline.
 */
export function ceilingSlabShape(
  outline: Point[],
  holes: Point[][],
): { shape: Shape } | null {
  if (outline.length < 3) return null;
  const shape = new Shape();
  for (const [i, point] of outline.entries()) {
    if (i === 0) shape.moveTo(point.x, -point.y);
    else shape.lineTo(point.x, -point.y);
  }
  shape.closePath();
  for (const hole of holes) {
    if (hole.length < 3) continue;
    const path = new Path();
    for (const [i, point] of hole.entries()) {
      if (i === 0) path.moveTo(point.x, -point.y);
      else path.lineTo(point.x, -point.y);
    }
    path.closePath();
    shape.holes.push(path);
  }
  return { shape };
}

/**
 * Sun azimuth for a floor with no glazing at all: opposite the initial orbit,
 * so an unglazed model still shades from its far side on first load.
 */
const DEFAULT_SUN_AZIMUTH = (232 * Math.PI) / 180;

/**
 * World-fixed sun anchor azimuth (radians, `atan2(z, x)` in world space =
 * `atan2(y, x)` in plan space): the outward normal of the wall carrying the
 * largest total window area, so the sun sits outside the most-glazed wall and
 * shines in through it. The room and its light stay put while the camera
 * orbits; presets swing their rake around this anchor as the day's arc.
 */
export function sunAnchorAzimuth(solids: WallSolid[]): number {
  let bestArea = 0;
  let azimuth = DEFAULT_SUN_AZIMUTH;
  for (const solid of solids) {
    let area = 0;
    for (const hole of solid.holes) {
      if (hole.kind === "window") area += hole.width * (hole.top - hole.bottom);
    }
    if (area > bestArea) {
      bestArea = area;
      azimuth = Math.atan2(solid.outward.y, solid.outward.x);
    }
  }
  return azimuth;
}
