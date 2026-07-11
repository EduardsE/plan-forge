import {
  type FurnitureItem,
  footprintCorners,
  type Point,
  type Room,
  syncStackedRiders,
  updateFurniture,
} from "#/lib/model";
import {
  PLACEMENT_GRID,
  rotatedFootprintSize,
  snapPlacement,
} from "#/lib/place";

/**
 * Collision awareness for the selection toolbar's mutations. Two concerns,
 * one soft and one hard:
 *
 * - **Containment (hard):** rotate and duplicate change an item's hull or
 *   position without the move drag that would otherwise clamp it inside the
 *   room, so a rotated desk near a wall pokes through. `containFurniture`
 *   slides the item back in — the containment half of `snapPlacement` with
 *   quantize and flush snapping off.
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
 * Slide a placed item's center back inside the outline for its *current*
 * rotation, contained but not snapped. Reuses `snapPlacement` with snap off
 * (no quantize, no flush pull) so only the bounds clamp and non-axis-wall
 * containment survive. Wall-mounted items are anchored to their wall by design
 * and pass through untouched; an already-contained item returns unchanged
 * (same reference), so nothing re-renders or re-saves needlessly.
 */
export function containFurniture(
  outline: Point[],
  item: FurnitureItem,
): FurnitureItem {
  // Wall mounts anchor to their wall, riders to their host — the host's own
  // containment keeps a rider inside the room.
  if (item.mount || item.stack) return item;
  const size = rotatedFootprintSize(item.footprint, item.rotation);
  const { center } = snapPlacement(
    outline,
    size,
    item.position,
    [],
    0,
    PLACEMENT_GRID,
    false,
  );
  if (center.x === item.position.x && center.y === item.position.y) return item;
  return { ...item, position: center };
}

/** Re-contain one item of the room (by id) after a mutation moved or spun it. */
export function containRoomFurniture(room: Room, id: string): Room {
  const next = {
    ...room,
    furniture: room.furniture.map((item) =>
      item.id === id ? containFurniture(room.outline, item) : item,
    ),
  };
  // Containment that slid a host back inside carries its riders with it.
  return syncStackedRiders(next, id);
}

/**
 * Shift a floor item by a keyboard nudge (plan-coord delta), then contain it
 * back inside the outline. Wall-mounted items pass through unchanged — their
 * position is derived from the wall, matching the inspector hiding POS for
 * them; a stacked rider re-anchors onto its host through the position update
 * (clamped to the host's top, like the POS X/Y fields). Unknown ids return
 * the room unchanged.
 */
export function nudgeFurniture(
  room: Room,
  id: string,
  dx: number,
  dy: number,
): Room {
  const item = room.furniture.find((entry) => entry.id === id);
  if (!item || item.mount) return room;
  return containRoomFurniture(
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
