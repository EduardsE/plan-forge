import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Plane, Raycaster, Shape, Vector2, Vector3 } from "three";
import { SnapGuides } from "#/components/snap-guides";
import type { Building, Point, Stair } from "#/lib/model";
import {
  allFurnitureOf,
  DEFAULT_STAIR_WIDTH,
  deriveFloor,
  floorById,
  storeyHeightOf,
} from "#/lib/model";
import {
  edgeWallObstacles,
  furnitureObstacle,
  PLACEMENT_GRID,
  type PlacementGuide,
  SNAP_TOLERANCE,
  separateFromWalls,
  snapPlacement,
} from "#/lib/place";
import { dashedPolyline, roundedRectPoints } from "#/lib/plan-scene";
import { stairRun, stairValid } from "#/lib/stairs";
import type { Unit } from "#/lib/units";

/**
 * The in-scene half of a stair placement drag — modeled directly on
 * `placement-ghost.tsx` (window pointer listeners, `event.target ===
 * gl.domElement` guard, plane raycast at `planeY`), with one twist: a stair
 * has a hard validity gate `PlacementGhost` doesn't (`stairValid`, checking
 * the footprint against both this floor's walls *and* the floor above's), so
 * the ghost renders blue when the drop would land, red when it wouldn't, and
 * a red drop is refused outright rather than landing somewhere adjusted.
 *
 * Rotation stays 0 while placing (rotate-after-drop is a V8 concern, like
 * furniture's toolbar rotate) — footprint size is always
 * `{ width: DEFAULT_STAIR_WIDTH, depth: run }`, `run` derived from the
 * active floor's own storey height (`stairRun`, lib/stairs.ts).
 */

const VALID_COLOR = "#3a5bf0";
const INVALID_COLOR = "#D64545";
/** Ghost corner rounding — smaller than furniture's (a stair reads as a
 * plank, not a soft card). */
const CORNER_RADIUS = 0.08;

/** Stacked above the 3D floor top (0.001) and the rug (top ≈ 0.017). */
const FILL_Y = 0.024;
const OUTLINE_Y = 0.028;

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

export interface StairGhostProps {
  /** The whole building — validity checks this floor's walls *and* the
   * floor above's (`stairValid`). */
  building: Building;
  activeFloorId: string;
  /** World-space elevation of the active floor. */
  planeY: number;
  unit: Unit;
  /** Snap toggle: off means free placement (wall-contained, no flush). */
  snapEnabled: boolean;
  /** The drop landed and validated — `onPlace` never fires for an invalid
   * candidate (an invalid drop is a refusal, handled by `onCancel`). */
  onPlace: (stair: Stair) => void;
  onCancel: () => void;
}

interface StairGhostSnap {
  candidate: Stair;
  guides: PlacementGuide[];
  valid: boolean;
}

export function StairGhost({
  building,
  activeFloorId,
  planeY,
  unit,
  snapEnabled,
  onPlace,
  onCancel,
}: StairGhostProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [snap, setSnap] = useState<StairGhostSnap | null>(null);

  const activeFloor = floorById(building, activeFloorId);
  const storeyHeight = activeFloor ? storeyHeightOf(activeFloor) : 0;
  const { run } = useMemo(() => stairRun(storeyHeight), [storeyHeight]);
  const size = useMemo(
    () => ({ width: DEFAULT_STAIR_WIDTH, depth: run }),
    [run],
  );

  useEffect(() => {
    if (!activeFloor) return;
    // Snap/contain against this floor's own walls and furniture only — the
    // pipeline furniture uses. Cross-floor validity (the floor above's
    // walls too) is `stairValid`'s job below, separate from where the ghost
    // is allowed to sit.
    const derived = deriveFloor(activeFloor);
    const furniture = allFurnitureOf(
      derived.rooms,
      derived.unassignedFurniture,
    );
    const wallObstacles = edgeWallObstacles(activeFloor);
    const obstacles = [
      ...wallObstacles,
      ...furniture.filter((item) => !item.stack).map(furnitureObstacle),
    ];

    const raycaster = new Raycaster();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), -planeY);
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
      return raycaster.ray.intersectPlane(plane, hit)
        ? { x: hit.x, y: hit.z }
        : null;
    };
    const resolve = (point: Point): StairGhostSnap => {
      const placed = snapPlacement(
        size,
        point,
        obstacles,
        SNAP_TOLERANCE,
        PLACEMENT_GRID,
        snapEnabled,
      );
      const center = separateFromWalls(wallObstacles, size, placed.center);
      const candidate: Stair = {
        id: "stair-ghost",
        position: center,
        rotation: 0,
        width: DEFAULT_STAIR_WIDTH,
      };
      const valid = stairValid(building, activeFloorId, candidate);
      return { candidate, guides: placed.guides, valid };
    };
    const handleMove = (event: PointerEvent) => {
      const point = toFloor(event);
      setSnap(point ? resolve(point) : null);
    };
    const handleUp = (event: PointerEvent) => {
      // Off-canvas releases belong to the drag layer.
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const point = toFloor(event);
      const resolved = point ? resolve(point) : null;
      if (resolved?.valid) {
        onPlace({ ...resolved.candidate, id: crypto.randomUUID() });
      } else {
        onCancel();
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [
    activeFloor,
    building,
    activeFloorId,
    size,
    planeY,
    snapEnabled,
    camera,
    gl,
    onPlace,
    onCancel,
  ]);

  const rect = useMemo(
    () => roundedRectPoints(size.width, size.depth, CORNER_RADIUS),
    [size],
  );
  const rectLoop = useMemo(() => [...rect, rect[0]], [rect]);
  const dashes = useMemo(
    () => dashedPolyline(rectLoop, 0.14, 0.09),
    [rectLoop],
  );
  const shape = useMemo(() => ghostShape(rect), [rect]);

  if (!snap || !activeFloor) return null;
  const { candidate, guides, valid } = snap;
  const color = valid ? VALID_COLOR : INVALID_COLOR;

  return (
    <group position-y={planeY}>
      <group position={[candidate.position.x, 0, candidate.position.y]}>
        {/* Footprint on the floor: translucent fill + dashed outline, blue
            when the drop would land, red (0.35 opacity) when it wouldn't. */}
        <mesh
          rotation-x={-Math.PI / 2}
          position-y={FILL_Y}
          renderOrder={2}
          raycast={noRaycast}
        >
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.1}
            depthWrite={false}
          />
        </mesh>
        <Line
          segments
          points={dashes.map((p) => v3(p, OUTLINE_Y))}
          color={color}
          lineWidth={3}
          transparent
          opacity={valid ? 1 : 0.35}
          alphaToCoverage={false}
        />
        {/* A translucent hint of the volume the stair will climb through,
            only while the drop is valid. */}
        {valid && storeyHeight > 0 && (
          <mesh position-y={storeyHeight / 2} raycast={noRaycast}>
            <boxGeometry args={[size.width, storeyHeight, size.depth]} />
            <meshBasicMaterial
              color={VALID_COLOR}
              transparent
              opacity={0.12}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
      <SnapGuides guides={guides} unit={unit} />
    </group>
  );
}
