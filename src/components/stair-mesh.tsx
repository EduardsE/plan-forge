import { useCursor } from "@react-three/drei";
import { useMemo, useState } from "react";
import { BackSide, MathUtils } from "three";
import { CLICK_SLOP_PX } from "#/components/move-drag";
import { FURNITURE_COLORS, partHullScale } from "#/lib/furniture-parts";
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
 *
 * Pickable (V8): one invisible box spanning the whole footprint + storey
 * height is the click/hover target — the individual riser meshes stay
 * non-raycasting (same "only the pick target raycasts" convention as
 * `FurnitureMesh`), so a hover never flickers riser-to-riser. Selected/
 * hovered draws the same hand-rolled inverted-hull rim `FurnitureMesh` uses,
 * one per riser (`partHullScale`'s box formula, `HULL_RIM` = 2 cm).
 */

/** Walnut tone, matching the spider-table's slab (`FURNITURE_COLORS`). */
const STAIR_WOOD_COLOR = FURNITURE_COLORS["spider-table"] ?? "#8c6b48";
const SELECTION_COLOR = "#3a5bf0";

/** Opts out of the furniture-only raycast — only the invisible pick volume
 * below is a click/hover target (see room-scene.tsx's "only furniture
 * raycasts" convention). */
const noRaycast = () => null;

export interface StairMeshProps {
  stair: Stair;
  /** The climbing floor's own storey height — `stairRun` derives the riser
   * count and total run from it, same as the ghost and the void cut. */
  storeyHeight: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export function StairMesh({
  stair,
  storeyHeight,
  selected = false,
  onSelect,
}: StairMeshProps) {
  const { risers, run } = useMemo(() => stairRun(storeyHeight), [storeyHeight]);
  const riserHeight = storeyHeight / risers;
  const yaw = MathUtils.degToRad(stair.rotation);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const active = selected || hovered;

  return (
    <group position={[stair.position.x, 0, stair.position.y]} rotation-y={yaw}>
      {onSelect && (
        // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
        <mesh
          position={[0, storeyHeight / 2, 0]}
          onClick={(event) => {
            // A drag that ends on the stair is camera movement, not a pick.
            if (event.delta > CLICK_SLOP_PX) return;
            event.stopPropagation();
            onSelect(stair.id);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <boxGeometry args={[stair.width, storeyHeight, run]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {Array.from({ length: risers }, (_, i) => {
        const centerY = riserHeight * (i + 0.5);
        const centerZ = -run / 2 + TREAD_DEPTH * (i + 0.5);
        const riserSize: [number, number, number] = [
          stair.width,
          riserHeight,
          TREAD_DEPTH,
        ];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: risers are a static ordered list per storey height.
          <group key={i}>
            <mesh
              position={[0, centerY, centerZ]}
              castShadow
              receiveShadow
              raycast={noRaycast}
            >
              <boxGeometry args={riserSize} />
              <meshLambertMaterial color={STAIR_WOOD_COLOR} />
            </mesh>
            {active && (
              <mesh
                position={[0, centerY, centerZ]}
                scale={partHullScale({ kind: "box", size: riserSize })}
                raycast={noRaycast}
              >
                <boxGeometry args={riserSize} />
                <meshBasicMaterial
                  color={SELECTION_COLOR}
                  side={BackSide}
                  transparent
                  opacity={selected ? 0.85 : 0.4}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
