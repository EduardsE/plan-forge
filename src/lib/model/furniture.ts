import { catalogItemById } from "./catalog";
import {
  clampStackOffset,
  deriveStackPosition,
  stackOffsetOf,
  syncStackedRiders,
} from "./stack";
import type {
  Footprint,
  FurnitureItem,
  Point,
  Room,
  Stack,
  WallMount,
} from "./types";
import { deriveMountTransform, wallFrames } from "./wall-mount";

/**
 * Pure furniture mutations for the selection toolbar. Every function returns
 * a new Room (and new furniture array) — callers hold rooms in React state,
 * so nothing here mutates in place. Unknown ids return the room unchanged.
 */

/** Plan offset applied to a duplicated item so the copy is visibly beside its source. */
export const DUPLICATE_OFFSET = 0.4;

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Re-fit a stacked rider onto its host after the rider itself changed (its
 * rotation, size, or an asked-for position): the anchor offsets re-derive
 * from the rider's plan position and clamp back inside the host's top. */
function restackRider(room: Room, item: FurnitureItem): FurnitureItem {
  if (!item.stack) return item;
  const host = room.furniture.find((entry) => entry.id === item.stack?.hostId);
  if (!host) return item;
  const offset = clampStackOffset(
    host,
    stackOffsetOf(host, item.position),
    item.footprint,
    item.rotation,
  );
  const stack: Stack = { ...item.stack, dx: offset.x, dy: offset.y };
  return { ...item, stack, position: deriveStackPosition(host, stack) };
}

export function rotateFurniture(
  room: Room,
  id: string,
  deltaDeg: number,
): Room {
  const next = {
    ...room,
    furniture: room.furniture.map((item) =>
      item.id === id
        ? restackRider(room, {
            ...item,
            rotation: normalizeDeg(item.rotation + deltaDeg),
          })
        : item,
    ),
  };
  // A spun host carries its riders around with it.
  return syncStackedRiders(next, id, deltaDeg);
}

export function duplicateFurniture(
  room: Room,
  id: string,
  newId: string,
): Room {
  const source = room.furniture.find((item) => item.id === id);
  if (!source) return room;
  // A wall-mounted copy shifts along its host wall (staying on the wall)
  // instead of floating out into the room like a floor copy.
  if (source.mount) {
    const frame = wallFrames(room.outline).find(
      (f) => f.index === source.mount?.wallIndex,
    );
    if (frame) {
      const maxOffset = Math.max(0, frame.length - source.footprint.width);
      const offset = Math.min(
        source.mount.offset + DUPLICATE_OFFSET,
        maxOffset,
      );
      const { position, rotation } = deriveMountTransform(
        frame,
        offset,
        source.footprint,
      );
      const mounted: FurnitureItem = {
        ...source,
        id: newId,
        position,
        rotation,
        mount: { ...source.mount, offset },
      };
      return { ...room, furniture: [...room.furniture, mounted] };
    }
  }
  // A stacked copy shifts along the host's top (staying stacked) instead of
  // floating out into the room like a floor copy.
  if (source.stack) {
    const host = room.furniture.find(
      (entry) => entry.id === source.stack?.hostId,
    );
    if (host) {
      const offset = clampStackOffset(
        host,
        {
          x: source.stack.dx + DUPLICATE_OFFSET,
          y: source.stack.dy + DUPLICATE_OFFSET,
        },
        source.footprint,
        source.rotation,
      );
      const stack: Stack = { ...source.stack, dx: offset.x, dy: offset.y };
      const stacked: FurnitureItem = {
        ...source,
        id: newId,
        stack,
        position: deriveStackPosition(host, stack),
      };
      return { ...room, furniture: [...room.furniture, stacked] };
    }
  }
  const copy: FurnitureItem = {
    ...source,
    id: newId,
    position: {
      x: source.position.x + DUPLICATE_OFFSET,
      y: source.position.y + DUPLICATE_OFFSET,
    },
  };
  return { ...room, furniture: [...room.furniture, copy] };
}

/** A move-drag update: the snapped center, plus (for a wall item) the new
 * derived rotation and mount. `mount` absent leaves the item's mount as-is;
 * `stack` set re-anchors the rider (null unstacks it to the floor), absent
 * re-fits an existing anchor around the new position. */
export interface FurnitureUpdate {
  position: Point;
  rotation?: number;
  mount?: WallMount;
  stack?: Stack | null;
}

/** Apply a move-drag update to one item (absolute reposition, plan coords). */
export function updateFurniture(
  room: Room,
  id: string,
  update: FurnitureUpdate,
): Room {
  const next = {
    ...room,
    furniture: room.furniture.map((item) => {
      if (item.id !== id) return item;
      const moved: FurnitureItem = {
        ...item,
        position: update.position,
        rotation: update.rotation ?? item.rotation,
        ...(update.mount !== undefined ? { mount: update.mount } : {}),
      };
      if (update.stack === null) {
        delete moved.stack;
        return moved;
      }
      if (update.stack !== undefined) return { ...moved, stack: update.stack };
      // A stacked item repositioned without an explicit anchor (the
      // inspector's POS fields) stays on its host: the offsets re-derive
      // from the asked-for position, clamped onto the top.
      return restackRider(room, moved);
    }),
  };
  const source = room.furniture.find((item) => item.id === id);
  if (!source) return next;
  // A moved (or re-derived) host carries its riders with it.
  return syncStackedRiders(
    next,
    id,
    (update.rotation ?? source.rotation) - source.rotation,
  );
}

/** Smallest editable footprint dimension (meters) — the properties card's floor. */
export const MIN_FOOTPRINT_SIZE = 0.1;

/** Clamp an edited dimension to the minimum; an untouched one passes through
 * as-is, so e.g. a rug's 0.01 m height survives a width edit. */
function clampDimension(value: number, current: number): number {
  if (value === current) return value;
  return Math.max(value, MIN_FOOTPRINT_SIZE);
}

/**
 * Replace an item's footprint (the properties card's size fields). `position`
 * is the footprint center, so a floor item scales about its center for free.
 * A wall-mounted item stays flush on its host wall: width clamps to the wall,
 * the near-edge offset re-clamps so the item still fits, position/rotation
 * re-derive from the mount, and the elevation lifts if the new height would
 * dip the body below the floor. Unknown ids return the room unchanged.
 */
export function setFurnitureFootprint(
  room: Room,
  id: string,
  footprint: Footprint,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item) return room;
  let next: FurnitureItem = {
    ...item,
    footprint: {
      width: clampDimension(footprint.width, item.footprint.width),
      depth: clampDimension(footprint.depth, item.footprint.depth),
      height: clampDimension(footprint.height, item.footprint.height),
    },
  };
  if (item.mount) {
    const frame = wallFrames(room.outline).find(
      (f) => f.index === item.mount?.wallIndex,
    );
    if (frame) {
      const resized = {
        ...next.footprint,
        width: Math.min(next.footprint.width, frame.length),
      };
      const offset = Math.min(
        Math.max(item.mount.offset, 0),
        frame.length - resized.width,
      );
      const elevation = Math.max(item.mount.elevation, resized.height / 2);
      const { position, rotation } = deriveMountTransform(
        frame,
        offset,
        resized,
      );
      next = {
        ...next,
        footprint: resized,
        position,
        rotation,
        mount: { ...item.mount, wallIndex: frame.index, offset, elevation },
      };
    }
  }
  // A resized rider re-fits onto its host's top.
  next = restackRider(room, next);
  const updated = {
    ...room,
    furniture: room.furniture.map((entry) => (entry.id === id ? next : entry)),
  };
  // A resized host re-fits its riders into the new top (they ride at the new
  // height for free — render elevation derives from the host's footprint).
  return {
    ...updated,
    furniture: updated.furniture.map((entry) =>
      entry.stack?.hostId === id ? restackRider(updated, entry) : entry,
    ),
  };
}

/**
 * Set an item's rotation to an absolute angle (the properties card's degrees
 * field), normalized to [0, 360). Mounted items (rotation is derived from the
 * wall), unknown ids and no-op angles return the room unchanged.
 */
export function setFurnitureRotation(
  room: Room,
  id: string,
  deg: number,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item || item.mount || !Number.isFinite(deg)) return room;
  const rotation = normalizeDeg(deg);
  if (rotation === item.rotation) return room;
  const next = {
    ...room,
    furniture: room.furniture.map((entry) =>
      entry.id === id ? restackRider(room, { ...entry, rotation }) : entry,
    ),
  };
  // A spun host carries its riders around with it.
  return syncStackedRiders(next, id, rotation - item.rotation);
}

/**
 * Set a wall-mounted item's center elevation, clamped so the body stays above
 * the floor. The ceiling clamp is the caller's — wall height is a rendering
 * constant, not model data. Floor items and unknown ids return the room
 * unchanged.
 */
export function setMountElevation(
  room: Room,
  id: string,
  elevation: number,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item?.mount || !Number.isFinite(elevation)) return room;
  const clamped = Math.max(elevation, item.footprint.height / 2);
  if (clamped === item.mount.elevation) return room;
  const mount = { ...item.mount, elevation: clamped };
  return {
    ...room,
    furniture: room.furniture.map((entry) =>
      entry.id === id ? { ...entry, mount } : entry,
    ),
  };
}

export function removeFurniture(room: Room, id: string): Room {
  return {
    ...room,
    // A deleted host drops its riders to the floor where they stand: the
    // anchor goes, the (already derived) world position stays.
    furniture: room.furniture
      .filter((item) => item.id !== id)
      .map((item) => {
        if (item.stack?.hostId !== id) return item;
        const { stack: _dropped, ...floored } = item;
        return floored;
      }),
  };
}

/** A dropped catalog item joining the room (objects-panel placement). */
export function addFurniture(room: Room, item: FurnitureItem): Room {
  return { ...room, furniture: [...room.furniture, item] };
}

/**
 * Set (or clear, with `null`) an item's material colorway — the inspector's
 * MATERIAL swatches. A no-op (same value, or clearing an already-plain item)
 * and unknown ids return the room unchanged so no empty history step lands.
 */
export function setFurnitureColorway(
  room: Room,
  id: string,
  colorway: string | null,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item) return room;
  if (colorway === null) {
    if (item.colorway === undefined) return room;
    return {
      ...room,
      furniture: room.furniture.map((entry) => {
        if (entry.id !== id) return entry;
        const { colorway: _dropped, ...plain } = entry;
        return plain;
      }),
    };
  }
  if (item.colorway === colorway) return room;
  return {
    ...room,
    furniture: room.furniture.map((entry) =>
      entry.id === id ? { ...entry, colorway } : entry,
    ),
  };
}

/**
 * Plan positions of the rotated footprint's four corners. The rotation
 * matches the renderers' `rotation-y` (degrees about world up; plan y points
 * down, so a positive turn takes +x toward -y).
 */
export function footprintCorners(item: FurnitureItem): Point[] {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = item.footprint.width / 2;
  const hd = item.footprint.depth / 2;
  const offsets: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return offsets.map(([ox, oy]) => ({
    x: item.position.x + ox * cos + oy * sin,
    y: item.position.y - ox * sin + oy * cos,
  }));
}

/**
 * Display name from the catalog ("sofa-2" → "Sofa · 2-seat"); ids missing
 * from the catalog fall back to a title-cased slug.
 */
export function furnitureDisplayName(catalogId: string): string {
  const entry = catalogItemById(catalogId);
  if (entry) return entry.name;
  return catalogId
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Selection readout text, mockup format: "92 × 88 · H 45 cm". */
export function formatFootprintCm({ width, depth, height }: Footprint): string {
  const cm = (meters: number) => Math.round(meters * 100).toString();
  return `${cm(width)} × ${cm(depth)} · H ${cm(height)} cm`;
}
