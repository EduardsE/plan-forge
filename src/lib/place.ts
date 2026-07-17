import {
  type Floor,
  type FurnitureItem,
  outlineBounds,
  type Point,
  WALL_THICKNESS,
  wallsOf,
} from "#/lib/model";

/**
 * Pure placement math for dragging a catalog item onto the floor (mockup
 * screen 1d): the ghost footprint's snapped center plus the distance guides
 * drawn beside it — to the nearest wall *and* the nearest placed item.
 * Rendering lives in the placement-ghost component.
 *
 * Axis-aligned walls (the common case — draw mode snaps to 90°) go through a
 * fast per-axis x/y decomposition; non-axis walls get a general half-plane
 * pass (`angledWalls`) that both contains the footprint and flush-snaps it
 * along the wall's own normal. Placed items snap against their rotated
 * footprint's axis-aligned bounding box, so a rotated neighbor snaps to its
 * hull. The dragged item is treated as unrotated on a fresh drop (rotation
 * happens after, via the selection toolbar); a move drag passes its already
 * rotated hull size.
 */

/** Wall-snap capture distance, meters (world units, zoom-independent). */
export const SNAP_TOLERANCE = 0.3;
/** Ghost centers quantize to this grid, meters (same as draw mode). */
export const PLACEMENT_GRID = 0.05;
/** Gaps below this read as flush — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const AXIS_EPSILON = 1e-6;

export interface PlacementGuide {
  /** Axis the distance is measured along. */
  axis: "x" | "y";
  /**
   * Stable render key when several guides share an axis (the opening
   * corner guides); wall guides omit it — their axis is unique.
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

/** Axis-aligned rectangle a placed item snaps against (plan coords). */
export interface Obstacle {
  min: Point;
  max: Point;
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

/**
 * Every wall of the graph floor as a solid obstacle slab: the edge centerline
 * extruded ± `WALL_THICKNESS / 2`, split at door openings (a door span carries
 * **no** slab at floor level, so furniture passes through the gap) but not at
 * windows (their sill sits above the floor, so the slab stays whole). Only
 * axis-aligned edges become obstacles — the same mainline restriction the old
 * outline path had. This replaces `outlineWallObstacles` in every
 * placement/drag/nudge path: furniture is floor-level now, so the room outline
 * no longer clamps it — the wall solids do.
 */
export function edgeWallObstacles(floor: Floor): Obstacle[] {
  const half = WALL_THICKNESS / 2;
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const doorSpansByEdge = new Map<string, Array<[number, number]>>();
  for (const opening of floor.openings) {
    if (opening.kind !== "door") continue;
    const span: [number, number] = [
      opening.offset,
      opening.offset + opening.width,
    ];
    const list = doorSpansByEdge.get(opening.edgeId);
    if (list) list.push(span);
    else doorSpansByEdge.set(opening.edgeId, [span]);
  }

  const obstacles: Obstacle[] = [];
  for (const edge of floor.edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < AXIS_EPSILON) continue;
    const vertical = Math.abs(dx) <= AXIS_EPSILON; // constant x
    const horizontal = Math.abs(dy) <= AXIS_EPSILON; // constant y
    if (!vertical && !horizontal) continue; // non-axis walls skipped
    const dir = { x: dx / length, y: dy / length };

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

    for (const [s, e] of spans) {
      const p0 = { x: a.x + dir.x * s, y: a.y + dir.y * s };
      const p1 = { x: a.x + dir.x * e, y: a.y + dir.y * e };
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
    }
  }
  return obstacles;
}

/** Iterations to settle a footprint out of overlapping wall slabs (a piece
 * wedged into a corner needs a few alternating pushes). */
const SEPARATE_PASSES = 8;

/**
 * Push a footprint (the AABB `center ± size/2`) out of every wall-slab
 * `obstacle` it penetrates, along each slab's axis of least penetration,
 * iterated so a piece pressed into a corner settles flush against both walls.
 * Returns the resolved center — the same reference when nothing overlapped.
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

/** Walls perpendicular to `axis` (vertical walls for "x", horizontal for "y"). */
function axisWalls(outline: Point[], axis: "x" | "y"): AxisWall[] {
  const across = axis === "x" ? "y" : "x";
  const walls: AxisWall[] = [];
  for (const wall of wallsOf(outline)) {
    if (Math.abs(wall.start[axis] - wall.end[axis]) > AXIS_EPSILON) continue;
    const a = wall.start[across];
    const b = wall.end[across];
    if (Math.abs(a - b) < AXIS_EPSILON) continue;
    walls.push({
      coord: wall.start[axis],
      spanMin: Math.min(a, b),
      spanMax: Math.max(a, b),
    });
  }
  return walls;
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
 * measures the flush gap exactly as it does for a wall.
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
 * Snap one axis of the ghost center: quantize happened upstream; here the
 * center clamps inside the room's bounds and sticks flush to the nearest
 * snap line — a room wall or a placed item's near face — within tolerance.
 */
function snapAxis(
  walls: AxisWall[],
  obstacles: Obstacle[],
  axis: "x" | "y",
  center: number,
  across: number,
  half: number,
  crossHalf: number,
  clampMin: number | null,
  clampMax: number | null,
  tolerance: number,
): number {
  let snapped = center;
  if (clampMin !== null && clampMax !== null) {
    // A room narrower than the item centers it on that axis.
    snapped =
      clampMin > clampMax
        ? (clampMin + clampMax) / 2
        : Math.min(Math.max(snapped, clampMin), clampMax);
  }
  const lines = [
    ...walls,
    ...objectFaces(obstacles, axis, snapped, across, crossHalf),
  ];
  const wall = nearestWall(lines, snapped, across, half);
  if (wall && Math.abs(wall.gap) <= tolerance) {
    snapped = wall.side === -1 ? wall.coord + half : wall.coord - half;
  }
  return snapped;
}

function guideFor(
  walls: AxisWall[],
  obstacles: Obstacle[],
  axis: "x" | "y",
  center: Point,
  half: number,
  crossHalf: number,
): PlacementGuide | null {
  const alongCenter = axis === "x" ? center.x : center.y;
  const across = axis === "x" ? center.y : center.x;
  const lines = [
    ...walls,
    ...objectFaces(obstacles, axis, alongCenter, across, crossHalf),
  ];
  const wall = nearestWall(lines, alongCenter, across, half);
  if (!wall || wall.gap < FLUSH_EPSILON) return null;
  const edge =
    (axis === "x" ? center.x : center.y) + (wall.side === -1 ? -half : half);
  const point = (along: number): Point =>
    axis === "x" ? { x: along, y: across } : { x: across, y: along };
  return {
    axis,
    from: point(wall.coord),
    to: point(edge),
    distance: wall.gap,
  };
}

/** Below this a wall counts as axis-aligned (handled by the per-axis path). */
const ANGLE_EPSILON = 1e-6;
const SPAN_EPSILON = 1e-6;
/** Alternating projections to settle a box into an angled corner's vertex. */
const ANGLED_PASSES = 8;

interface AngledWall {
  /** Stable guide key; the per-axis guides omit ids, so these can't collide. */
  id: string;
  /** A point on the wall line (its start corner). */
  p0: Point;
  /** Unit inward normal — the room interior is on the +normal side. */
  n: Point;
  /** Unit tangent from `p0` toward the wall's end. */
  t: Point;
  /** Wall length, so the tangential span along `t` is [0, length]. */
  length: number;
}

/** Signed area of the outline; its sign encodes the winding (plan y points down). */
function signedArea(outline: Point[]): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice;
}

/**
 * The outline's non-axis-aligned walls as inward half-planes. Axis-aligned
 * walls stay with the per-axis snap/clamp; these carry the arbitrary-angle
 * walls (a 120° corner) that the x/y decomposition can't see — so an item
 * snaps flush to them and stays contained instead of sliding straight out
 * through the wall.
 */
function angledWalls(outline: Point[]): AngledWall[] {
  const winding = signedArea(outline) > 0 ? 1 : -1;
  const walls: AngledWall[] = [];
  for (const wall of wallsOf(outline)) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    if (Math.abs(dx) < ANGLE_EPSILON || Math.abs(dy) < ANGLE_EPSILON) continue;
    const length = Math.hypot(dx, dy);
    const t = { x: dx / length, y: dy / length };
    // Left normal of the tangent for CCW-in-coords winding, right otherwise
    // — either way it points into the room.
    const n = winding > 0 ? { x: -t.y, y: t.x } : { x: t.y, y: -t.x };
    walls.push({ id: `wall-${wall.index}`, p0: wall.start, n, t, length });
  }
  return walls;
}

/** A box half-extent projected onto a unit direction (its support distance). */
function support(dir: Point, halfW: number, halfD: number): number {
  return Math.abs(dir.x) * halfW + Math.abs(dir.y) * halfD;
}

/** Signed clearance from the box centered at `c` to a wall line, along `n`. */
function angledGap(
  wall: AngledWall,
  c: Point,
  halfW: number,
  halfD: number,
): number {
  const along = wall.n.x * (c.x - wall.p0.x) + wall.n.y * (c.y - wall.p0.y);
  return along - support(wall.n, halfW, halfD);
}

/** Whether the box's tangential shadow overlaps the wall segment [0, length]. */
function facesWall(
  wall: AngledWall,
  c: Point,
  halfW: number,
  halfD: number,
): boolean {
  const tc = wall.t.x * (c.x - wall.p0.x) + wall.t.y * (c.y - wall.p0.y);
  const halfT = support(wall.t, halfW, halfD);
  return tc + halfT > SPAN_EPSILON && tc - halfT < wall.length - SPAN_EPSILON;
}

/**
 * Keep the box inside every angled wall and stick it flush to any within
 * tolerance. A negative gap means the box pokes through the wall, so it gets
 * pushed back in (containment); a small positive gap snaps to flush. Iterated
 * because settling into a corner where two angled walls meet takes a few
 * alternating projections.
 */
function applyAngledWalls(
  walls: AngledWall[],
  center: Point,
  halfW: number,
  halfD: number,
  tolerance: number,
): Point {
  let c = center;
  for (let pass = 0; pass < ANGLED_PASSES; pass++) {
    let moved = false;
    for (const wall of walls) {
      if (!facesWall(wall, c, halfW, halfD)) continue;
      const gap = angledGap(wall, c, halfW, halfD);
      if (gap > tolerance) continue;
      c = { x: c.x - wall.n.x * gap, y: c.y - wall.n.y * gap };
      moved = true;
    }
    if (!moved) break;
  }
  return c;
}

/**
 * Clearance guides to the nearest angled walls the box isn't flush against —
 * the same perpendicular line + pill as the axis guides, drawn along the
 * wall's normal. Capped at the two nearest so a many-walled room stays legible.
 */
function angledWallGuides(
  walls: AngledWall[],
  center: Point,
  halfW: number,
  halfD: number,
): PlacementGuide[] {
  return walls
    .filter((wall) => facesWall(wall, center, halfW, halfD))
    .map((wall) => ({ wall, gap: angledGap(wall, center, halfW, halfD) }))
    .filter((entry) => entry.gap >= FLUSH_EPSILON)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 2)
    .map(({ wall, gap }) => {
      const s = support(wall.n, halfW, halfD);
      return {
        axis: Math.abs(wall.n.x) >= Math.abs(wall.n.y) ? "x" : "y",
        id: wall.id,
        from: {
          x: center.x - wall.n.x * (s + gap),
          y: center.y - wall.n.y * (s + gap),
        },
        to: { x: center.x - wall.n.x * s, y: center.y - wall.n.y * s },
        distance: gap,
      } satisfies PlacementGuide;
    });
}

/**
 * Where a catalog footprint dragged to `cursor` actually lands: the center
 * quantizes to the placement grid, clamps inside the room's bounding box,
 * and sticks flush to the nearest snap line — an axis-aligned wall or a
 * placed item's (`obstacles`) facing edge — within `tolerance`; `guides`
 * carry the per-axis clearance to whichever line is nearest, left to render.
 * A final pass contains and flush-snaps against any non-axis-aligned walls,
 * which the x/y decomposition above can't represent.
 *
 * With `snap` off (the snap toggle), the raw cursor passes through unquantized
 * and no flush snapping fires (no guides) — but the footprint still clamps and
 * contains inside the outline, so free placement can't push furniture through
 * a wall.
 */
export function snapPlacement(
  outline: Point[],
  size: { width: number; depth: number },
  cursor: Point,
  obstacles: Obstacle[] = [],
  tolerance: number = SNAP_TOLERANCE,
  grid: number = PLACEMENT_GRID,
  snap = true,
): PlacementSnap {
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  const bounds = outlineBounds(outline);
  const vertical = axisWalls(outline, "x");
  const horizontal = axisWalls(outline, "y");

  // Snap off: skip quantize and drop the flush tolerance to zero so only the
  // clamp/containment survives (a zero gap never triggers a flush pull).
  const flushTolerance = snap ? tolerance : 0;
  const quantized = snap
    ? {
        x: quantize(cursor.x, grid),
        y: quantize(cursor.y, grid),
      }
    : { x: cursor.x, y: cursor.y };
  // halfD is the mover's cross extent when measuring along x; halfW along y.
  const center: Point = {
    x: snapAxis(
      vertical,
      obstacles,
      "x",
      quantized.x,
      quantized.y,
      halfW,
      halfD,
      bounds ? bounds.min.x + halfW : null,
      bounds ? bounds.max.x - halfW : null,
      flushTolerance,
    ),
    y: 0,
  };
  center.y = snapAxis(
    horizontal,
    obstacles,
    "y",
    quantized.y,
    center.x,
    halfD,
    halfW,
    bounds ? bounds.min.y + halfD : null,
    bounds ? bounds.max.y - halfD : null,
    flushTolerance,
  );

  // Non-axis walls, handled after the x/y pass: contain + flush-snap along
  // each wall's own normal. The axis walls above are inside every angled
  // wall's half-plane, so this only pulls the box further in, never out.
  const angled = angledWalls(outline);
  const placed =
    angled.length > 0
      ? applyAngledWalls(angled, center, halfW, halfD, flushTolerance)
      : center;

  // Snap off: contained, but no flush snap and so no clearance guides.
  if (!snap) return { center: placed, guides: [] };

  const guides: PlacementGuide[] = [];
  const guideX = guideFor(vertical, obstacles, "x", placed, halfW, halfD);
  if (guideX) guides.push(guideX);
  const guideY = guideFor(horizontal, obstacles, "y", placed, halfD, halfW);
  if (guideY) guides.push(guideY);
  guides.push(...angledWallGuides(angled, placed, halfW, halfD));
  return { center: placed, guides };
}
