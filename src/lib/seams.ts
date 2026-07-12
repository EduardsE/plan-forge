import type { OpeningKind, Point, Room } from "#/lib/model";
import { wallsOf } from "#/lib/model";
// Type-only in the other direction (room-scene imports only types from here),
// so this value import doesn't create a runtime cycle.
import { WALL_THICKNESS } from "#/lib/room-scene";

/**
 * Seam detection between the rooms of a floor — the pure geometry behind
 * "connected by doors/windows". Two rooms *abut* where a wall segment of one
 * is collinear with a wall segment of the other and their spans overlap;
 * that shared stretch is a seam. An opening sitting on a seam is a *portal*:
 * it connects the two rooms, so the neighbor's wall must render the matching
 * cut and each side draws only half the wall thickness (two flush rooms both
 * extrude a wall over the same line — halving un-doubles it).
 *
 * Two wall arrangements count as one shared wall (`WallSeam.gap`):
 * - flush (gap 0): both outlines run over the same line, the canonical
 *   result of M3's flush snapping;
 * - back-to-back (gap = WALL_THICKNESS): the lines sit one wall thickness
 *   apart with the walls facing each other. Walls extrude *outward*, so the
 *   two solids occupy exactly the same slab — visually already one wall,
 *   which is how users read it when they draw a room against the outer face
 *   of an existing wall.
 *
 * Nothing here is stored: abutment is recomputed from the outlines every
 * time, consistent with "walls are derived, never stored".
 */

/** A stretch along a wall, as distances from the wall's start corner. */
export interface Span {
  start: number;
  end: number;
}

/** A shared-wall stretch, tagged with the perpendicular offset between the
 * two rooms' wall lines (0 flush, WALL_THICKNESS back-to-back) — renderers
 * center the wall assembly `gap / 2` outward from the owning line. */
export interface SeamSpan extends Span {
  gap: number;
}

/**
 * How far apart two "flush" wall lines may drift and still count as one
 * shared wall. Room snapping is exact, so this only absorbs float noise —
 * deliberately smaller than any real gap a user could draw (grid step 5 cm).
 */
const COLLINEAR_TOLERANCE = 1e-3;
/** Overlaps shorter than this are corner touches, not shared walls. */
const MIN_SEAM_LENGTH = 1e-3;
/** An opening must overlap a seam by at least this to count as a portal. */
const MIN_PORTAL_OVERLAP = 1e-3;

/** One abutment between two rooms, seen from one room's side. Every
 * abutment yields two seams, one per direction, so consumers can filter by
 * `roomId` without re-mapping offsets. */
export interface WallSeam {
  roomId: string;
  wallIndex: number;
  /** Shared stretch in this wall's local offsets (start < end). */
  span: Span;
  otherRoomId: string;
  otherWallIndex: number;
  /** The neighbor-wall offsets of `span.start` / `span.end`. Descending when
   * the walls run antiparallel (the usual case for same-winding rooms). */
  otherStart: number;
  otherEnd: number;
  /** Perpendicular offset between the two wall lines (see `SeamSpan`). */
  gap: number;
}

interface UnitWall {
  index: number;
  start: { x: number; y: number };
  dir: { x: number; y: number };
  length: number;
}

/** Outline winding sign via the shoelace sum (same convention as
 * `wall-mount.ts` / `place.ts`: positive for the sample's winding). */
function outlineWinding(outline: Point[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.sign(sum) || 1;
}

function unitWalls(room: Room): UnitWall[] {
  return wallsOf(room.outline).flatMap((wall) => {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_SEAM_LENGTH) return [];
    return [
      {
        index: wall.index,
        start: wall.start,
        dir: { x: dx / length, y: dy / length },
        length,
      },
    ];
  });
}

/** Signed distance of a point from the wall's infinite line. */
function lineDistance(wall: UnitWall, p: { x: number; y: number }): number {
  return (p.x - wall.start.x) * wall.dir.y - (p.y - wall.start.y) * wall.dir.x;
}

/** Offset of a point along the wall's direction from its start corner. */
function alongWall(wall: UnitWall, p: { x: number; y: number }): number {
  return (p.x - wall.start.x) * wall.dir.x + (p.y - wall.start.y) * wall.dir.y;
}

/**
 * Every seam of the floor: for each pair of rooms, each pair of collinear,
 * span-overlapping walls — reported from both rooms' perspectives.
 */
export function floorSeams(rooms: Room[]): WallSeam[] {
  const seams: WallSeam[] = [];
  const walls = rooms.map(unitWalls);
  const windings = rooms.map((room) => outlineWinding(room.outline));
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      for (const a of walls[i]) {
        for (const b of walls[j]) {
          const bStart = { x: b.start.x, y: b.start.y };
          const bEnd = {
            x: b.start.x + b.dir.x * b.length,
            y: b.start.y + b.dir.y * b.length,
          };
          const d0 = lineDistance(a, bStart);
          const d1 = lineDistance(a, bEnd);
          // Not parallel — a wall crossing a's line is never a seam.
          if (Math.abs(d0 - d1) > COLLINEAR_TOLERANCE) continue;
          // Offset of b's line from a's, measured along a's outward normal
          // (lineDistance measures along outward / winding).
          const offset = ((d0 + d1) / 2) * windings[i];
          // Facing ⟺ outward_a · outward_b < 0; with parallel walls that
          // dot product reduces to winding_a · winding_b · (dir_a · dir_b).
          const facing =
            windings[i] *
              windings[j] *
              (a.dir.x * b.dir.x + a.dir.y * b.dir.y) <
            0;
          let gap: number;
          if (Math.abs(offset) <= COLLINEAR_TOLERANCE) {
            gap = 0;
          } else if (
            facing &&
            Math.abs(offset - WALL_THICKNESS) <= COLLINEAR_TOLERANCE
          ) {
            gap = WALL_THICKNESS;
          } else {
            continue;
          }
          const t0 = alongWall(a, bStart);
          const t1 = alongWall(a, bEnd);
          const lo = Math.max(0, Math.min(t0, t1));
          const hi = Math.min(a.length, Math.max(t0, t1));
          if (hi - lo < MIN_SEAM_LENGTH) continue;
          const mapToB = (t: number) =>
            alongWall(b, {
              x: a.start.x + a.dir.x * t,
              y: a.start.y + a.dir.y * t,
            });
          const mapToA = (u: number) =>
            alongWall(a, {
              x: b.start.x + b.dir.x * u,
              y: b.start.y + b.dir.y * u,
            });
          const uLo = mapToB(lo);
          const uHi = mapToB(hi);
          seams.push({
            roomId: rooms[i].id,
            wallIndex: a.index,
            span: { start: lo, end: hi },
            otherRoomId: rooms[j].id,
            otherWallIndex: b.index,
            otherStart: uLo,
            otherEnd: uHi,
            gap,
          });
          const vLo = Math.min(uLo, uHi);
          const vHi = Math.max(uLo, uHi);
          seams.push({
            roomId: rooms[j].id,
            wallIndex: b.index,
            span: { start: vLo, end: vHi },
            otherRoomId: rooms[i].id,
            otherWallIndex: a.index,
            otherStart: mapToA(vLo),
            otherEnd: mapToA(vHi),
            gap,
          });
        }
      }
    }
  }
  return seams;
}

/**
 * An opening classified as connecting two rooms: it sits on a seam, so the
 * neighbor's wall carries a matching hole at `otherOffset`/`otherWidth`
 * (the overlap of the opening with the seam, in the neighbor's wall-local
 * offsets). The opening itself stays stored on `roomId`'s wall as usual.
 */
export interface Portal {
  /** Id of the stored opening. */
  openingId: string;
  kind: OpeningKind;
  /** Room storing the opening, and its host wall. */
  roomId: string;
  wallIndex: number;
  /** Room the opening connects to, and the abutting wall there. */
  otherRoomId: string;
  otherWallIndex: number;
  /** Near edge of the matching hole on the neighbor's wall. */
  otherOffset: number;
  otherWidth: number;
}

/**
 * Every portal of the floor: each opening overlapping a seam on its wall
 * yields one portal per seam it overlaps (an opening straddling two
 * different neighbors connects to both).
 */
export function floorPortals(
  rooms: Room[],
  seams: WallSeam[] = floorSeams(rooms),
): Portal[] {
  const portals: Portal[] = [];
  for (const room of rooms) {
    const roomSeams = seams.filter((seam) => seam.roomId === room.id);
    for (const opening of room.openings) {
      for (const seam of roomSeams) {
        if (seam.wallIndex !== opening.wallIndex) continue;
        const lo = Math.max(opening.offset, seam.span.start);
        const hi = Math.min(opening.offset + opening.width, seam.span.end);
        if (hi - lo < MIN_PORTAL_OVERLAP) continue;
        // Both walls are collinear and unit-speed, so the seam's endpoint
        // mapping extends linearly across it (slope ±1).
        const slope =
          (seam.otherEnd - seam.otherStart) / (seam.span.end - seam.span.start);
        const uLo = seam.otherStart + (lo - seam.span.start) * slope;
        const uHi = seam.otherStart + (hi - seam.span.start) * slope;
        portals.push({
          openingId: opening.id,
          kind: opening.kind,
          roomId: room.id,
          wallIndex: opening.wallIndex,
          otherRoomId: seam.otherRoomId,
          otherWallIndex: seam.otherWallIndex,
          otherOffset: Math.min(uLo, uHi),
          otherWidth: Math.abs(uHi - uLo),
        });
      }
    }
  }
  return portals;
}

/** A hole a neighbor's portal cuts into this room's wall (wall-local). */
export interface PortalHole {
  /** Id of the owning opening — shared across both sides of the portal. */
  id: string;
  kind: OpeningKind;
  wallIndex: number;
  offset: number;
  width: number;
}

/** What one room's renderer needs from the floor's seams. */
export interface RoomSeamData {
  /** Shared-wall stretches per wall index (sorted, merged): rendered at
   * half thickness, since the neighbor draws the other half. */
  seamSpans: Map<number, SeamSpan[]>;
  /** Holes to cut for neighbor rooms' portal openings. */
  portalHoles: PortalHole[];
}

/** Merge overlapping/touching same-gap spans into a sorted list. Spans with
 * different gaps describe different wall assemblies and stay separate. */
function mergeSpans(spans: SeamSpan[]): SeamSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: SeamSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.gap === span.gap &&
      span.start <= last.end + MIN_SEAM_LENGTH
    ) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Per-room seam data for the whole floor. Rooms with no shared walls have
 * no entry — `get(room.id)` returning undefined means "render as before".
 */
export function floorSeamData(
  rooms: Room[],
  seams: WallSeam[] = floorSeams(rooms),
  portals: Portal[] = floorPortals(rooms, seams),
): Map<string, RoomSeamData> {
  const data = new Map<string, RoomSeamData>();
  const roomData = (roomId: string): RoomSeamData => {
    let entry = data.get(roomId);
    if (!entry) {
      entry = { seamSpans: new Map(), portalHoles: [] };
      data.set(roomId, entry);
    }
    return entry;
  };
  for (const seam of seams) {
    const entry = roomData(seam.roomId);
    const spans = entry.seamSpans.get(seam.wallIndex) ?? [];
    spans.push({ ...seam.span, gap: seam.gap });
    entry.seamSpans.set(seam.wallIndex, spans);
  }
  for (const entry of data.values()) {
    for (const [wallIndex, spans] of entry.seamSpans) {
      entry.seamSpans.set(wallIndex, mergeSpans(spans));
    }
  }
  for (const portal of portals) {
    roomData(portal.otherRoomId).portalHoles.push({
      id: portal.openingId,
      kind: portal.kind,
      wallIndex: portal.otherWallIndex,
      offset: portal.otherOffset,
      width: portal.otherWidth,
    });
  }
  return data;
}

/**
 * "Living room ↔ Kitchen" for the portal this opening forms, or null for a
 * plain (exterior or unshared) opening. The owning room reads first.
 */
export function portalLabel(
  rooms: Room[],
  portals: Portal[],
  openingId: string,
): string | null {
  const portal = portals.find((entry) => entry.openingId === openingId);
  if (!portal) return null;
  const name = (roomId: string) =>
    rooms.find((room) => room.id === roomId)?.name ?? "Untitled room";
  return `${name(portal.roomId)} ↔ ${name(portal.otherRoomId)}`;
}
