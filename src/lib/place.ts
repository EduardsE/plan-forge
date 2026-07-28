import {
  edgeSideHalves,
  type Floor,
  type FurnitureItem,
  type Point,
  WALL_THICKNESS,
} from "#/lib/model";

/**
 * Pure placement math for dragging a catalog item onto the floor (mockup
 * screen 1d): the ghost footprint's snapped center plus the distance guides
 * drawn beside it — to the nearest wall *and* the nearest placed item.
 * Rendering lives in the placement-ghost component.
 *
 * Walls come from the graph as `edgeWallObstacles` slabs. An axis-aligned wall
 * is a plain axis-aligned box (its face lands on a world axis, so the per-axis
 * snap/containment handles it); a non-axis wall carries an extra `oriented`
 * slab so it blocks and flush-snaps along its own tangent/normal — the
 * arbitrary-angle case the x/y decomposition can't see. Placed items snap
 * against their rotated footprint's axis-aligned bounding box, so a rotated
 * neighbor snaps to its hull. The dragged item is treated as unrotated on a
 * fresh drop (rotation happens after, via the selection toolbar); a move drag
 * passes its already rotated hull size.
 */

/** Wall-snap capture distance, meters (world units, zoom-independent). */
export const SNAP_TOLERANCE = 0.3;
/** Ghost centers quantize to this grid, meters (same as draw mode). */
export const PLACEMENT_GRID = 0.05;
/** Gaps below this read as flush — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const AXIS_EPSILON = 1e-6;
/** A box's tangential shadow must clear this to count as "facing" a slab. */
const SPAN_EPSILON = 1e-6;

export interface PlacementGuide {
  /** Axis the distance is measured along. */
  axis: "x" | "y";
  /**
   * Stable render key when several guides share an axis (the opening
   * corner guides, the angled-wall guides); per-axis guides omit it — their
   * axis is unique.
   */
  id?: string;
  /** On the wall's interior face, at the ghost's center on the other axis. */
  from: Point;
  /** On the ghost's near edge. */
  to: Point;
  /** Clearance between wall face and ghost edge, meters (> 0). */
  distance: number;
}

export interface PlacementSnap {
  center: Point;
  /** At most one guide per axis, to that axis's nearest wall. */
  guides: PlacementGuide[];
}

interface AxisWall {
  /** Wall line's coordinate on the measured axis. */
  coord: number;
  /** Wall segment's extent along the other axis. */
  spanMin: number;
  spanMax: number;
}

/**
 * An oriented wall slab: a wall stretch's centerline as a two-sided rectangle,
 * for the arbitrary-angle walls a world-axis box can't represent. Furniture is
 * blocked and flush-snapped along `n`, gated by its tangential overlap of the
 * stretch `[0, length]` along `t`.
 */
export interface OrientedSlab {
  /** Stable guide key; the per-axis guides omit ids, so these can't collide. */
  id: string;
  /** Start corner of the stretch centerline. */
  p0: Point;
  /** Unit tangent from `p0` toward the stretch end. */
  t: Point;
  /** Unit normal to `t` (the slab is symmetric, so either sense works). */
  n: Point;
  /** Centerline length of this stretch (the tangential span is [0, length]). */
  length: number;
  /** Half the wall thickness — the slab reaches ± this along `n`. */
  half: number;
}

/**
 * A rectangle a placed item snaps/collides against (plan coords): the
 * axis-aligned box `min`..`max`, plus — for a non-axis wall — an `oriented`
 * slab carrying the true angled geometry (the box is only its bounding hull).
 */
export interface Obstacle {
  min: Point;
  max: Point;
  /** Present for non-axis wall slabs; absent for furniture and axis walls. */
  oriented?: OrientedSlab;
}

/**
 * The rectangle a placed item presents to snapping: its rotated footprint's
 * axis-aligned bounding box, centered on the item. Reuses the same hull
 * `snapPlacement` treats a rotated *mover* as, so a turned neighbor snaps to
 * its bounding box rather than its true edges — exact at the toolbar's 90°
 * steps, conservative between.
 */
export function furnitureObstacle(item: FurnitureItem): Obstacle {
  const size = rotatedFootprintSize(item.footprint, item.rotation);
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  return {
    min: { x: item.position.x - halfW, y: item.position.y - halfD },
    max: { x: item.position.x + halfW, y: item.position.y + halfD },
  };
}

/** Axis-aligned bounding box of the four corners of a slab stretch. */
function slabBounds(p0: Point, p1: Point, n: Point, half: number): Obstacle {
  const xs = [
    p0.x + n.x * half,
    p0.x - n.x * half,
    p1.x + n.x * half,
    p1.x - n.x * half,
  ];
  const ys = [
    p0.y + n.y * half,
    p0.y - n.y * half,
    p1.y + n.y * half,
    p1.y - n.y * half,
  ];
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

/**
 * Every wall of the graph floor as a solid obstacle slab: the edge centerline
 * extruded to its wall body's per-side extents (`edgeSideHalves` — thickness
 * overrides included, a thick exterior wall bulking outward only), split at
 * door openings (a door span carries **no** slab at floor level, so furniture
 * passes through the gap) but not at windows (their sill sits above the
 * floor, so the slab stays whole). Axis edges yield a plain axis-aligned box;
 * a non-axis edge yields its bounding box plus an `oriented` slab so it still
 * blocks/flush-snaps along its own normal. This replaces
 * `outlineWallObstacles` in every placement/drag/nudge path: furniture is
 * floor-level now, so the room outline no longer clamps it — the wall slabs
 * do.
 */
export function edgeWallObstacles(floor: Floor): Obstacle[] {
  const sideHalves = edgeSideHalves(floor);
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const doorSpansByEdge = new Map<string, Array<[number, number]>>();
  for (const opening of floor.openings) {
    // Doors and passages reach the floor — furniture passes through them.
    if (opening.kind === "window") continue;
    const span: [number, number] = [
      opening.offset,
      opening.offset + opening.width,
    ];
    const list = doorSpansByEdge.get(opening.edgeId);
    if (list) list.push(span);
    else doorSpansByEdge.set(opening.edgeId, [span]);
  }

  const obstacles: Obstacle[] = [];
  floor.edges.forEach((edge, edgeIndex) => {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < AXIS_EPSILON) return;
    const vertical = Math.abs(dx) <= AXIS_EPSILON; // constant x
    const horizontal = Math.abs(dy) <= AXIS_EPSILON; // constant y
    const axis = vertical || horizontal;
    const dir = { x: dx / length, y: dy / length };
    const nrm = { x: dir.y, y: -dir.x }; // unit right normal
    // The right normal points toward side −1 (`sideOfPoint`), so the slab
    // reaches `neg` along +nrm and `pos` along −nrm.
    const halves = sideHalves.get(edge.id) ?? {
      pos: WALL_THICKNESS / 2,
      neg: WALL_THICKNESS / 2,
    };

    // Solid stretches = the full edge minus the door gaps on it.
    const doors = (doorSpansByEdge.get(edge.id) ?? [])
      .map(
        ([s, e]) =>
          [
            Math.max(0, Math.min(s, length)),
            Math.max(0, Math.min(e, length)),
          ] as [number, number],
      )
      .filter(([s, e]) => e - s > AXIS_EPSILON)
      .sort((p, q) => p[0] - q[0]);
    const spans: Array<[number, number]> = [];
    let cursor = 0;
    for (const [s, e] of doors) {
      if (s - cursor > AXIS_EPSILON) spans.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (length - cursor > AXIS_EPSILON) spans.push([cursor, length]);

    // Recenter on the wall body's mid-plane so an asymmetric band (a thick
    // exterior wall growing outward only) still reads as a symmetric slab.
    const shift = (halves.neg - halves.pos) / 2;
    const half = (halves.neg + halves.pos) / 2;
    spans.forEach(([s, e], spanIndex) => {
      const p0 = {
        x: a.x + dir.x * s + nrm.x * shift,
        y: a.y + dir.y * s + nrm.y * shift,
      };
      const p1 = {
        x: a.x + dir.x * e + nrm.x * shift,
        y: a.y + dir.y * e + nrm.y * shift,
      };
      if (axis) {
        const minX = Math.min(p0.x, p1.x);
        const maxX = Math.max(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const maxY = Math.max(p0.y, p1.y);
        obstacles.push(
          vertical
            ? {
                min: { x: minX - half, y: minY },
                max: { x: maxX + half, y: maxY },
              }
            : {
                min: { x: minX, y: minY - half },
                max: { x: maxX, y: maxY + half },
              },
        );
      } else {
        obstacles.push({
          ...slabBounds(p0, p1, nrm, half),
          oriented: {
            id: `wall-${edgeIndex}-${spanIndex}`,
            p0,
            t: dir,
            n: nrm,
            length: e - s,
            half,
          },
        });
      }
    });
  });
  return obstacles;
}

/** Iterations to settle a footprint out of overlapping wall slabs (a piece
 * wedged into a corner needs a few alternating pushes). */
const SEPARATE_PASSES = 8;

/** A box half-extent projected onto a unit direction (its support distance). */
function support(dir: Point, halfW: number, halfD: number): number {
  return Math.abs(dir.x) * halfW + Math.abs(dir.y) * halfD;
}

/**
 * Push the mover (AABB `center ± size/2`) out of one oriented wall slab along
 * its axis of least penetration (the slab's own normal or tangent), returning
 * the resolved center or `null` when they don't overlap. Reproduces the axis
 * box push exactly when the slab is axis-aligned, and carries the angled case.
 */
function separateOriented(
  slab: OrientedSlab,
  halfW: number,
  halfD: number,
  c: Point,
): Point | null {
  const relX = c.x - slab.p0.x;
  const relY = c.y - slab.p0.y;
  const tc = slab.t.x * relX + slab.t.y * relY;
  const dn = slab.n.x * relX + slab.n.y * relY;
  const sT = support(slab.t, halfW, halfD);
  const sN = support(slab.n, halfW, halfD);
  const halfLen = slab.length / 2;
  const penT = sT + halfLen - Math.abs(tc - halfLen);
  const penN = sN + slab.half - Math.abs(dn);
  if (penT <= AXIS_EPSILON || penN <= AXIS_EPSILON) return null;
  if (penN <= penT) {
    const sign = dn >= 0 ? 1 : -1;
    return { x: c.x + slab.n.x * penN * sign, y: c.y + slab.n.y * penN * sign };
  }
  const sign = tc - halfLen >= 0 ? 1 : -1;
  return { x: c.x + slab.t.x * penT * sign, y: c.y + slab.t.y * penT * sign };
}

/**
 * Push a footprint (the AABB `center ± size/2`) out of every wall slab
 * `obstacle` it penetrates, along each slab's axis of least penetration,
 * iterated so a piece pressed into a corner settles flush against both walls.
 * Axis slabs push along a world axis; oriented (angled) slabs push along their
 * own normal/tangent. Returns the resolved center — the same reference when
 * nothing overlapped.
 *
 * This is the hard boundary that replaced the room-outline clamp: an item may
 * sit anywhere no wall slab is (inside a room, in the dead band at a shared
 * wall, or out on the open canvas), it just can't tunnel through a wall.
 * Nudging a piece toward a wall pushes back to flush and stops.
 */
export function separateFromWalls(
  obstacles: Obstacle[],
  size: { width: number; depth: number },
  center: Point,
): Point {
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  let c = center;
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (const o of obstacles) {
      if (o.oriented) {
        const next = separateOriented(o.oriented, halfW, halfD, c);
        if (next) {
          c = next;
          moved = true;
        }
        continue;
      }
      const overlapX =
        Math.min(c.x + halfW, o.max.x) - Math.max(c.x - halfW, o.min.x);
      const overlapY =
        Math.min(c.y + halfD, o.max.y) - Math.max(c.y - halfD, o.min.y);
      if (overlapX <= AXIS_EPSILON || overlapY <= AXIS_EPSILON) continue;
      if (overlapX < overlapY) {
        const dir = c.x < (o.min.x + o.max.x) / 2 ? -1 : 1;
        c = { x: c.x + dir * overlapX, y: c.y };
      } else {
        const dir = c.y < (o.min.y + o.max.y) / 2 ? -1 : 1;
        c = { x: c.x, y: c.y + dir * overlapY };
      }
      moved = true;
    }
    if (!moved) break;
  }
  return c;
}

function quantize(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * Axis-aligned bounding size of a footprint spun by `rotation` degrees — what
 * snapping should treat as the item's width/depth when the item is already
 * rotated (a move drag, unlike a fresh drop, starts from a rotated item).
 * Exact for the toolbar's 90° steps; a conservative hull at other angles.
 */
export function rotatedFootprintSize(
  size: { width: number; depth: number },
  rotationDeg: number,
): { width: number; depth: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: size.width * cos + size.depth * sin,
    depth: size.width * sin + size.depth * cos,
  };
}

/** Cross-axis overlap must be real, not a shared edge, for two items to be "beside". */
const OVERLAP_EPSILON = 1e-4;

/**
 * The placed-item faces the mover can snap flush against on `axis`, given its
 * current center there and its `across` position (with `crossHalf` extent) on
 * the other axis. Emitted only when the two footprints overlap on the other
 * axis *and* the mover already sits wholly to one side of the item on this
 * one — the single near face of a genuine side-by-side, so the mover never
 * gets shoved along the axis it already overlaps (which would drive it *into*
 * the neighbor). Pre-gated, so the span is left open and `nearestWall`
 * measures the flush gap exactly as it does for a wall. Callers pass only
 * furniture/axis-wall boxes here — oriented slabs snap through their own pass.
 */
function objectFaces(
  obstacles: Obstacle[],
  axis: "x" | "y",
  center: number,
  across: number,
  crossHalf: number,
): AxisWall[] {
  const other = axis === "x" ? "y" : "x";
  const moverMin = across - crossHalf;
  const moverMax = across + crossHalf;
  const faces: AxisWall[] = [];
  for (const obstacle of obstacles) {
    if (moverMax <= obstacle.min[other] + OVERLAP_EPSILON) continue;
    if (moverMin >= obstacle.max[other] - OVERLAP_EPSILON) continue;
    let coord: number | null = null;
    if (center < obstacle.min[axis]) coord = obstacle.min[axis];
    else if (center > obstacle.max[axis]) coord = obstacle.max[axis];
    if (coord === null) continue;
    faces.push({
      coord,
      spanMin: Number.NEGATIVE_INFINITY,
      spanMax: Number.POSITIVE_INFINITY,
    });
  }
  return faces;
}

interface NearestWall {
  coord: number;
  /** Signed clearance from the ghost edge facing the wall to the wall face. */
  gap: number;
  /** Which side of the ghost the wall is on. */
  side: -1 | 1;
}

function nearestWall(
  walls: AxisWall[],
  center: number,
  across: number,
  half: number,
): NearestWall | null {
  let best: NearestWall | null = null;
  for (const wall of walls) {
    if (across < wall.spanMin || across > wall.spanMax) continue;
    const side: -1 | 1 = wall.coord <= center ? -1 : 1;
    const gap =
      side === -1 ? center - half - wall.coord : wall.coord - (center + half);
    if (best === null || Math.abs(gap) < Math.abs(best.gap)) {
      best = { coord: wall.coord, gap, side };
    }
  }
  return best;
}

/**
 * Snap one axis of the ghost center flush to the nearest placed-item face
 * within tolerance. Quantize happened upstream; walls are handled by the
 * oriented pass, so only the neighbour boxes participate here.
 */
function snapAxis(
  obstacles: Obstacle[],
  axis: "x" | "y",
  center: number,
  across: number,
  half: number,
  crossHalf: number,
  tolerance: number,
): number {
  const lines = objectFaces(obstacles, axis, center, across, crossHalf);
  const wall = nearestWall(lines, center, across, half);
  if (wall && Math.abs(wall.gap) <= tolerance) {
    return wall.side === -1 ? wall.coord + half : wall.coord - half;
  }
  return center;
}

function guideFor(
  obstacles: Obstacle[],
  axis: "x" | "y",
  center: Point,
  half: number,
  crossHalf: number,
): PlacementGuide | null {
  const alongCenter = axis === "x" ? center.x : center.y;
  const across = axis === "x" ? center.y : center.x;
  const lines = objectFaces(obstacles, axis, alongCenter, across, crossHalf);
  const wall = nearestWall(lines, alongCenter, across, half);
  if (!wall || wall.gap < FLUSH_EPSILON) return null;
  const edge = alongCenter + (wall.side === -1 ? -half : half);
  const point = (along: number): Point =>
    axis === "x" ? { x: along, y: across } : { x: across, y: along };
  return {
    axis,
    from: point(wall.coord),
    to: point(edge),
    distance: wall.gap,
  };
}

/** Signed clearance from the box centered at `c` to a slab, along its normal,
 * plus the tangential-overlap gate. `sign` is which face of the slab the box
 * is on. `gap > 0` clears the slab; `gap < 0` penetrates it. */
function slabGap(
  slab: OrientedSlab,
  c: Point,
  halfW: number,
  halfD: number,
): { gap: number; sign: 1 | -1; sN: number; faces: boolean } {
  const relX = c.x - slab.p0.x;
  const relY = c.y - slab.p0.y;
  const tc = slab.t.x * relX + slab.t.y * relY;
  const sT = support(slab.t, halfW, halfD);
  const faces = tc + sT > SPAN_EPSILON && tc - sT < slab.length - SPAN_EPSILON;
  const dn = slab.n.x * relX + slab.n.y * relY;
  const sN = support(slab.n, halfW, halfD);
  return {
    gap: Math.abs(dn) - slab.half - sN,
    sign: dn >= 0 ? 1 : -1,
    sN,
    faces,
  };
}

/**
 * Flush-snap the box to any oriented wall slab it faces from just outside,
 * within tolerance — the angled-wall analogue of the per-axis flush. Only pulls
 * the box *toward* a wall it's already clear of (a negative gap = penetration
 * is left to `separateFromWalls`). Iterated so a box settling into an angled
 * corner takes a few passes.
 */
function applyWallFlush(
  walls: Obstacle[],
  center: Point,
  halfW: number,
  halfD: number,
  tolerance: number,
): Point {
  let c = center;
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (const o of walls) {
      const slab = o.oriented;
      if (!slab) continue;
      const { gap, sign, faces } = slabGap(slab, c, halfW, halfD);
      if (!faces || gap <= 0 || gap > tolerance) continue;
      c = { x: c.x - slab.n.x * sign * gap, y: c.y - slab.n.y * sign * gap };
      moved = true;
    }
    if (!moved) break;
  }
  return c;
}

/**
 * Clearance guides to the nearest oriented walls the box isn't flush against —
 * the same perpendicular line + pill as the axis guides, drawn along the wall's
 * normal. Capped at the two nearest so a many-walled room stays legible.
 */
function wallGuides(
  walls: Obstacle[],
  center: Point,
  halfW: number,
  halfD: number,
): PlacementGuide[] {
  return walls
    .flatMap((o) => (o.oriented ? [o.oriented] : []))
    .map((slab) => ({ slab, ...slabGap(slab, center, halfW, halfD) }))
    .filter((entry) => entry.faces && entry.gap >= FLUSH_EPSILON)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 2)
    .map(({ slab, gap, sign, sN }) => ({
      axis: Math.abs(slab.n.x) >= Math.abs(slab.n.y) ? "x" : "y",
      id: slab.id,
      from: {
        x: center.x - slab.n.x * sign * (sN + gap),
        y: center.y - slab.n.y * sign * (sN + gap),
      },
      to: {
        x: center.x - slab.n.x * sign * sN,
        y: center.y - slab.n.y * sign * sN,
      },
      distance: gap,
    }));
}

/**
 * Where a catalog footprint dragged to `cursor` actually lands: the center
 * quantizes to the placement grid, then sticks flush to the nearest snap line —
 * an axis-aligned wall/neighbour face or a non-axis wall's slab — within
 * `tolerance`; `guides` carry the per-axis and per-angled-wall clearance to
 * whichever line is nearest, left to render. `obstacles` are the placed-item
 * boxes plus the graph's wall slabs (`edgeWallObstacles`); the hard boundary
 * (a piece can't tunnel through a wall) is `separateFromWalls`, run by the
 * caller after this.
 *
 * With `snap` off (the snap toggle), the raw cursor passes through unquantized
 * and no flush snapping fires (no guides).
 */
export function snapPlacement(
  size: { width: number; depth: number },
  cursor: Point,
  obstacles: Obstacle[] = [],
  tolerance: number = SNAP_TOLERANCE,
  grid: number = PLACEMENT_GRID,
  snap = true,
): PlacementSnap {
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  const boxes = obstacles.filter((o) => !o.oriented);
  const walls = obstacles.filter((o) => o.oriented);

  // Snap off: skip quantize and drop the flush tolerance to zero so nothing
  // pulls flush (a zero gap never triggers a flush pull); containment is the
  // caller's `separateFromWalls`.
  const flushTolerance = snap ? tolerance : 0;
  const quantized = snap
    ? { x: quantize(cursor.x, grid), y: quantize(cursor.y, grid) }
    : { x: cursor.x, y: cursor.y };
  // halfD is the mover's cross extent when measuring along x; halfW along y.
  const center: Point = {
    x: snapAxis(
      boxes,
      "x",
      quantized.x,
      quantized.y,
      halfW,
      halfD,
      flushTolerance,
    ),
    y: 0,
  };
  center.y = snapAxis(
    boxes,
    "y",
    quantized.y,
    center.x,
    halfD,
    halfW,
    flushTolerance,
  );

  // Non-axis walls, handled after the x/y pass: flush-snap along each wall's
  // own normal.
  const placed =
    walls.length > 0
      ? applyWallFlush(walls, center, halfW, halfD, flushTolerance)
      : center;

  // Snap off: no flush snap and so no clearance guides.
  if (!snap) return { center: placed, guides: [] };

  const guides: PlacementGuide[] = [];
  const guideX = guideFor(boxes, "x", placed, halfW, halfD);
  if (guideX) guides.push(guideX);
  const guideY = guideFor(boxes, "y", placed, halfD, halfW);
  if (guideY) guides.push(guideY);
  guides.push(...wallGuides(walls, placed, halfW, halfD));
  return { center: placed, guides };
}
