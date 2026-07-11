import { catalogItemById } from "./catalog";
import type { FurnitureItem, Point, Room, Stack } from "./types";

/**
 * Pure geometry for stacked furniture (a table lamp on a desk, a plant on the
 * credenza): which catalog items host and ride, where a stack anchor resolves
 * in plan coordinates, and how riders follow their host through mutations.
 * Rendering-agnostic like the rest of the model — the hover/snap placement
 * math lives in `src/lib/stack-place.ts` (parallel to `mount-place.ts`).
 *
 * A stack stores the rider-center offset from the host center in the host's
 * unrotated local frame, so the rider turns and travels with the host for
 * free: `deriveStackPosition` spins the offset by the host's rotation.
 */

/** Flat-topped categories whose items can carry riders. */
const HOST_CATEGORIES = new Set(["tables", "storage"]);
/** Small-footprint categories whose items can stand on a host. */
const RIDER_CATEGORIES = new Set(["lighting", "decor", "plants"]);

/**
 * The visual top surface as a fraction of the footprint height, where a
 * catalog item's composed body doesn't reach its full box: the desk's
 * worktop sits at 0.66h (`deskParts` in `furniture-parts.ts` — the monitor
 * block occupies the rest), so riders land on the worktop, not in the air.
 */
const SURFACE_HEIGHT_RATIO: Record<string, number> = {
  desk: 0.66,
};

/** Whether a catalog item can host riders on its top (tables, storage). */
export function isStackHost(catalogId: string): boolean {
  const category = catalogItemById(catalogId)?.category;
  return category !== undefined && HOST_CATEGORIES.has(category);
}

/** Whether a catalog item can stand on a host (lighting, decor, plants). */
export function isStackRider(catalogId: string): boolean {
  const category = catalogItemById(catalogId)?.category;
  return category !== undefined && RIDER_CATEGORIES.has(category);
}

/** Whether a placed item can carry riders right now: a host-category item
 * standing on the floor (never mounted, never itself a rider). */
export function canHostStack(item: FurnitureItem): boolean {
  return !item.mount && !item.stack && isStackHost(item.catalogId);
}

/** Height of `item`'s top surface above the floor — where a rider stands. */
export function stackSurfaceHeight(item: FurnitureItem): number {
  return item.footprint.height * (SURFACE_HEIGHT_RATIO[item.catalogId] ?? 1);
}

/**
 * The plan position a stack anchor resolves to: the host's center plus the
 * local (dx, dy) offset spun by the host's rotation. Matches the renderers'
 * `rotation-y` convention (positive degrees take +x toward -y in plan
 * coords), i.e. the same frame as `footprintCorners`.
 */
export function deriveStackPosition(host: FurnitureItem, stack: Stack): Point {
  const rad = (host.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: host.position.x + stack.dx * cos + stack.dy * sin,
    y: host.position.y - stack.dx * sin + stack.dy * cos,
  };
}

/** A plan point expressed in the host's unrotated local frame — the inverse
 * of `deriveStackPosition`'s offset rotation. */
export function stackOffsetOf(host: FurnitureItem, point: Point): Point {
  const rad = (host.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const wx = point.x - host.position.x;
  const wy = point.y - host.position.y;
  return { x: wx * cos - wy * sin, y: wx * sin + wy * cos };
}

/**
 * Half extents (host-local) a rider's center may roam so its footprint stays
 * inside the host's top: the host's half size minus the rider's half hull at
 * its rotation *relative to the host*. Negative extents mean the rider is
 * larger than the host top on that axis — it doesn't fit.
 */
export function stackFreedom(
  host: FurnitureItem,
  riderFootprint: { width: number; depth: number },
  riderRotation: number,
): { x: number; y: number } {
  const rel = ((riderRotation - host.rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rel));
  const sin = Math.abs(Math.sin(rel));
  const hullW = riderFootprint.width * cos + riderFootprint.depth * sin;
  const hullD = riderFootprint.width * sin + riderFootprint.depth * cos;
  return {
    x: (host.footprint.width - hullW) / 2,
    y: (host.footprint.depth - hullD) / 2,
  };
}

/** Whether the rider's footprint fits on the host's top at all. */
export function riderFitsHost(
  host: FurnitureItem,
  riderFootprint: { width: number; depth: number },
  riderRotation: number,
): boolean {
  const freedom = stackFreedom(host, riderFootprint, riderRotation);
  return freedom.x >= 0 && freedom.y >= 0;
}

/** Clamp a host-local offset into the rider's freedom; an axis with negative
 * freedom (rider larger than the host top) centers, like a too-small room. */
export function clampStackOffset(
  host: FurnitureItem,
  offset: Point,
  riderFootprint: { width: number; depth: number },
  riderRotation: number,
): Point {
  const freedom = stackFreedom(host, riderFootprint, riderRotation);
  const clamp = (value: number, half: number) =>
    half < 0 ? 0 : Math.min(Math.max(value, -half), half);
  return { x: clamp(offset.x, freedom.x), y: clamp(offset.y, freedom.y) };
}

/**
 * Re-derive every rider standing on `hostId` after the host moved or spun:
 * positions re-resolve from the (already updated) host, and `rotationDelta`
 * — how far the host just turned — spins each rider's own facing with it.
 * Offsets stay valid untouched: the rider's hull relative to the host is
 * unchanged when both turn together.
 */
export function syncStackedRiders(
  room: Room,
  hostId: string,
  rotationDelta = 0,
): Room {
  const host = room.furniture.find((item) => item.id === hostId);
  if (!host) return room;
  let changed = false;
  const furniture = room.furniture.map((item) => {
    if (item.stack?.hostId !== hostId) return item;
    changed = true;
    return {
      ...item,
      position: deriveStackPosition(host, item.stack),
      rotation: (((item.rotation + rotationDelta) % 360) + 360) % 360,
    };
  });
  return changed ? { ...room, furniture } : room;
}
