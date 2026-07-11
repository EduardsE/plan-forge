import {
  clampStackOffset,
  deriveStackPosition,
  type FurnitureItem,
  type Point,
  riderFitsHost,
  type Stack,
  stackOffsetOf,
} from "#/lib/model";
import { PLACEMENT_GRID } from "#/lib/place";

/**
 * Pure placement math for stacked items (parallel to `mount-place.ts` for
 * wall mounts): where a cursor hovering over a host lands a rider on that
 * host's top. The ghost rendering and the drag sessions live in
 * `placement-ghost.tsx` / `move-drag.tsx`; which items host or ride at all is
 * the model's call (`model/stack.ts`) — callers pass pre-filtered hosts.
 */

export interface StackSnapResult {
  /** The host the rider snapped onto (for top-surface height + highlight). */
  host: FurnitureItem;
  stack: Stack;
  /** Derived plan center on the host top. */
  position: Point;
}

/**
 * Where a rider dragged to `cursor` stacks: the host under the cursor (the
 * smallest containing footprint when several overlap), with the rider's
 * center — `center`, which a move drag offsets by its grab point — quantized
 * to the placement grid (`snap`) and clamped inside the host's top. Hosts the
 * rider doesn't fit on are skipped; null means "no host here, floor-place".
 */
export function stackAt(
  hosts: FurnitureItem[],
  cursor: Point,
  riderFootprint: { width: number; depth: number },
  riderRotation = 0,
  snap = true,
  center: Point = cursor,
): StackSnapResult | null {
  const candidates = hosts
    .filter((host) => {
      const local = stackOffsetOf(host, cursor);
      return (
        Math.abs(local.x) <= host.footprint.width / 2 &&
        Math.abs(local.y) <= host.footprint.depth / 2
      );
    })
    .sort(
      (a, b) =>
        a.footprint.width * a.footprint.depth -
        b.footprint.width * b.footprint.depth,
    );
  for (const host of candidates) {
    if (!riderFitsHost(host, riderFootprint, riderRotation)) continue;
    const raw = stackOffsetOf(host, center);
    const quantized = snap
      ? {
          x: Math.round(raw.x / PLACEMENT_GRID) * PLACEMENT_GRID,
          y: Math.round(raw.y / PLACEMENT_GRID) * PLACEMENT_GRID,
        }
      : raw;
    const offset = clampStackOffset(
      host,
      quantized,
      riderFootprint,
      riderRotation,
    );
    const stack: Stack = { hostId: host.id, dx: offset.x, dy: offset.y };
    return { host, stack, position: deriveStackPosition(host, stack) };
  }
  return null;
}
