import { reconcileFloor } from "./derived";
import { WALL_THICKNESS } from "./geometry";
import type { Floor } from "./types";

/**
 * Pure wall-edge mutations. Thickness is a sparse per-edge override
 * (`WallEdge.thickness`): absent means the default `WALL_THICKNESS`. It
 * applies to every wall — an exterior (1-face) wall grows outward with its
 * interior face pinned, a shared (2-face) or dangling wall grows
 * symmetrically about its centerline (`edgeSideHalves` in model/faces.ts;
 * `buildEdgeSolids` in lib/room-scene.ts mirrors the rule).
 */

export const MIN_WALL_THICKNESS = 0.05;
export const MAX_WALL_THICKNESS = 0.6;

const EPS = 1e-9;

/**
 * Set an edge's thickness override, clamped to
 * [MIN_WALL_THICKNESS, MAX_WALL_THICKNESS]. The default value is stored as an
 * absent field. Unknown ids / non-finite values / no-ops return the same
 * floor reference.
 */
export function setEdgeThickness(
  floor: Floor,
  edgeId: string,
  thickness: number,
): Floor {
  const edge = floor.edges.find((e) => e.id === edgeId);
  if (!edge || !Number.isFinite(thickness)) return floor;
  const clamped = Math.min(
    Math.max(thickness, MIN_WALL_THICKNESS),
    MAX_WALL_THICKNESS,
  );
  const isDefault = Math.abs(clamped - WALL_THICKNESS) < EPS;
  if (isDefault && edge.thickness === undefined) return floor;
  if (!isDefault && edge.thickness !== undefined) {
    if (Math.abs(clamped - edge.thickness) < EPS) return floor;
  }
  return reconcileFloor({
    ...floor,
    edges: floor.edges.map((e) => {
      if (e.id !== edgeId) return e;
      if (isDefault) {
        const { thickness: _dropped, ...rest } = e;
        return rest;
      }
      return { ...e, thickness: clamped };
    }),
  });
}
