import type {
  Floor,
  FurnitureItem,
  Opening,
  Point,
  Stair,
  WallEdge,
  WallNode,
} from "#/lib/model";
import {
  MAX_SILL_OVERHANG,
  MAX_STAIR_WIDTH,
  MAX_WALL_HEIGHT,
  MAX_WALL_THICKNESS,
  MIN_STAIR_WIDTH,
  MIN_WALL_HEIGHT,
  MIN_WALL_THICKNESS,
  reconcileFloor,
} from "#/lib/model";
import type { Unit } from "#/lib/units";

/**
 * localStorage autosave for the floor model. The model is plain JSON already;
 * this module owns the storage payload — serialization, and the paranoid
 * deserialization that keeps a stale or hand-edited save from crashing the
 * scenes (anything malformed hydrates as "no save").
 */

export const STORAGE_KEY = "planforge.room";

/** Bumped whenever the payload shape changes; older saves are discarded. */
const STORAGE_VERSION = 6;

/**
 * Versions this build can read. v6 is the wall-graph payload; every earlier
 * version stored per-room outlines, which the graph model can't reconstruct,
 * so they're discarded (no migration — the owner's explicit call: no users
 * yet).
 */
const READABLE_VERSIONS = new Set([STORAGE_VERSION]);

export interface SavedState {
  floor: Floor;
  /** Display unit the user last picked. */
  unit: Unit;
  /** Epoch ms of the write, so a reload reports "saved 5 min ago" honestly. */
  savedAt: number;
  /**
   * Manual sun-anchor azimuth in degrees (world `atan2(z, x)`), set from the
   * sun dial. Absent = automatic (the most-glazed wall). Optional so pre-dial
   * v6 saves stay readable — no version bump.
   */
  sunAzimuthDeg?: number;
}

export function serializeSavedState(state: SavedState): string {
  return JSON.stringify({ version: STORAGE_VERSION, ...state });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function areNodes(value: unknown): value is WallNode[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return false;
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || node.id.length === 0) return false;
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) return false;
    ids.add(node.id);
  }
  return ids.size === value.length;
}

function areEdges(value: unknown, nodeIds: Set<string>): value is WallEdge[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return false;
    const edge = raw as Record<string, unknown>;
    if (typeof edge.id !== "string" || edge.id.length === 0) return false;
    if (typeof edge.a !== "string" || typeof edge.b !== "string") return false;
    if (edge.a === edge.b) return false;
    if (!nodeIds.has(edge.a) || !nodeIds.has(edge.b)) return false;
    if (
      edge.thickness !== undefined &&
      (!isFiniteNumber(edge.thickness) ||
        edge.thickness < MIN_WALL_THICKNESS ||
        edge.thickness > MAX_WALL_THICKNESS)
    ) {
      return false;
    }
    ids.add(edge.id);
  }
  return ids.size === value.length;
}

function edgeLengths(
  nodes: WallNode[],
  edges: WallEdge[],
): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lengths = new Map<string, number>();
  for (const edge of edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    lengths.set(edge.id, a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0);
  }
  return lengths;
}

function areOpenings(
  value: unknown,
  edgeLength: Map<string, number>,
): value is Opening[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return false;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0) return false;
    if (o.kind !== "door" && o.kind !== "window") return false;
    if (typeof o.edgeId !== "string" || !edgeLength.has(o.edgeId)) return false;
    if (o.side !== 1 && o.side !== -1) return false;
    if (!isFiniteNumber(o.offset) || o.offset < 0) return false;
    if (!isFiniteNumber(o.width) || o.width <= 0) return false;
    const length = edgeLength.get(o.edgeId) ?? 0;
    if (o.offset + o.width > length + 1e-6) return false;
    if (o.hinge !== undefined && o.hinge !== "start" && o.hinge !== "end") {
      return false;
    }
    // Optional vertical extent: sill (windows only) and head, floor-relative.
    if (
      o.sill !== undefined &&
      (o.kind !== "window" || !isFiniteNumber(o.sill) || o.sill < 0)
    ) {
      return false;
    }
    if (o.head !== undefined) {
      const bottom = typeof o.sill === "number" ? o.sill : 0;
      if (!isFiniteNumber(o.head) || o.head <= bottom) return false;
    }
    if (
      o.sillOverhang !== undefined &&
      (o.kind !== "window" ||
        !isFiniteNumber(o.sillOverhang) ||
        o.sillOverhang < 0 ||
        o.sillOverhang > MAX_SILL_OVERHANG)
    ) {
      return false;
    }
    if (
      o.sillMaterial !== undefined &&
      (o.kind !== "window" ||
        (o.sillMaterial !== "white" && o.sillMaterial !== "wood"))
    ) {
      return false;
    }
    ids.add(o.id);
  }
  return ids.size === value.length;
}

/** A mount anchors to an existing edge, on a definite side. */
function isWallMount(value: unknown, edgeIds: Set<string>): boolean {
  if (typeof value !== "object" || value === null) return false;
  const mount = value as Record<string, unknown>;
  return (
    typeof mount.edgeId === "string" &&
    edgeIds.has(mount.edgeId) &&
    (mount.side === 1 || mount.side === -1) &&
    isFiniteNumber(mount.offset) &&
    isFiniteNumber(mount.elevation)
  );
}

function isStack(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const stack = value as Record<string, unknown>;
  return (
    typeof stack.hostId === "string" &&
    isFiniteNumber(stack.dx) &&
    isFiniteNumber(stack.dy)
  );
}

function isFurnitureItem(
  value: unknown,
  edgeIds: Set<string>,
): value is FurnitureItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const footprint = item.footprint as Record<string, unknown> | null;
  return (
    typeof item.id === "string" &&
    typeof item.catalogId === "string" &&
    isPoint(item.position) &&
    isFiniteNumber(item.rotation) &&
    typeof footprint === "object" &&
    footprint !== null &&
    isFiniteNumber(footprint.width) &&
    footprint.width > 0 &&
    isFiniteNumber(footprint.depth) &&
    footprint.depth > 0 &&
    isFiniteNumber(footprint.height) &&
    footprint.height > 0 &&
    (item.mount === undefined || isWallMount(item.mount, edgeIds)) &&
    (item.stack === undefined || (isStack(item.stack) && !item.mount)) &&
    (item.colorway === undefined || typeof item.colorway === "string")
  );
}

/** Every stack anchor must point at a real, floor-standing host. */
function stacksResolve(furniture: FurnitureItem[]): boolean {
  const byId = new Map(furniture.map((item) => [item.id, item]));
  return furniture.every((item) => {
    if (!item.stack) return true;
    const host = byId.get(item.stack.hostId);
    return (
      host !== undefined && host.id !== item.id && !host.stack && !host.mount
    );
  });
}

function areRooms(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return false;
    const room = raw as Record<string, unknown>;
    if (typeof room.id !== "string" || room.id.length === 0) return false;
    if (room.name !== undefined && typeof room.name !== "string") return false;
    if (!isPoint(room.anchor)) return false;
    if (
      room.wallHeight !== undefined &&
      (!isFiniteNumber(room.wallHeight) ||
        room.wallHeight < MIN_WALL_HEIGHT ||
        room.wallHeight > MAX_WALL_HEIGHT)
    ) {
      return false;
    }
    ids.add(room.id);
  }
  return ids.size === value.length;
}

function areStairs(value: unknown): value is Stair[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return false;
    const stair = raw as Record<string, unknown>;
    if (typeof stair.id !== "string" || stair.id.length === 0) return false;
    if (!isPoint(stair.position)) return false;
    if (!isFiniteNumber(stair.rotation)) return false;
    if (
      !isFiniteNumber(stair.width) ||
      stair.width < MIN_STAIR_WIDTH ||
      stair.width > MAX_STAIR_WIDTH
    ) {
      return false;
    }
    ids.add(stair.id);
  }
  return ids.size === value.length;
}

/**
 * `Floor` minus the fields a v6 save may omit — the wall-graph payload
 * predates floor identity and stairs, so a v6 read fills them in
 * (`deserializeSavedState`) rather than requiring them here.
 */
type StoredFloor = Omit<Floor, "id" | "stairs"> & {
  id?: string;
  stairs?: Stair[];
};

function isFloor(value: unknown): value is StoredFloor {
  if (typeof value !== "object" || value === null) return false;
  const floor = value as Record<string, unknown>;
  if (
    floor.id !== undefined &&
    (typeof floor.id !== "string" || floor.id.length === 0)
  ) {
    return false;
  }
  if (floor.name !== undefined && typeof floor.name !== "string") return false;
  if (!areNodes(floor.nodes)) return false;
  const nodeIds = new Set(floor.nodes.map((n) => n.id));
  if (!areEdges(floor.edges, nodeIds)) return false;
  const edgeIds = new Set(floor.edges.map((e) => e.id));
  const lengths = edgeLengths(floor.nodes, floor.edges);
  if (!areOpenings(floor.openings, lengths)) return false;
  if (!Array.isArray(floor.furniture)) return false;
  if (!floor.furniture.every((item) => isFurnitureItem(item, edgeIds))) {
    return false;
  }
  if (!stacksResolve(floor.furniture as FurnitureItem[])) return false;
  if (!areRooms(floor.rooms)) return false;
  if (floor.stairs !== undefined && !areStairs(floor.stairs)) return false;
  return true;
}

/**
 * Parse a raw localStorage payload back into saved state. Returns null —
 * meaning "start fresh" — for missing, unparsable, wrong-version, or
 * structurally invalid saves. A valid v6 floor is normalized + re-matched on
 * read (`reconcileFloor`) so hydrated state is always well-formed.
 */
export function deserializeSavedState(json: string | null): SavedState | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const state = parsed as Record<string, unknown>;
  if (
    typeof state.version !== "number" ||
    !READABLE_VERSIONS.has(state.version)
  ) {
    return null;
  }
  if (state.unit !== "cm" && state.unit !== "m") return null;
  if (!isFiniteNumber(state.savedAt)) return null;
  if (state.sunAzimuthDeg !== undefined && !isFiniteNumber(state.sunAzimuthDeg))
    return null;
  if (!isFloor(state.floor)) return null;
  const floor: Floor = {
    ...state.floor,
    id: state.floor.id ?? crypto.randomUUID(),
    stairs: state.floor.stairs ?? [],
  };
  return {
    floor: reconcileFloor(floor),
    unit: state.unit,
    savedAt: state.savedAt,
    ...(state.sunAzimuthDeg !== undefined
      ? { sunAzimuthDeg: state.sunAzimuthDeg }
      : {}),
  };
}

/** "saved just now" → "saved 5 min ago" → "saved 3 h ago" → "saved 2 d ago". */
export function formatSavedStatus(savedAt: number, now: number): string {
  const seconds = Math.max(0, (now - savedAt) / 1000);
  if (seconds < 60) return "saved just now";
  if (seconds < 3600) return `saved ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `saved ${Math.floor(seconds / 3600)} h ago`;
  return `saved ${Math.floor(seconds / 86400)} d ago`;
}
