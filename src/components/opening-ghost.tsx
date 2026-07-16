import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { SnapGuides } from "#/components/snap-guides";
import type { CatalogItem, OpeningKind, Point, Room } from "#/lib/model";
import { type OpeningPlacement, openingAcrossRooms } from "#/lib/opening-place";
import { wallPoint } from "#/lib/plan-scene";
import {
  buildWallSolids,
  DOOR_HEIGHT,
  WALL_THICKNESS,
  WINDOW_HEAD,
  WINDOW_SILL,
} from "#/lib/room-scene";
import { floorSeamData } from "#/lib/seams";
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
  /** Every room of the floor; the insert targets the nearest fitting wall. */
  rooms: Room[];
  /** The dragged catalog card; its id is the opening kind. */
  item: CatalogItem;
  unit: Unit;
  /** Snap toggle: off means free slide along the wall (no quantize/guides). */
  snapEnabled: boolean;
  onPlace: (kind: OpeningKind, placement: OpeningPlacement) => void;
  onCancel: () => void;
}

export function OpeningGhost({
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

  // The same wall solids the scenes render: their holes carry this room's
  // openings *and* the neighbor's portal cuts on shared walls, so the slide
  // clamps clear of both.
  const roomSolids = useMemo(() => {
    const seamData = floorSeamData(rooms);
    return rooms
      .filter((room) => room.outline.length >= 3)
      .map((room) => ({
        roomId: room.id,
        solids: buildWallSolids(room, undefined, seamData.get(room.id)),
      }));
  }, [rooms]);

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
      openingAcrossRooms(roomSolids, point, width, snapEnabled);
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
  }, [roomSolids, width, kind, snapEnabled, camera, gl, onPlace, onCancel]);

  if (!placement) return null;
  const { solid, offset } = placement;
  // On a shared wall the rendered wall straddles the line (a half-thickness
  // fill each side), so the band centers on it too.
  const mid = offset + width / 2;
  const onSeam = (solid.seams ?? []).some(
    (span) => span.start <= mid && mid <= span.end,
  );
  const base = onSeam ? -WALL_THICKNESS / 2 : 0;
  const center = wallPoint(solid, mid, base + WALL_THICKNESS / 2);
  const bottom = kind === "window" ? WINDOW_SILL : 0;
  const top = kind === "window" ? WINDOW_HEAD : DOOR_HEIGHT;

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
