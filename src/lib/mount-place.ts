import {
  deriveMountTransform,
  type MountFrame,
  type Point,
  type WallMount,
} from "#/lib/model";
import { slideOpening } from "#/lib/opening-place";
import type { PlacementGuide } from "#/lib/place";

/**
 * Pure placement math for wall-mounted items (parallel to `opening-place.ts`
 * for doors/windows): where a cursor over the floor lands a mount on the
 * nearest wall, and where a re-anchor puts an existing mount after the outline
 * is reshaped. Everything is in wall-local offsets, so it works at any wall
 * angle; the standing ghost, pointer projection and rendering live in
 * `wall-mount-ghost.tsx` / the move-drag session.
 */

/** How far inside the interior wall face the corner guides draw, meters. */
const GUIDE_INSET = 0.18;
/** Gaps below this read as flush to the corner — the guide disappears. */
const FLUSH_EPSILON = 0.005;

export interface WallMountResult {
  mount: WallMount;
  /** Derived plan center (flush against the wall). */
  position: Point;
  /** Derived yaw (width axis along the wall). */
  rotation: number;
  /** Distance-to-corner readouts, like an opening's (empty when snap is off). */
  guides: PlacementGuide[];
}

/** A point `along` meters from the frame's start, `outwardOffset` across it. */
function framePoint(
  frame: MountFrame,
  along: number,
  outwardOffset: number,
): Point {
  return {
    x: frame.start.x + frame.dir.x * along + frame.outward.x * outwardOffset,
    y: frame.start.y + frame.dir.y * along + frame.outward.y * outwardOffset,
  };
}

/** Perpendicular distance from `cursor` to the wall segment, and the clamped
 * projection offset (0..length) along it. */
function projectToWall(
  frame: MountFrame,
  cursor: Point,
): { along: number; distance: number } {
  const rel = { x: cursor.x - frame.start.x, y: cursor.y - frame.start.y };
  const raw = rel.x * frame.dir.x + rel.y * frame.dir.y;
  const along = Math.min(Math.max(raw, 0), frame.length);
  const proj = {
    x: frame.start.x + frame.dir.x * along,
    y: frame.start.y + frame.dir.y * along,
  };
  return { along, distance: Math.hypot(cursor.x - proj.x, cursor.y - proj.y) };
}

/** The distance-to-corner readouts for a mount at near-edge `offset`, mirroring
 * `openingCornerGuides`: one guide from each wall corner, drawn inside the room. */
function cornerGuides(
  frame: MountFrame,
  offset: number,
  width: number,
): PlacementGuide[] {
  const axis: "x" | "y" =
    Math.abs(frame.dir.x) >= Math.abs(frame.dir.y) ? "x" : "y";
  const guides: PlacementGuide[] = [];
  if (offset > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "near",
      from: framePoint(frame, 0, -GUIDE_INSET),
      to: framePoint(frame, offset, -GUIDE_INSET),
      distance: offset,
    });
  }
  const farGap = frame.length - offset - width;
  if (farGap > FLUSH_EPSILON) {
    guides.push({
      axis,
      id: "far",
      from: framePoint(frame, offset + width, -GUIDE_INSET),
      to: framePoint(frame, frame.length, -GUIDE_INSET),
      distance: farGap,
    });
  }
  return guides;
}

/** Near-edge offset clamped to the wall without the snap grid (snap off). */
function clampOffset(
  raw: number,
  wallLength: number,
  width: number,
): number | null {
  if (width > wallLength) return null;
  return Math.min(Math.max(raw, 0), wallLength - width);
}

function resultFor(
  frame: MountFrame,
  offset: number,
  footprint: { width: number; depth: number },
  elevation: number,
  guides: PlacementGuide[],
): WallMountResult {
  const { position, rotation } = deriveMountTransform(frame, offset, footprint);
  return {
    mount: { wallIndex: frame.index, offset, elevation },
    position,
    rotation,
    guides,
  };
}

/**
 * Where a wall item dragged to `cursor` (a floor point) mounts: the nearest
 * wall that fits it, with the near-edge offset quantized (`snap`) or plain-
 * clamped to that wall. Walls too short for the item are skipped, so the mount
 * falls through to the next-nearest fitting wall. Null when no wall fits.
 */
export function mountAt(
  frames: MountFrame[],
  cursor: Point,
  footprint: { width: number; depth: number },
  elevation: number,
  snap = true,
): WallMountResult | null {
  const candidates = frames
    .map((frame) => ({ frame, ...projectToWall(frame, cursor) }))
    .sort((a, b) => a.distance - b.distance);
  for (const { frame, along } of candidates) {
    const raw = along - footprint.width / 2;
    const offset = snap
      ? slideOpening(frame.length, footprint.width, [], raw)
      : clampOffset(raw, frame.length, footprint.width);
    if (offset === null) continue;
    const guides = snap ? cornerGuides(frame, offset, footprint.width) : [];
    return resultFor(frame, offset, footprint, elevation, guides);
  }
  return null;
}

/**
 * Re-anchor an existing mount after the outline is reshaped: keep it on the
 * geometrically nearest wall to its current `position` (robust to wall-index
 * shifts from splits), re-slid onto that wall. Null — meaning "drop it" — when
 * the nearest wall is now too short to hold the item. No guides.
 */
export function reanchorMount(
  frames: MountFrame[],
  position: Point,
  footprint: { width: number; depth: number },
  elevation: number,
): WallMountResult | null {
  let best: { frame: MountFrame; along: number; distance: number } | null =
    null;
  for (const frame of frames) {
    const projected = projectToWall(frame, position);
    if (best === null || projected.distance < best.distance) {
      best = { frame, ...projected };
    }
  }
  if (best === null) return null;
  const offset = slideOpening(
    best.frame.length,
    footprint.width,
    [],
    best.along - footprint.width / 2,
  );
  if (offset === null) return null;
  return resultFor(best.frame, offset, footprint, elevation, []);
}
