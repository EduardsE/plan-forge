import type { OpeningKind, Point, Room } from "#/lib/model";
import { DEFAULT_WALL_HEIGHT, wallHeightOf, wallsOf } from "#/lib/model";
import type { RoomSeamData, Span } from "#/lib/seams";

/**
 * Pure scene-preparation math for the 3D lens: turns the plain room model
 * into wall "solids" a renderer can extrude — no three.js, no React, so it
 * stays unit-testable (same pattern as `camera.ts`).
 *
 * All values are meters in plan coordinates (x right, y down — see
 * `model/types.ts`). The vertical extent of openings isn't in the model yet,
 * so this module owns the defaults, measured from the mockup's 3D scene
 * (walls 250 px = 2.5 m at 100 px/m, window at top:56/height:158 px).
 */

/** Default wall height; rooms can override it (`Room.wallHeight`). */
export const WALL_HEIGHT = DEFAULT_WALL_HEIGHT;
export const WALL_THICKNESS = 0.1;
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

/** A rectangular cut in a wall face, in wall-local coordinates. */
export interface WallHole {
  /** Id of the model opening the hole came from (picking needs it). */
  id: string;
  kind: OpeningKind;
  /** Distance from the wall's start corner to the hole's near edge. */
  start: number;
  width: number;
  /** Height of the hole's lower edge above the floor. */
  bottom: number;
  /** Height of the hole's upper edge above the floor. */
  top: number;
  /** Doors only: hinge edge, carried through from the opening. */
  hinge?: "start" | "end";
  /**
   * A portal cut for a *neighbor* room's opening on a shared wall: renderers
   * cut the gap but draw no symbol, dressing, or pick target — those belong
   * to the opening's owning side.
   */
  phantom?: boolean;
}

/** One wall ready to extrude: a placed rectangle with holes cut into it. */
export interface WallSolid {
  index: number;
  /** Plan position of the wall's start corner. */
  start: Point;
  /** Unit direction along the wall, start → end. */
  dir: Point;
  /** Unit normal pointing away from the room interior. */
  outward: Point;
  length: number;
  holes: WallHole[];
  /**
   * Shared-wall stretches (wall-local, sorted, disjoint): another room's
   * wall runs along the same line there, so this side renders only half the
   * thickness (see `wallPieces`). Absent/empty on unshared walls.
   */
  seams?: Span[];
}

/**
 * A filler post at a convex outline corner. Walls extrude to the outside of
 * the outline, which leaves a thickness × thickness notch at every outward
 * corner; the post fills it.
 */
export interface CornerPost {
  /** The outline corner the post fills. */
  corner: Point;
  /** Plan position of the post's center. */
  center: Point;
  /** Wall indices meeting at this corner: [incoming, outgoing]. */
  walls: [number, number];
}

/** A neighbor room's walls, as a cover source for `postCoveredByWalls`. */
export interface NeighborWalls {
  solids: WallSolid[];
  wallHeight: number;
}

/** Twice the signed area; sign encodes winding (positive for the sample). */
function signedDoubleArea(outline: Point[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

const MIN_HOLE_SIZE = 1e-6;

/**
 * Derive one solid per wall of the room, with door/window holes located in
 * wall-local coordinates and clamped to the wall's extent. Outlines with
 * fewer than 3 corners enclose nothing and yield no walls.
 *
 * `seamData` (from `floorSeamData`) adds the room's shared-wall stretches
 * and cuts phantom holes for neighbor rooms' portal openings.
 */
export function buildWallSolids(
  room: Room,
  wallHeight = wallHeightOf(room),
  seamData?: RoomSeamData,
): WallSolid[] {
  const { outline, openings } = room;
  if (outline.length < 3) return [];
  const windingSign = Math.sign(signedDoubleArea(outline)) || 1;

  const solids: WallSolid[] = [];
  for (const wall of wallsOf(outline)) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_HOLE_SIZE) continue;
    const dir = { x: dx / length, y: dy / length };
    // For the sample's winding (positive signed area in y-down coords) the
    // interior lies to the wall's left, so outward is the right normal.
    // `+ 0` folds the -0 that the sign flips produce on axis-aligned walls.
    const outward = {
      x: dir.y * windingSign + 0,
      y: -dir.x * windingSign + 0,
    };

    const holes: WallHole[] = [];
    const cutHole = (
      id: string,
      kind: OpeningKind,
      offset: number,
      width: number,
      hinge?: "start" | "end",
      phantom?: boolean,
    ) => {
      const start = Math.min(Math.max(offset, 0), length);
      const end = Math.min(Math.max(offset + width, 0), length);
      const bottom = kind === "window" ? WINDOW_SILL : 0;
      const top = Math.min(
        kind === "window" ? WINDOW_HEAD : DOOR_HEIGHT,
        wallHeight,
      );
      if (end - start < MIN_HOLE_SIZE || top - bottom < MIN_HOLE_SIZE) return;
      holes.push({
        id,
        kind,
        start,
        width: end - start,
        bottom,
        top,
        ...(hinge ? { hinge } : {}),
        ...(phantom ? { phantom } : {}),
      });
    };
    for (const opening of openings) {
      if (opening.wallIndex !== wall.index) continue;
      cutHole(
        opening.id,
        opening.kind,
        opening.offset,
        opening.width,
        opening.hinge,
      );
    }
    for (const portal of seamData?.portalHoles ?? []) {
      if (portal.wallIndex !== wall.index) continue;
      cutHole(
        portal.id,
        portal.kind,
        portal.offset,
        portal.width,
        undefined,
        true,
      );
    }
    holes.sort((a, b) => a.start - b.start);

    const seams = seamData?.seamSpans.get(wall.index);
    solids.push({
      index: wall.index,
      start: wall.start,
      dir,
      outward,
      length,
      holes,
      ...(seams && seams.length > 0 ? { seams } : {}),
    });
  }
  return solids;
}

/**
 * A constant-thickness stretch of a wall, for rendering: shared (seam)
 * stretches draw at half thickness — the abutting room draws the other half,
 * so together the wall reads as one, not doubled — with the wall's holes
 * clipped into each piece.
 */
export interface WallPiece {
  start: number;
  end: number;
  /** On a shared-wall stretch: render at `WALL_THICKNESS / 2`. */
  seam: boolean;
  /** Holes overlapping this piece, clipped to it (wall-local offsets). */
  holes: WallHole[];
}

/**
 * Split a wall into its constant-thickness pieces along the seam
 * boundaries. Unshared walls yield the single full piece.
 */
export function wallPieces(solid: WallSolid): WallPiece[] {
  const seams = (solid.seams ?? [])
    .map((span) => ({
      start: Math.min(Math.max(span.start, 0), solid.length),
      end: Math.min(Math.max(span.end, 0), solid.length),
    }))
    .filter((span) => span.end - span.start > MIN_HOLE_SIZE);
  const cuts = [
    0,
    ...seams.flatMap((span) => [span.start, span.end]),
    solid.length,
  ].sort((a, b) => a - b);
  const pieces: WallPiece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end - start < MIN_HOLE_SIZE) continue;
    const mid = (start + end) / 2;
    const seam = seams.some((span) => span.start <= mid && mid <= span.end);
    const last = pieces[pieces.length - 1];
    if (last && last.seam === seam) {
      last.end = end;
    } else {
      pieces.push({ start, end, seam, holes: [] });
    }
  }
  for (const piece of pieces) {
    for (const hole of solid.holes) {
      const start = Math.max(hole.start, piece.start);
      const end = Math.min(hole.start + hole.width, piece.end);
      if (end - start < MIN_HOLE_SIZE) continue;
      // A hole fully inside the piece passes through unchanged; only true
      // straddlers get clipped.
      piece.holes.push(
        end - start >= hole.width - MIN_HOLE_SIZE
          ? hole
          : { ...hole, start, width: end - start },
      );
    }
  }
  return pieces;
}

/**
 * The stretches of a piece that its cut-down stub still covers: holes
 * reaching below the stub top become full gaps — doors and portals keep
 * reading as openings in the low wall — while windows (sill above the stub)
 * don't cut it at all. Spans are wall-local, sorted, disjoint.
 */
export function stubSpans(piece: WallPiece): Span[] {
  const gaps = [...piece.holes]
    .filter((hole) => hole.bottom < STUB_WALL_HEIGHT)
    .sort((a, b) => a.start - b.start);
  const spans: Span[] = [];
  let cursor = piece.start;
  for (const gap of gaps) {
    if (gap.start - cursor > MIN_HOLE_SIZE) {
      spans.push({ start: cursor, end: gap.start });
    }
    cursor = Math.max(cursor, gap.start + gap.width);
  }
  if (piece.end - cursor > MIN_HOLE_SIZE) {
    spans.push({ start: cursor, end: piece.end });
  }
  return spans;
}

const COVER_EPSILON = 1e-6;

/**
 * Whether a corner post's box lies entirely inside one of a neighbor room's
 * wall solids. Two flush rooms both fill the shared junction — each room's
 * post lands inside the other room's wall — and the coincident faces
 * z-fight in the 3D lens, so a covered post is simply not rendered: the
 * neighbor's wall already draws that volume. Coverage requires a
 * full-thickness (non-seam) stretch at least as tall as the post with no
 * hole overlapping the post's span — anything less leaves part of the post
 * unfilled, so it stays.
 */
export function postCoveredByWalls(
  post: CornerPost,
  postHeight: number,
  neighbor: NeighborWalls,
  thickness = WALL_THICKNESS,
): boolean {
  if (neighbor.wallHeight < postHeight - COVER_EPSILON) return false;
  const half = thickness / 2;
  const corners = [
    { x: post.center.x - half, y: post.center.y - half },
    { x: post.center.x + half, y: post.center.y - half },
    { x: post.center.x + half, y: post.center.y + half },
    { x: post.center.x - half, y: post.center.y + half },
  ];
  for (const solid of neighbor.solids) {
    // Wall-local coordinates: distance along the wall and outward offset.
    const local = corners.map((corner) => {
      const rx = corner.x - solid.start.x;
      const ry = corner.y - solid.start.y;
      return {
        along: rx * solid.dir.x + ry * solid.dir.y,
        off: rx * solid.outward.x + ry * solid.outward.y,
      };
    });
    if (
      local.some(
        (p) => p.off < -COVER_EPSILON || p.off > thickness + COVER_EPSILON,
      )
    ) {
      continue;
    }
    const alongMin = Math.min(...local.map((p) => p.along));
    const alongMax = Math.max(...local.map((p) => p.along));
    for (const piece of wallPieces(solid)) {
      if (piece.seam) continue; // half thickness — can't fill the post box
      if (
        alongMin < piece.start - COVER_EPSILON ||
        alongMax > piece.end + COVER_EPSILON
      ) {
        continue;
      }
      const blocked = piece.holes.some(
        (hole) => hole.start < alongMax && hole.start + hole.width > alongMin,
      );
      if (!blocked) return true;
    }
  }
  return false;
}

/**
 * Filler posts for the convex corners of the outline (concave corners make
 * the extruded walls overlap instead of leaving a gap, so they need none).
 * `solids` must be the full result of `buildWallSolids` for the outline.
 */
export function cornerPosts(
  solids: WallSolid[],
  thickness = WALL_THICKNESS,
): CornerPost[] {
  const posts: CornerPost[] = [];
  for (let i = 0; i < solids.length; i++) {
    const incoming = solids[(i - 1 + solids.length) % solids.length];
    const outgoing = solids[i];
    // Walking the outline in its winding, convex corners bend around the
    // interior — the turn points to the interior side, opposite outward.
    const turn =
      incoming.dir.x * outgoing.dir.y - incoming.dir.y * outgoing.dir.x;
    const outwardSide =
      incoming.dir.x * incoming.outward.y - incoming.dir.y * incoming.outward.x;
    if (turn * outwardSide >= 0) continue;
    const corner = outgoing.start;
    posts.push({
      corner,
      center: {
        x:
          corner.x +
          ((incoming.outward.x + outgoing.outward.x) * thickness) / 2,
        y:
          corner.y +
          ((incoming.outward.y + outgoing.outward.y) * thickness) / 2,
      },
      walls: [incoming.index, outgoing.index],
    });
  }
  return posts;
}
