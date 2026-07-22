import { useMemo } from "react";
import { MathUtils } from "three";
import { FURNITURE_COLORS } from "#/lib/furniture-parts";
import type { Stair } from "#/lib/model";
import { stairRun, TREAD_DEPTH } from "#/lib/stairs";

/**
 * The tread boxes of one straight-run stair: `risers` boxes, each
 * `stair.width` × `storeyHeight / risers` tall × `TREAD_DEPTH` deep, stepping
 * up along the footprint's local +z (climb) axis. Built in local
 * (pre-rotation) space with a `rotation-y` group wrapper — the same
 * local-space + `rotation-y` convention `FurnitureMesh` uses, which
 * reproduces `stairClimbDir`/`footprintCorners`'s rotation math exactly (a
 * unit local +z rotates to plan `{ x: sin r, y: cos r }`, a unit local +x to
 * `{ x: cos r, y: -sin r }` — no separate climb-vector arithmetic needed
 * here). Mounted once per stack entry that has stairs — `RoomScene` renders
 * it for the active floor and every capped storey below it, at the entry's
 * own elevation.
 */

/** Walnut tone, matching the spider-table's slab (`FURNITURE_COLORS`). */
const STAIR_WOOD_COLOR = FURNITURE_COLORS["spider-table"] ?? "#8c6b48";

/** Not yet pickable (selection lands in V8) — opts out of the furniture-only
 * raycast so a tread doesn't swallow clicks meant for the floor/furniture
 * around it (see room-scene.tsx's "only furniture raycasts" convention). */
const noRaycast = () => null;

export interface StairMeshProps {
  stair: Stair;
  /** The climbing floor's own storey height — `stairRun` derives the riser
   * count and total run from it, same as the ghost and the void cut. */
  storeyHeight: number;
}

export function StairMesh({ stair, storeyHeight }: StairMeshProps) {
  const { risers, run } = useMemo(() => stairRun(storeyHeight), [storeyHeight]);
  const riserHeight = storeyHeight / risers;
  const yaw = MathUtils.degToRad(stair.rotation);

  return (
    <group position={[stair.position.x, 0, stair.position.y]} rotation-y={yaw}>
      {Array.from({ length: risers }, (_, i) => {
        const centerY = riserHeight * (i + 0.5);
        const centerZ = -run / 2 + TREAD_DEPTH * (i + 0.5);
        return (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: risers are a static ordered list per storey height.
            key={i}
            position={[0, centerY, centerZ]}
            castShadow
            receiveShadow
            raycast={noRaycast}
          >
            <boxGeometry args={[stair.width, riserHeight, TREAD_DEPTH]} />
            <meshLambertMaterial color={STAIR_WOOD_COLOR} />
          </mesh>
        );
      })}
    </group>
  );
}
