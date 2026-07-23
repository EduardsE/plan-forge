import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import {
  DoubleSide,
  MathUtils,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { SnapGuides } from "#/components/snap-guides";
import {
  type CatalogItem,
  type DerivedRoom,
  defaultMountElevation,
  type Floor,
} from "#/lib/model";
import { mountAt, mountAtRay, type WallMountResult } from "#/lib/mount-place";
import { buildEdgeSolids } from "#/lib/room-scene";
import type { Unit } from "#/lib/units";

/**
 * The placement ghost for wall-mounted items (picture frames, clocks) — the
 * wall-item counterpart to `PlacementGhost`. It raycasts window pointermoves
 * against the walls first (`mountAtRay`, so 3D aiming lands on the face under
 * the cursor) and falls back to the floor plane + nearest edge (`mountAt`) —
 * the drag started on a DOM card, outside R3F's events. The item previews as
 * a bright standing rectangle hung on the target wall at its mount elevation,
 * with the same distance-to-corner guide pills the opening tools use.
 * Pointerup on the canvas commits the mount; anywhere else the drag layer
 * cancels.
 */

const GHOST_COLOR = "#3a5bf0";

export interface WallMountGhostProps {
  /** The graph floor; the mount targets the nearest fitting edge. */
  floor: Floor;
  /** Derived rooms, for the walls' face adjacency (heights, cutaway sides). */
  rooms: DerivedRoom[];
  item: CatalogItem;
  unit: Unit;
  /** Snap toggle: off means free slide along the wall (no quantize/guides). */
  snapEnabled: boolean;
  /** World-space elevation of the active floor — new placements always
   * target it, so the raycast plane lifts to it (0 on the ground storey). */
  planeY?: number;
  /** The landing room falls out of where the mounted position lands. */
  onPlace: (result: WallMountResult) => void;
  onCancel: () => void;
}

export function WallMountGhost({
  floor,
  rooms,
  item,
  unit,
  snapEnabled,
  planeY = 0,
  onPlace,
  onCancel,
}: WallMountGhostProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [result, setResult] = useState<WallMountResult | null>(null);
  const elevation = defaultMountElevation(item.id);

  useEffect(() => {
    const solids = buildEdgeSolids(floor, rooms);
    const raycaster = new Raycaster();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), -planeY);
    /** The mount under the pointer: the wall face the ray strikes, else the
     * nearest edge to the floor point under it. Null off-canvas / past the
     * horizon. */
    const resolve = (event: PointerEvent): WallMountResult | null => {
      if (event.target !== gl.domElement) return null;
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      const aimed = mountAtRay(
        floor,
        solids,
        {
          origin: { x: origin.x, y: origin.y - planeY, z: origin.z },
          dir: { x: direction.x, y: direction.y, z: direction.z },
        },
        {
          x: camera.position.x,
          y: camera.position.y - planeY,
          z: camera.position.z,
        },
        item.footprint,
        elevation,
        snapEnabled,
      );
      if (aimed) return aimed;
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return mountAt(
        floor,
        { x: hit.x, y: hit.z },
        item.footprint,
        elevation,
        snapEnabled,
      );
    };
    const handleMove = (event: PointerEvent) => {
      setResult(resolve(event));
    };
    const handleUp = (event: PointerEvent) => {
      // Off-canvas releases belong to the drag layer.
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const placed = resolve(event);
      if (placed) onPlace(placed);
      else onCancel();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [
    floor,
    rooms,
    item,
    elevation,
    snapEnabled,
    planeY,
    camera,
    gl,
    onPlace,
    onCancel,
  ]);

  if (!result) return null;
  const { width, height } = item.footprint;
  const hw = width / 2;
  // Face rectangle in the group's local frame: width along local x, height
  // vertical, centered at the mount elevation.
  const top = result.mount.elevation + height / 2;
  const bottom = result.mount.elevation - height / 2;
  const outlineLoop: [number, number, number][] = [
    [-hw, bottom, 0],
    [hw, bottom, 0],
    [hw, top, 0],
    [-hw, top, 0],
    [-hw, bottom, 0],
  ];

  return (
    <group position-y={planeY}>
      <group
        position={[result.position.x, 0, result.position.y]}
        rotation-y={MathUtils.degToRad(result.rotation)}
      >
        <mesh position-y={result.mount.elevation}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            color={GHOST_COLOR}
            transparent
            opacity={0.16}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <Line
          points={outlineLoop}
          color={GHOST_COLOR}
          lineWidth={2.5}
          alphaToCoverage={false}
        />
      </group>
      <SnapGuides guides={result.guides} unit={unit} />
    </group>
  );
}
