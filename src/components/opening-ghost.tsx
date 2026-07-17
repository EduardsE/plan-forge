import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { SnapGuides } from "#/components/snap-guides";
import {
  type CatalogItem,
  type DerivedRoom,
  defaultVerticals,
  type Floor,
  type OpeningKind,
  type Point,
} from "#/lib/model";
import { type OpeningPlacement, openingAt } from "#/lib/opening-place";
import { wallPoint } from "#/lib/plan-scene";
import { buildEdgeSolids, WALL_THICKNESS } from "#/lib/room-scene";
import type { Unit } from "#/lib/units";

/**
 * The placement ghost for door/window catalog cards — the opening
 * counterpart to `WallMountGhost`, and like it lens-agnostic: the pointer
 * raycasts through whichever camera is live, so the same drag lands on a
 * wall in the 2D plan or the 3D dollhouse. The preview is a translucent
 * blue band through the nearest fitting wall (full door height, or sill to
 * head for a window — a top-down ortho camera reads it as the plan band),
 * slid clear of existing openings and portals, with the usual corner-
 * distance pills. Pointerup on the canvas inserts; anywhere else the drag
 * layer cancels.
 */

const GHOST_COLOR = "#3a5bf0";

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

export interface OpeningGhostProps {
  /** The graph floor — the insert targets the nearest fitting edge. */
  floor: Floor;
  /** Derived rooms, for the edges' face adjacency (wall heights, sides). */
  rooms: DerivedRoom[];
  /** The dragged catalog card; its id is the opening kind. */
  item: CatalogItem;
  unit: Unit;
  /** Snap toggle: off means free slide along the wall (no quantize/guides). */
  snapEnabled: boolean;
  onPlace: (kind: OpeningKind, placement: OpeningPlacement) => void;
  onCancel: () => void;
}

export function OpeningGhost({
  floor,
  rooms,
  item,
  unit,
  snapEnabled,
  onPlace,
  onCancel,
}: OpeningGhostProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [placement, setPlacement] = useState<OpeningPlacement | null>(null);
  const kind = item.id as OpeningKind;
  const width = item.footprint.width;

  // The same wall solids the scenes render: one per edge, holes for every
  // opening on it, so the slide clamps clear of both rooms' openings.
  const solids = useMemo(() => buildEdgeSolids(floor, rooms), [floor, rooms]);

  useEffect(() => {
    const raycaster = new Raycaster();
    const hit = new Vector3();
    /** Floor point under the pointer, or null off-canvas / past the horizon. */
    const toFloor = (event: PointerEvent): Point | null => {
      if (event.target !== gl.domElement) return null;
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(FLOOR_PLANE, hit)
        ? { x: hit.x, y: hit.z }
        : null;
    };
    const resolve = (point: Point): OpeningPlacement | null =>
      openingAt(solids, point, width, defaultVerticals(kind), snapEnabled);
    const handleMove = (event: PointerEvent) => {
      const point = toFloor(event);
      setPlacement(point ? resolve(point) : null);
    };
    const handleUp = (event: PointerEvent) => {
      // Off-canvas releases belong to the drag layer.
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const point = toFloor(event);
      const placed = point ? resolve(point) : null;
      if (placed) onPlace(kind, placed);
      else onCancel();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [solids, width, kind, snapEnabled, camera, gl, onPlace, onCancel]);

  if (!placement) return null;
  const { solid, offset } = placement;
  // The wall straddles the edge line (± half thickness), so the band centers
  // on the line.
  const mid = offset + width / 2;
  const center = wallPoint(solid, mid, 0);
  const { bottom, top } = defaultVerticals(kind);

  return (
    <group>
      <group
        position={[center.x, (bottom + top) / 2, center.y]}
        rotation-y={-Math.atan2(solid.dir.y, solid.dir.x)}
      >
        <mesh>
          <boxGeometry args={[width, top - bottom, WALL_THICKNESS + 0.02]} />
          <meshBasicMaterial
            color={GHOST_COLOR}
            transparent
            opacity={0.4}
            depthWrite={false}
          />
        </mesh>
      </group>
      <SnapGuides guides={placement.guides} unit={unit} />
    </group>
  );
}
