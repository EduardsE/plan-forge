import type { Face } from "./faces";
import {
  extractFaces,
  faceLabelPoint,
  insetPolygon,
  sideOfPoint,
} from "./faces";
import { pointInOutline, WALL_THICKNESS } from "./geometry";
import type { WallEdge, WallNode } from "./graph";
import { normalizeGraph } from "./graph";
import { matchRooms } from "./room-match";
import type {
  Floor,
  FurnitureItem,
  Opening,
  Point,
  Room,
  RoomOpening,
  RoomRecord,
} from "./types";
import { deriveMountTransform } from "./wall-mount";

/**
 * The derived-rooms bridge: the app stores a graph `Floor`, but scenes,
 * seams, the inspector and every per-room pure setter still speak `Room`.
 * `deriveFloor` turns the graph into renderable rooms whose interior outlines
 * sit exactly where the old per-room outlines sat (the face inset by half a
 * wall thickness), so nothing downstream changed. `updateDerivedRoom` runs an
 * edit expressed against a derived room back through the graph, and
 * `reconcileFloor` re-normalizes + re-matches after every mutation.
 */

const EPS = 1e-9;

/** A derived room's outline wall, tagged with the graph edge it came from. */
export interface WallRef {
  edgeId: string;
  side: 1 | -1;
}

/** A derived view of one graph face — never stored. */
export interface DerivedRoom extends Room {
  /** `wallRefs[i]` is the graph edge (and side) of outline wall `i`. */
  wallRefs: WallRef[];
  face: Face;
}

export interface DerivedFloor {
  rooms: DerivedRoom[];
  /** Furniture whose center lands in no room (dangling/off-plan items). */
  unassignedFurniture: FurnitureItem[];
  faces: Face[];
}

function nodesMap(floor: Floor): Map<string, WallNode> {
  return new Map(floor.nodes.map((n) => [n.id, n]));
}

function edgesMap(floor: Floor): Map<string, WallEdge> {
  return new Map(floor.edges.map((e) => [e.id, e]));
}

interface UnitLine {
  start: Point;
  dir: Point;
  length: number;
}

/** The a→b unit line of an edge, or null when degenerate/missing. */
function edgeLine(
  edge: WallEdge | undefined,
  nodes: Map<string, WallNode>,
): UnitLine | null {
  if (!edge) return null;
  const a = nodes.get(edge.a);
  const b = nodes.get(edge.b);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return null;
  return {
    start: { x: a.x, y: a.y },
    dir: { x: dx / length, y: dy / length },
    length,
  };
}

/** The start→end unit line of a derived outline wall, or null when degenerate. */
function wallLine(outline: Point[], wallIndex: number): UnitLine | null {
  const start = outline[wallIndex];
  const end = outline[(wallIndex + 1) % outline.length];
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return null;
  return { start, dir: { x: dx / length, y: dy / length }, length };
}

function projectOnto(line: UnitLine, p: Point): number {
  return (p.x - line.start.x) * line.dir.x + (p.y - line.start.y) * line.dir.y;
}

/**
 * Map a stored edge `Opening` onto derived outline wall `wallIndex`: project
 * its world span onto the wall and take the near-to-wall-start offset. Hinge
 * flips when the wall runs opposite the edge.
 */
function mapOpeningToWall(
  opening: Opening,
  outline: Point[],
  wallIndex: number,
  nodes: Map<string, WallNode>,
  edges: Map<string, WallEdge>,
): RoomOpening | null {
  const edge = edgeLine(edges.get(opening.edgeId), nodes);
  const wall = wallLine(outline, wallIndex);
  if (!edge || !wall) return null;
  const near = {
    x: edge.start.x + edge.dir.x * opening.offset,
    y: edge.start.y + edge.dir.y * opening.offset,
  };
  const far = {
    x: edge.start.x + edge.dir.x * (opening.offset + opening.width),
    y: edge.start.y + edge.dir.y * (opening.offset + opening.width),
  };
  const t0 = projectOnto(wall, near);
  const t1 = projectOnto(wall, far);
  const width = opening.width;
  const offset = Math.max(0, Math.min(Math.min(t0, t1), wall.length - width));
  const mapped: RoomOpening = {
    id: opening.id,
    kind: opening.kind,
    wallIndex,
    offset,
    width,
  };
  if (opening.hinge) {
    const sameDir = edge.dir.x * wall.dir.x + edge.dir.y * wall.dir.y >= 0;
    mapped.hinge = sameDir
      ? opening.hinge
      : opening.hinge === "start"
        ? "end"
        : "start";
  }
  return mapped;
}

/**
 * Turn a graph `Floor` into renderable rooms: every graph face becomes a
 * `DerivedRoom` (matched to its `RoomRecord`, or a stable fallback), its
 * interior outline the face inset by half a wall thickness, its openings the
 * edge openings on its side of each wall, its furniture the items whose
 * center it contains (first face wins; the rest are `unassignedFurniture`).
 * Mounted items get their `position`/`rotation` derived from the edge.
 */
export function deriveFloor(floor: Floor): DerivedFloor {
  const faces = extractFaces(floor);
  const match = matchRooms(floor.rooms, faces);
  const recordByFace = new Map<Face, RoomRecord>();
  for (const m of match.matched) recordByFace.set(m.face, m.record);

  const nodes = nodesMap(floor);
  const edges = edgesMap(floor);

  // Derive mounted furniture transforms once, floor-wide.
  const furniture = floor.furniture.map((item) => {
    if (!item.mount) return item;
    const transform = deriveMountTransform(item.mount, floor, item.footprint);
    if (!transform) return item;
    return {
      ...item,
      position: transform.position,
      rotation: transform.rotation,
    };
  });

  const rooms: DerivedRoom[] = [];
  const assigned = new Set<string>();
  for (const face of faces) {
    const outline = insetPolygon(face.polygon, WALL_THICKNESS / 2);
    if (!outline) continue;
    const record = recordByFace.get(face);
    const labelPoint = faceLabelPoint(face.polygon);
    const id = record ? record.id : `face:${face.nodeIds.join("|")}`;

    const wallRefs: WallRef[] = face.edgeIds.map((edgeId) => {
      const edge = edges.get(edgeId);
      const a = edge ? nodes.get(edge.a) : undefined;
      const b = edge ? nodes.get(edge.b) : undefined;
      const side = a && b ? sideOfPoint(a, b, labelPoint) : 1;
      return { edgeId, side };
    });

    const openings: RoomOpening[] = [];
    for (const opening of floor.openings) {
      const wallIndex = wallRefs.findIndex(
        (ref) => ref.edgeId === opening.edgeId && ref.side === opening.side,
      );
      if (wallIndex === -1) continue;
      const mapped = mapOpeningToWall(
        opening,
        outline,
        wallIndex,
        nodes,
        edges,
      );
      if (mapped) openings.push(mapped);
    }

    const roomFurniture: FurnitureItem[] = [];
    for (const item of furniture) {
      if (assigned.has(item.id)) continue;
      if (pointInOutline(outline, item.position)) {
        roomFurniture.push(item);
        assigned.add(item.id);
      }
    }

    rooms.push({
      id,
      ...(record?.name !== undefined ? { name: record.name } : {}),
      ...(record?.wallHeight !== undefined
        ? { wallHeight: record.wallHeight }
        : {}),
      outline,
      openings,
      furniture: roomFurniture,
      wallRefs,
      face,
    });
  }

  const unassignedFurniture = furniture.filter(
    (item) => !assigned.has(item.id),
  );
  return { rooms, unassignedFurniture, faces };
}

/**
 * Project a wall-local opening span (near-edge `wallOffset`, `width`) back
 * onto the edge `ref` names, in edge coordinates. Mirrors when the derived
 * wall runs opposite a→b, so the returned span is `[offset, offset + width]`
 * from the edge's node `a`.
 */
export function edgeOffsetOf(
  floor: Floor,
  ref: WallRef,
  room: DerivedRoom,
  wallIndex: number,
  wallOffset: number,
  width: number,
): number {
  const nodes = nodesMap(floor);
  const edges = edgesMap(floor);
  const edge = edgeLine(edges.get(ref.edgeId), nodes);
  const wall = wallLine(room.outline, wallIndex);
  if (!edge || !wall) return wallOffset;
  const near = {
    x: wall.start.x + wall.dir.x * wallOffset,
    y: wall.start.y + wall.dir.y * wallOffset,
  };
  const far = {
    x: wall.start.x + wall.dir.x * (wallOffset + width),
    y: wall.start.y + wall.dir.y * (wallOffset + width),
  };
  const t0 = projectOnto(edge, near);
  const t1 = projectOnto(edge, far);
  return Math.max(0, Math.min(Math.min(t0, t1), edge.length - width));
}

/**
 * "Living room ↔ Kitchen" for the portal an opening forms, or null for a
 * plain (exterior or unshared) opening — reimplemented from the graph's edge
 * face-adjacency: an opening whose host edge borders two rooms is a portal.
 * The room the opening opens into (its `side`) reads first.
 */
export function portalLabel(
  rooms: DerivedRoom[],
  floor: Floor,
  openingId: string,
): string | null {
  const opening = floor.openings.find((o) => o.id === openingId);
  if (!opening) return null;
  const adjacent = rooms.filter((room) =>
    room.wallRefs.some((ref) => ref.edgeId === opening.edgeId),
  );
  if (adjacent.length < 2) return null;
  const owner =
    adjacent.find((room) =>
      room.wallRefs.some(
        (ref) => ref.edgeId === opening.edgeId && ref.side === opening.side,
      ),
    ) ?? adjacent[0];
  const other = adjacent.find((room) => room !== owner) ?? adjacent[1];
  const name = (room: DerivedRoom) => room.name ?? "Untitled room";
  return `${name(owner)} ↔ ${name(other)}`;
}

function applyFurnitureDiff(
  floor: Floor,
  prev: FurnitureItem[],
  next: FurnitureItem[],
): Floor {
  const prevById = new Map(prev.map((i) => [i.id, i]));
  const nextById = new Map(next.map((i) => [i.id, i]));
  const removed = new Set<string>();
  let changed = false;
  for (const p of prev) {
    if (!nextById.has(p.id)) {
      removed.add(p.id);
      changed = true;
    }
  }
  const added = next.filter((n) => !prevById.has(n.id));
  if (added.length > 0) changed = true;
  for (const n of next) {
    const p = prevById.get(n.id);
    if (p && p !== n) changed = true;
  }
  if (!changed) return floor;
  const furniture = floor.furniture
    .filter((i) => !removed.has(i.id))
    .map((i) => {
      const n = nextById.get(i.id);
      return n && n !== i ? n : i;
    });
  return { ...floor, furniture: [...furniture, ...added] };
}

function applyRecordDiff(
  floor: Floor,
  roomId: string,
  room: DerivedRoom,
  next: Room,
): Floor {
  const nameChanged = next.name !== room.name;
  const heightChanged = next.wallHeight !== room.wallHeight;
  if (!nameChanged && !heightChanged) return floor;
  let found = false;
  const rooms = floor.rooms.map((rec) => {
    if (rec.id !== roomId) return rec;
    found = true;
    const updated: RoomRecord = { ...rec };
    if (nameChanged) {
      if (next.name === undefined) delete updated.name;
      else updated.name = next.name;
    }
    if (heightChanged) {
      if (next.wallHeight === undefined) delete updated.wallHeight;
      else updated.wallHeight = next.wallHeight;
    }
    return updated;
  });
  if (!found) return floor;
  return { ...floor, rooms };
}

/**
 * Apply a per-room edit (expressed against the derived room `roomId`) back to
 * the graph floor: furniture and name/height diffs are mapped onto
 * `floor.furniture` / `floor.rooms`, then normalized. Openings are no longer
 * routed here — they mutate the graph directly through the floor-level setters
 * in `model/openings.ts`. A no-op edit (fn returns the same room) returns the
 * same floor reference.
 */
export function updateDerivedRoom(
  floor: Floor,
  derived: DerivedFloor,
  roomId: string,
  fn: (room: Room) => Room,
): Floor {
  const room = derived.rooms.find((r) => r.id === roomId);
  if (!room) return floor;
  const next = fn(room);
  if (next === room) return floor;

  let nextFloor = applyFurnitureDiff(floor, room.furniture, next.furniture);
  nextFloor = applyRecordDiff(nextFloor, roomId, room, next);
  if (nextFloor === floor) return floor;
  return reconcileFloor(nextFloor);
}

function sameRecords(a: RoomRecord[], b: RoomRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Normalize the graph and re-match the room registry against its faces —
 * the tail of every mutation path, so stored state is always well-formed and
 * identity-matched. Returns the same floor reference when nothing changed
 * (the pure-setter no-op contract, floor-wide).
 */
export function reconcileFloor(floor: Floor): Floor {
  const g = normalizeGraph({
    nodes: floor.nodes,
    edges: floor.edges,
    openings: floor.openings,
  });
  const graphChanged =
    g.nodes !== floor.nodes ||
    g.edges !== floor.edges ||
    g.openings !== floor.openings;
  const faces = extractFaces(g);
  const match = matchRooms(floor.rooms, faces);
  const recordsChanged = !sameRecords(match.records, floor.rooms);
  if (!graphChanged && !recordsChanged) return floor;
  return {
    ...floor,
    nodes: g.nodes,
    edges: g.edges,
    openings: g.openings,
    rooms: recordsChanged ? match.records : floor.rooms,
  };
}
