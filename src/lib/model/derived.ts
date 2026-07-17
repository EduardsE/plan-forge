import type { Face } from "./faces";
import { extractFaces, insetPolygon } from "./faces";
import { pointInOutline, WALL_THICKNESS } from "./geometry";
import type { WallEdge } from "./graph";
import { normalizeGraph } from "./graph";
import { matchRooms } from "./room-match";
import type { Floor, FurnitureItem, Room, RoomRecord } from "./types";
import { deriveMountTransform } from "./wall-mount";

/**
 * The derived-rooms bridge: the app stores a graph `Floor`, but the scenes,
 * the inspector and the per-room pure setters still speak `Room`.
 * `deriveFloor` turns the graph into renderable rooms whose interior outlines
 * sit exactly where the old per-room outlines sat (the face inset by half a
 * wall thickness). Openings are edge-anchored on the graph and rendered
 * straight from `floor.openings`, so a derived room carries only the *count*
 * of the openings on its walls (for the inspector), not per-wall copies.
 * `updateDerivedRoom` runs an edit expressed against a derived room back
 * through the graph, and `reconcileFloor` re-normalizes + re-matches after
 * every mutation.
 */

/** A derived room's outline wall, tagged with the graph edge it came from. */
export interface WallRef {
  edgeId: string;
  side: 1 | -1;
}

/** A derived view of one graph face — never stored. */
export interface DerivedRoom extends Room {
  /** `wallRefs[i]` is the graph edge (and side) of outline wall `i`. */
  wallRefs: WallRef[];
  /** How many `floor.openings` sit on this room's walls (its side). */
  openingCount: number;
  face: Face;
}

export interface DerivedFloor {
  rooms: DerivedRoom[];
  /** Furniture whose center lands in no room (dangling/off-plan items). */
  unassignedFurniture: FurnitureItem[];
  faces: Face[];
}

function edgesMap(floor: Floor): Map<string, WallEdge> {
  return new Map(floor.edges.map((e) => [e.id, e]));
}

/**
 * Turn a graph `Floor` into renderable rooms: every graph face becomes a
 * `DerivedRoom` (matched to its `RoomRecord`, or a stable fallback), its
 * interior outline the face inset by half a wall thickness, its `openingCount`
 * the number of `floor.openings` on its walls, its furniture the items whose
 * center it contains (first face wins; the rest are `unassignedFurniture`).
 * Mounted items get their `position`/`rotation` derived from the edge.
 */
export function deriveFloor(floor: Floor): DerivedFloor {
  const faces = extractFaces(floor);
  const match = matchRooms(floor.rooms, faces);
  const recordByFace = new Map<Face, RoomRecord>();
  for (const m of match.matched) recordByFace.set(m.face, m.record);

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
    const id = record ? record.id : `face:${face.nodeIds.join("|")}`;

    // A kept face has positive shoelace winding, so its interior always lies
    // on the `+1` (`sideOfPoint`-positive) side of the traversal direction.
    // Boundary step `i` walks `nodeIds[i]`→`nodeIds[(i+1)%n]` along
    // `edgeIds[i]`: `side` is `+1` when the edge runs a→b with the traversal,
    // `-1` when against it. This reads the side straight off the orientation —
    // no point-vs-line test, so it stays correct for concave faces (a reflex
    // vertex can put the label point across an edge's line) and for a stub
    // edge that appears twice in one face (each occurrence keyed by its step).
    const wallRefs: WallRef[] = face.edgeIds.map((edgeId, i) => {
      const edge = edges.get(edgeId);
      const side: 1 | -1 = edge && edge.a === face.nodeIds[i] ? 1 : -1;
      return { edgeId, side };
    });

    // Openings live on the graph edges (rendered from `floor.openings`); a
    // room only needs to know how many sit on its walls, for the inspector.
    const openingCount = floor.openings.reduce(
      (count, opening) =>
        wallRefs.some(
          (ref) => ref.edgeId === opening.edgeId && ref.side === opening.side,
        )
          ? count + 1
          : count,
      0,
    );

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
      openings: [],
      openingCount,
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
