import {
  type FurnitureItem,
  footprintCorners,
  type Point,
  type Room,
  syncStackedRiders,
  updateFurniture,
} from "#/lib/model";
import {
  type Obstacle,
  rotatedFootprintSize,
  separateFromWalls,
} from "#/lib/place";

/**
 * Collision awareness for the selection toolbar's mutations. Two concerns,
 * one soft and one hard:
 *
 * - **Containment (hard):** rotate and duplicate change an item's hull or
 *   position without the move drag that would otherwise resolve it against the
 *   walls, so a rotated desk pressed to a wall pokes through it.
 *   `containFurniture` pushes the item back out of any wall slab it penetrates
 *   (`separateFromWalls`). Furniture is floor-level now — it may sit anywhere
 *   no wall solid is (a room, the dead band at a shared wall, the open canvas),
 *   so the boundary is the wall slabs, not a room outline.
 * - **Overlap (soft):** two floor items sharing floor space isn't blocked, it's
 *   flagged. `overlappingFurnitureIds` returns the ids the renderers tint as a
 *   warning. Wall-mounted items (they hang above the floor) and rugs (furniture
 *   is *meant* to sit on them) never participate.
 */

/**
 * Below this footprint height an item reads as a floor covering (a rug, height
 * 0.01) — furniture rests on top of it, so it's exempt from overlap warnings.
 */
const FLOOR_COVERING_MAX_HEIGHT = 0.05;
/**
 * Required penetration depth (meters) before two footprints count as
 * overlapping — so flush-snapped neighbors sharing an edge don't false-warn.
 */
const OVERLAP_PENETRATION = 0.01;

/**
 * Push a placed item's center out of any wall slab it penetrates at its
 * *current* rotation (`separateFromWalls` over the floor's `wallObstacles`).
 * Wall-mounted items are anchored to their wall by design and pass through
 * untouched, as do stacked riders (their host's own containment carries them);
 * an item already clear of every wall returns unchanged (same reference), so
 * nothing re-renders or re-saves needlessly.
 */
export function containFurniture(
  wallObstacles: Obstacle[],
  item: FurnitureItem,
): FurnitureItem {
  if (item.mount || item.stack) return item;
  const size = rotatedFootprintSize(item.footprint, item.rotation);
  const center = separateFromWalls(wallObstacles, size, item.position);
  if (center.x === item.position.x && center.y === item.position.y) return item;
  return { ...item, position: center };
}

/** Re-contain one item of the floor (by id) against the wall slabs after a
 * mutation moved or spun it, carrying any riders on it. */
export function containRoomFurniture(
  wallObstacles: Obstacle[],
  room: Room,
  id: string,
): Room {
  const next = {
    ...room,
    furniture: room.furniture.map((item) =>
      item.id === id ? containFurniture(wallObstacles, item) : item,
    ),
  };
  // Containment that pushed a host off a wall carries its riders with it.
  return syncStackedRiders(next, id);
}

/**
 * Shift a floor item by a keyboard nudge (plan-coord delta), then resolve it
 * against the wall slabs — a nudge toward a wall pushes up to the slab and
 * stops, whether the item sits in a room or out on the open canvas, and a
 * nudge aimed at a doorway gap passes (doors carry no slab at floor level).
 * Wall-mounted items pass through unchanged (their position is derived from
 * the wall); a stacked rider re-anchors onto its host through the position
 * update. Unknown ids return the room unchanged.
 */
export function nudgeFurniture(
  wallObstacles: Obstacle[],
  room: Room,
  id: string,
  dx: number,
  dy: number,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item || item.mount) return room;
  return containRoomFurniture(
    wallObstacles,
    updateFurniture(room, id, {
      position: { x: item.position.x + dx, y: item.position.y + dy },
    }),
    id,
  );
}

/** Whether an item's footprint takes part in overlap warnings. Stacked
 * riders stand above the floor plane (like mounts), so a lamp never warns
 * against the desk it stands on. */
function participatesInCollision(item: FurnitureItem): boolean {
  return (
    !item.mount &&
    !item.stack &&
    item.footprint.height > FLOOR_COVERING_MAX_HEIGHT
  );
}

/** Min/max of a polygon's vertices projected onto a (unit) axis. */
function projectPolygon(
  polygon: Point[],
  axis: Point,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of polygon) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Do two convex polygons overlap by more than a hair? Separating Axis Theorem
 * over both polygons' edge normals — separated on any axis means no overlap.
 * The `OVERLAP_PENETRATION` margin means edge-to-edge (flush) contact reads as
 * separated, so snapped-flush neighbors don't warn.
 */
function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      const nx = -(p2.y - p1.y);
      const ny = p2.x - p1.x;
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) continue;
      const axis = { x: nx / len, y: ny / len };
      const projA = projectPolygon(a, axis);
      const projB = projectPolygon(b, axis);
      if (
        projA.max - projB.min <= OVERLAP_PENETRATION ||
        projB.max - projA.min <= OVERLAP_PENETRATION
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Ids of every floor item whose rotated footprint overlaps another's — the
 * set the renderers tint as a collision warning. O(n²) over the room's
 * furniture, which numbers in the handful.
 */
export function overlappingFurnitureIds(
  furniture: FurnitureItem[],
): Set<string> {
  const items = furniture.filter(participatesInCollision);
  const corners = items.map(footprintCorners);
  const ids = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (polygonsOverlap(corners[i], corners[j])) {
        ids.add(items[i].id);
        ids.add(items[j].id);
      }
    }
  }
  return ids;
}
