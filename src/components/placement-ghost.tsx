import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Plane, Raycaster, Shape, Vector2, Vector3 } from "three";
import { HostHighlight } from "#/components/host-highlight";
import { SnapGuides } from "#/components/snap-guides";
import type {
  CatalogItem,
  Floor,
  FurnitureItem,
  Point,
  Stack,
} from "#/lib/model";
import { canHostStack, isStackRider, stackSurfaceHeight } from "#/lib/model";
import {
  edgeWallObstacles,
  furnitureObstacle,
  type PlacementGuide,
  separateFromWalls,
  snapPlacement,
} from "#/lib/place";
import { dashedPolyline, roundedRectPoints } from "#/lib/plan-scene";
import { stackAt } from "#/lib/stack-place";
import type { Unit } from "#/lib/units";

/**
 * The in-scene half of a placement drag (mockup screen 1d): a dashed cyan
 * ghost footprint on the floor with a matching outline hovering at the
 * item's height, plus per-axis wall-distance guides with teal readout pills
 * (`SnapGuides`).
 *
 * The drag never goes through R3F's event system — the pointer went down on
 * a DOM card, so this component raycasts window pointermoves onto the floor
 * plane itself and resolves the session on pointerup: released on the
 * canvas → `onPlace` with the snapped center, anywhere else the drag layer
 * cancels (releases the ghost can't see are its job).
 */

const GHOST_COLOR = "#3a5bf0";
/** Ghost corner rounding — the mockup's 12px at plan scale. */
const CORNER_RADIUS = 0.11;

/** Stacked above the 3D floor top (0.001) and the rug (top ≈ 0.017). */
const FILL_Y = 0.024;
const OUTLINE_Y = 0.028;

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

const noRaycast = () => null;

function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

/** Centered rounded-rect as a three Shape (plan y mirrored to world z). */
function ghostShape(points: Point[]): Shape {
  const shape = new Shape();
  for (const [i, p] of points.entries()) {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  }
  shape.closePath();
  return shape;
}

/** Where the ghost currently sits: on the floor, or anchored on a host. */
interface GhostSnap {
  center: Point;
  guides: PlacementGuide[];
  /** Present while hovering a host: the anchor a release would place with. */
  stack?: Stack;
  host?: FurnitureItem;
}

export interface PlacementGhostProps {
  /** Every derived furniture item of the floor — the ghost snaps flush
   * against them and lands riders on their hosts. */
  furniture: FurnitureItem[];
  /** The graph floor — its wall slabs bound the ghost, nothing else does. */
  floor: Floor;
  item: CatalogItem;
  unit: Unit;
  /** Snap toggle: off means free placement (wall-contained, no flush). */
  snapEnabled: boolean;
  /** The drop landed — furniture is floor-level, so there is no target room
   * to report; deriveFloor assigns membership (or the unassigned bucket). */
  onPlace: (center: Point, stack?: Stack) => void;
  onCancel: () => void;
}

export function PlacementGhost({
  furniture,
  floor,
  item,
  unit,
  snapEnabled,
  onPlace,
  onCancel,
}: PlacementGhostProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [snap, setSnap] = useState<GhostSnap | null>(null);

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
    const rider = isStackRider(item.id);
    // Wall slabs come from the graph, which never changes during a placement
    // drag — compute the hard boundary once for the whole gesture.
    const wallObstacles = edgeWallObstacles(floor);
    /** The ghost placement under the cursor: a hovered host's top for a
     * rider-category item (a fresh drop is unrotated), else the floor —
     * same policy as a move drag: flush-snap against neighbours and wall
     * slabs, pushed out of any slab it penetrates. Anywhere the walls allow
     * is a legal drop, a room or the open canvas alike. */
    const resolve = (point: Point): GhostSnap => {
      if (rider) {
        const hosts = furniture.filter(canHostStack);
        const stacked = stackAt(hosts, point, item.footprint, 0, snapEnabled);
        if (stacked) {
          return {
            center: stacked.position,
            guides: [],
            stack: stacked.stack,
            host: stacked.host,
          };
        }
      }
      // Placed items the ghost snaps flush against (a fresh drop isn't on
      // the floor yet, so every non-stacked item is a neighbor).
      const obstacles = [
        ...furniture.filter((entry) => !entry.stack).map(furnitureObstacle),
        ...wallObstacles,
      ];
      const placed = snapPlacement(
        [],
        item.footprint,
        point,
        obstacles,
        undefined,
        undefined,
        snapEnabled,
      );
      return {
        center: separateFromWalls(wallObstacles, item.footprint, placed.center),
        guides: placed.guides,
      };
    };
    const handleMove = (event: PointerEvent) => {
      const point = toFloor(event);
      setSnap(point ? resolve(point) : null);
    };
    const handleUp = (event: PointerEvent) => {
      // Off-canvas releases belong to the drag layer.
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const point = toFloor(event);
      const placed = point ? resolve(point) : null;
      if (placed) onPlace(placed.center, placed.stack);
      else onCancel();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [furniture, floor, item, snapEnabled, camera, gl, onPlace, onCancel]);

  const rect = useMemo(
    () =>
      roundedRectPoints(
        item.footprint.width,
        item.footprint.depth,
        CORNER_RADIUS,
      ),
    [item],
  );
  const rectLoop = useMemo(() => [...rect, rect[0]], [rect]);
  const floorDashes = useMemo(
    () => dashedPolyline(rectLoop, 0.14, 0.09),
    [rectLoop],
  );
  const shape = useMemo(() => ghostShape(rect), [rect]);

  if (!snap) return null;
  const { center } = snap;
  const height = item.footprint.height;
  // Anchored on a host, the whole ghost rides at its top surface.
  const base = snap.host ? stackSurfaceHeight(snap.host) : 0;

  return (
    <group>
      <group position={[center.x, base, center.y]}>
        {/* Footprint on the landing surface: translucent fill + bright
				    dashed outline. */}
        <mesh
          rotation-x={-Math.PI / 2}
          position-y={FILL_Y}
          renderOrder={2}
          raycast={noRaycast}
        >
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={GHOST_COLOR}
            transparent
            opacity={0.1}
            depthWrite={false}
          />
        </mesh>
        <Line
          segments
          points={floorDashes.map((p) => v3(p, OUTLINE_Y))}
          color={GHOST_COLOR}
          lineWidth={3}
          alphaToCoverage={false}
        />
        {/* The same outline floating at the item's height (mockup's
				    elevated dashed box hinting the volume). */}
        {height > 0.05 && (
          <Line
            segments
            points={floorDashes.map((p) => v3(p, height))}
            color={GHOST_COLOR}
            lineWidth={1.5}
            transparent
            opacity={0.5}
            alphaToCoverage={false}
          />
        )}
      </group>
      {snap.host && <HostHighlight host={snap.host} />}
      <SnapGuides guides={snap.guides} unit={unit} />
    </group>
  );
}
