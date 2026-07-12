import {
  DRAW_GRID_STEP,
  type FloorSnap,
  NO_SNAP_TARGETS,
  nearestTargetCorner,
  quantizeToStep,
  type SnapTargets,
  targetAxisCandidate,
} from "#/lib/draw";
import {
  type FurnitureItem,
  footprintCorners,
  type Opening,
  type Point,
  pointInOutline,
  type Room,
  wallFrames,
  wallLength,
  wallsOf,
} from "#/lib/model";
import { reanchorMount } from "#/lib/mount-place";
import { slideOpening, type WallSpan } from "#/lib/opening-place";

/**
 * Pure geometry for editing an existing (closed) room outline in draw mode:
 * snapping a dragged corner, splitting a wall with a new corner, re-lengthening
 * a wall of the closed loop, and committing the reshaped outline back onto the
 * room without losing its openings and furniture. Rendering and pointers live
 * in `draw-scene.tsx`; the draft session state lives on the planner route.
 */

/**
 * The draw-mode draft. Fresh drawing builds an *open* corner chain (today's
 * click-to-place flow); entering draw mode over an existing room seeds a
 * *closed* draft from the room's outline instead — corners drag, walls split.
 * A closed draft carries the room's openings so wall splits can re-anchor
 * them exactly (indices and offsets shift at split time, not at commit).
 *
 * `roomId` names the floor room the draft edits; null means the draft is a
 * *new* room — committing it appends a Room to the floor instead of
 * reshaping an existing one.
 */
export interface OutlineDraft {
  roomId: string | null;
  corners: Point[];
  closed: boolean;
  openings: Opening[];
}

export function emptyOutlineDraft(roomId: string | null = null): OutlineDraft {
  return { roomId, corners: [], closed: false, openings: [] };
}

/**
 * The draft a room opens as in draw mode: its outline as a closed editable
 * loop, or a blank open draft targeting the room when there's no outline yet
 * (right after "New room" — fresh from-scratch drawing).
 */
export function draftFromRoom(room: Room): OutlineDraft {
  if (room.outline.length < 3) return emptyOutlineDraft(room.id);
  return {
    roomId: room.id,
    corners: room.outline,
    closed: true,
    openings: room.openings,
  };
}

/** Two outlines with identical corners (same order, exact coordinates). */
export function sameOutline(a: Point[], b: Point[]): boolean {
  return (
    a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)
  );
}

/** A corner whose x or y the dragged corner snapped to — a guide to draw. */
export interface CornerGuide {
  cornerIndex: number;
  axis: "x" | "y";
}

export interface CornerDragSnap {
  point: Point;
  /** At most one guide per axis. */
  guides: CornerGuide[];
  /** Locks onto other rooms' corners/walls, for in-scene feedback. */
  floorSnaps: FloorSnap[];
}

/**
 * Snap corner `index` being dragged to `cursor`: the cursor may land exactly
 * on another room's corner (the flush seam beats everything); otherwise each
 * coordinate locks to the nearest of the other draft corners' matching
 * coordinate, another room's wall line, or another room's corner coordinate
 * within `tolerance` — and whatever stays free quantizes to the drawing grid.
 *
 * With `snap` off (the snap toggle), the raw cursor passes straight through —
 * no corner alignment, no quantize — for free-hand corner dragging.
 */
export function snapCornerDrag(
  corners: Point[],
  index: number,
  cursor: Point,
  tolerance: number,
  snap = true,
  targets: SnapTargets = NO_SNAP_TARGETS,
): CornerDragSnap {
  if (!snap) {
    return { point: { x: cursor.x, y: cursor.y }, guides: [], floorSnaps: [] };
  }
  const exactCorner = nearestTargetCorner(targets.corners, cursor, tolerance);
  if (exactCorner) {
    return {
      point: { x: exactCorner.x, y: exactCorner.y },
      guides: [],
      floorSnaps: [{ kind: "corner", at: exactCorner }],
    };
  }
  const point: Point = { x: cursor.x, y: cursor.y };
  const guides: CornerGuide[] = [];
  const floorSnaps: FloorSnap[] = [];
  for (const axis of ["x", "y"] as const) {
    let best: number | null = null;
    let bestDistance = tolerance;
    for (let i = 0; i < corners.length; i++) {
      if (i === index) continue;
      const d = Math.abs(cursor[axis] - corners[i][axis]);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    const target = targetAxisCandidate(targets, axis, cursor, tolerance);
    if (target && target.distance < bestDistance) {
      point[axis] = target.value;
      floorSnaps.push(target.snap);
    } else if (best !== null) {
      point[axis] = corners[best][axis];
      guides.push({ cornerIndex: best, axis });
    } else {
      point[axis] = quantizeToStep(point[axis], DRAW_GRID_STEP);
    }
  }
  return { point, guides, floorSnaps };
}

/** Splits landing closer than this to a corner are refused (meters) — the
 * click was probably aimed at the corner, not the wall. */
export const SPLIT_CORNER_CLEARANCE = 0.25;

/**
 * Where a click at `cursor` splits wall `wallIndex`: the projection onto the
 * wall, quantized along it. Null when the projection lands within `clearance`
 * of either corner (or the wall is too short to split at all).
 */
export function splitPointOnWall(
  outline: Point[],
  wallIndex: number,
  cursor: Point,
  clearance: number = SPLIT_CORNER_CLEARANCE,
  grid: number = DRAW_GRID_STEP,
): Point | null {
  const wall = wallsOf(outline)[wallIndex];
  if (!wall) return null;
  const length = wallLength(wall);
  if (length < 2 * clearance) return null;
  const dir = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  };
  const along = quantizeToStep(
    (cursor.x - wall.start.x) * dir.x + (cursor.y - wall.start.y) * dir.y,
    grid,
  );
  if (along < clearance || along > length - clearance) return null;
  return {
    x: Math.round((wall.start.x + dir.x * along) * 1e4) / 1e4,
    y: Math.round((wall.start.y + dir.y * along) * 1e4) / 1e4,
  };
}

/**
 * The point on wall `wallIndex` nearest to `cursor`: the projection onto the
 * wall, quantized along it and clamped into the segment (a cursor beyond an
 * end lands exactly on that corner). Unlike `splitPointOnWall` there is no
 * corner clearance — this locates where on the wall a new draw starts, and
 * starting flush at a corner is fine. Null only for invalid/degenerate walls.
 */
export function pointAlongWall(
  outline: Point[],
  wallIndex: number,
  cursor: Point,
  grid: number = DRAW_GRID_STEP,
): Point | null {
  const wall = wallsOf(outline)[wallIndex];
  if (!wall) return null;
  const length = wallLength(wall);
  if (length < EPS) return null;
  const dir = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  };
  const along = Math.max(
    0,
    Math.min(
      length,
      quantizeToStep(
        (cursor.x - wall.start.x) * dir.x + (cursor.y - wall.start.y) * dir.y,
        grid,
      ),
    ),
  );
  return {
    x: Math.round((wall.start.x + dir.x * along) * 1e4) / 1e4,
    y: Math.round((wall.start.y + dir.y * along) * 1e4) / 1e4,
  };
}

const EPS = 1e-6;

/**
 * Insert a corner at `point` (already on wall `wallIndex`, via
 * `splitPointOnWall`), splitting that wall in two. Openings re-anchor: later
 * walls shift index by one, and openings on the split wall land on whichever
 * piece holds their center — clamped fully into it, or dropped when the piece
 * is narrower than they are.
 */
export function splitOutlineWall(
  outline: Point[],
  openings: Opening[],
  wallIndex: number,
  point: Point,
): { outline: Point[]; openings: Opening[] } {
  const wall = wallsOf(outline)[wallIndex];
  if (!wall) return { outline, openings };
  const length = wallLength(wall);
  const split = Math.hypot(point.x - wall.start.x, point.y - wall.start.y);
  const nextOutline = [
    ...outline.slice(0, wallIndex + 1),
    point,
    ...outline.slice(wallIndex + 1),
  ];
  const nextOpenings: Opening[] = [];
  for (const opening of openings) {
    if (opening.wallIndex !== wallIndex) {
      nextOpenings.push(
        opening.wallIndex > wallIndex
          ? { ...opening, wallIndex: opening.wallIndex + 1 }
          : opening,
      );
      continue;
    }
    const center = opening.offset + opening.width / 2;
    if (center <= split) {
      if (opening.width <= split + EPS) {
        nextOpenings.push({
          ...opening,
          offset: Math.max(0, Math.min(opening.offset, split - opening.width)),
        });
      }
    } else {
      const pieceLength = length - split;
      if (opening.width <= pieceLength + EPS) {
        nextOpenings.push({
          ...opening,
          wallIndex: opening.wallIndex + 1,
          offset: Math.max(
            0,
            Math.min(opening.offset - split, pieceLength - opening.width),
          ),
        });
      }
    }
  }
  return { outline: nextOutline, openings: nextOpenings };
}

/**
 * Remove corner `cornerIndex` from a closed outline, merging its two walls
 * into one from the previous corner straight to the next. Openings on the
 * merged walls re-anchor by their world-space center projected onto the new
 * wall — slid apart where the (possibly shorter) merged wall would overlap
 * them, dropped where they no longer fit; openings on later walls shift
 * index down by one. A triangle keeps all three corners (same references).
 */
export function removeOutlineCorner(
  outline: Point[],
  openings: Opening[],
  cornerIndex: number,
): { outline: Point[]; openings: Opening[] } {
  const n = outline.length;
  if (n <= 3 || cornerIndex < 0 || cornerIndex >= n) {
    return { outline, openings };
  }
  const prevWall = (cornerIndex - 1 + n) % n;
  const mergedIndex = cornerIndex === 0 ? n - 2 : cornerIndex - 1;
  const mergedStart = outline[(cornerIndex - 1 + n) % n];
  const mergedEnd = outline[(cornerIndex + 1) % n];
  const mergedLength = Math.hypot(
    mergedEnd.x - mergedStart.x,
    mergedEnd.y - mergedStart.y,
  );
  const mergedDir =
    mergedLength < EPS
      ? null
      : {
          x: (mergedEnd.x - mergedStart.x) / mergedLength,
          y: (mergedEnd.y - mergedStart.y) / mergedLength,
        };
  const walls = wallsOf(outline);
  const nextOutline = outline.filter((_, i) => i !== cornerIndex);
  const nextOpenings: Opening[] = [];
  const mergedSpans: WallSpan[] = [];
  for (const opening of openings) {
    if (opening.wallIndex !== prevWall && opening.wallIndex !== cornerIndex) {
      const shifted =
        cornerIndex === 0 || opening.wallIndex > cornerIndex
          ? opening.wallIndex - 1
          : opening.wallIndex;
      nextOpenings.push(
        shifted === opening.wallIndex
          ? opening
          : { ...opening, wallIndex: shifted },
      );
      continue;
    }
    // A merged-wall opening: project its world center onto the new wall.
    const wall = walls[opening.wallIndex];
    const length = wallLength(wall);
    if (!mergedDir || length < EPS) continue;
    const center = {
      x:
        wall.start.x +
        ((wall.end.x - wall.start.x) / length) *
          (opening.offset + opening.width / 2),
      y:
        wall.start.y +
        ((wall.end.y - wall.start.y) / length) *
          (opening.offset + opening.width / 2),
    };
    const along =
      (center.x - mergedStart.x) * mergedDir.x +
      (center.y - mergedStart.y) * mergedDir.y;
    const offset = slideOpening(
      mergedLength,
      opening.width,
      mergedSpans,
      along - opening.width / 2,
    );
    if (offset === null) continue;
    mergedSpans.push({ start: offset, width: opening.width });
    nextOpenings.push({ ...opening, wallIndex: mergedIndex, offset });
  }
  return { outline: nextOutline, openings: nextOpenings };
}

/**
 * Set the true length of wall `wallIndex` on a *closed* outline, keeping its
 * direction. The wall's end corner moves, and the shift propagates to the
 * following corners while their walls stay perpendicular to it (they'd tilt
 * otherwise); the first wall with any component along the shift absorbs it by
 * changing length instead — on a rectangle, stretching the bottom wall slides
 * the whole right side and the top wall follows. Returns the input unchanged
 * for invalid indices, non-positive lengths, or degenerate walls.
 */
export function setClosedSegmentLength(
  corners: Point[],
  wallIndex: number,
  length: number,
): Point[] {
  const n = corners.length;
  if (n < 3 || wallIndex < 0 || wallIndex >= n) return corners;
  if (!Number.isFinite(length) || length <= 0) return corners;
  const start = corners[wallIndex];
  const end = corners[(wallIndex + 1) % n];
  const current = Math.hypot(end.x - start.x, end.y - start.y);
  if (current === 0 || Math.abs(length - current) < EPS) return corners;
  const scale = length / current - 1;
  const delta = {
    x: (end.x - start.x) * scale,
    y: (end.y - start.y) * scale,
  };
  const deltaLength = Math.hypot(delta.x, delta.y);
  const moved = new Set<number>([(wallIndex + 1) % n]);
  for (let step = 1; step <= n - 3; step++) {
    const j = (wallIndex + 1 + step) % n;
    const p = corners[(j - 1 + n) % n];
    const q = corners[j];
    const wall = { x: q.x - p.x, y: q.y - p.y };
    const wallLen = Math.hypot(wall.x, wall.y);
    if (wallLen === 0) break;
    const along =
      Math.abs(wall.x * delta.x + wall.y * delta.y) / (wallLen * deltaLength);
    if (along > EPS) break;
    moved.add(j);
  }
  return corners.map((corner, i) =>
    moved.has(i)
      ? {
          x: Math.round((corner.x + delta.x) * 1e4) / 1e4,
          y: Math.round((corner.y + delta.y) * 1e4) / 1e4,
        }
      : corner,
  );
}

/** Furniture corners this close to the boundary (meters) still count inside —
 * flush-to-wall placements sit exactly on it. */
const FIT_TOLERANCE = 1e-3;

/**
 * Commit an edited outline back onto the room. Openings keep their host wall
 * and offset, re-slid by `slideOpening` into the wall's (possibly resized)
 * free stretches — those that no longer fit are dropped. Floor furniture stays
 * only where its rotated footprint still lies inside the new outline;
 * wall-mounted furniture re-anchors to its geometrically nearest wall (by its
 * synced position, so wall-index shifts from splits don't matter) and is
 * dropped when that wall no longer fits it.
 */
export function applyOutlineDraft(
  room: Room,
  corners: Point[],
  openings: Opening[],
): Room {
  const walls = wallsOf(corners);
  const occupied = new Map<number, WallSpan[]>();
  const keptOpenings: Opening[] = [];
  for (const opening of openings) {
    const wall = walls[opening.wallIndex];
    if (!wall) continue;
    const others = occupied.get(opening.wallIndex) ?? [];
    const offset = slideOpening(
      wallLength(wall),
      opening.width,
      others,
      opening.offset,
    );
    if (offset === null) continue;
    others.push({ start: offset, width: opening.width });
    occupied.set(opening.wallIndex, others);
    keptOpenings.push(
      offset === opening.offset ? opening : { ...opening, offset },
    );
  }
  const frames = wallFrames(corners);
  const furniture: FurnitureItem[] = [];
  for (const item of room.furniture) {
    if (item.mount) {
      // Re-anchor against this room's own reshaped walls — the mount's
      // roomId is always the owning room (`WallMount.roomId` invariant).
      const result = reanchorMount(
        room.id,
        frames,
        item.position,
        item.footprint,
        item.mount.elevation,
      );
      if (!result) continue;
      furniture.push({
        ...item,
        position: result.position,
        rotation: result.rotation,
        mount: result.mount,
      });
      continue;
    }
    if (
      footprintCorners(item).every((corner) =>
        pointInOutline(corners, corner, FIT_TOLERANCE),
      )
    ) {
      furniture.push(item);
    }
  }
  return { ...room, outline: corners, openings: keptOpenings, furniture };
}
