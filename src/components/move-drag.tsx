import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { HostHighlight } from "#/components/host-highlight";
import { SnapGuides } from "#/components/snap-guides";
import type {
  Floor,
  FurnitureItem,
  FurnitureUpdate,
  Point,
  Stack,
  WallMount,
} from "#/lib/model";
import { canHostStack, DEFAULT_WALL_HEIGHT, isStackRider } from "#/lib/model";
import {
  type MountRay,
  mountAt,
  mountAtRay,
  type WallMountResult,
} from "#/lib/mount-place";
import {
  edgeWallObstacles,
  furnitureObstacle,
  type Obstacle,
  type PlacementGuide,
  rotatedFootprintSize,
  separateFromWalls,
  snapPlacement,
} from "#/lib/place";
import type { WallSolid } from "#/lib/room-scene";
import { stackAt } from "#/lib/stack-place";
import type { Unit } from "#/lib/units";

/**
 * Moving a placed item by pointer-drag, shared by both lenses: the 3D
 * dollhouse and the 2D plan arm a drag from a pointerdown on an
 * already-selected item, and the session reuses `snapPlacement`'s quantize and
 * flush-snap plus the wall-clearance guide pills.
 *
 * Furniture is floor-level: a drag snaps flush against neighbours and the
 * wall solids and is pushed out of any wall slab it penetrates
 * (`separateFromWalls`), so a piece can be carried anywhere the walls allow —
 * into another room across a doorway, into the dead band at a shared wall, or
 * out onto the open canvas — with no room clamp and no reparenting. Wall-mount
 * and rider drags re-anchor to the nearest edge/host across the whole floor.
 */

/**
 * A click whose pointer travelled further than this (px) was a camera drag
 * that happened to end on an item, not a pick.
 */
export const CLICK_SLOP_PX = 4;

/** The y=0 floor plane, the default plane a drag tracks the pointer across. */
export const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

/** A live move drag: which item, where it was grabbed, where it started. */
export interface MoveDrag {
  id: string;
  /** Id of the floor that owns the dragged item — the 3D stack's lower
   * entries drag their own storey; the 2D lens's single floor always owns
   * its own drags too (its `beginDrag` calls omit this, defaulting to ""). */
  floorId: string;
  /** Grab offset from the item's center, plan coords — dragging keeps it. */
  grab: Point;
  /**
   * World-space height of the grab point. The drag tracks the pointer across
   * the horizontal plane at this height, not y=0 — projecting an elevated
   * grab (a wardrobe top, a wall shelf) onto the floor would land behind the
   * item and make it jump on the first move.
   */
  grabHeight: number;
  /** Position at drag start, restored by esc. */
  original: Point;
  /** Rotation at drag start, restored by esc (matters for wall re-mounts). */
  originalRotation: number;
  /** Axis-aligned size of the (possibly rotated) footprint for snapping. */
  size: { width: number; depth: number };
  /** Screen point of the pointerdown, for the drag-vs-click slop guard. */
  originScreen: { x: number; y: number };
  /**
   * Present only for a wall-mounted item: the raw (unrotated) footprint, its
   * mount elevation, and the original mount to restore on esc. When set, the
   * drag re-mounts to the nearest wall instead of snapping on the floor.
   */
  mount?: {
    elevation: number;
    /** Grab height above the mount center — a free-vertical (3D) drag keeps
     * the hand on the grab point as the elevation follows the wall plane. */
    elevationGrab: number;
    /** The item's body height, for the floor/ceiling elevation clamp. */
    bodyHeight: number;
    footprint: { width: number; depth: number };
    original: WallMount;
  };
  /**
   * Present when the item can stand on other furniture (a rider-category
   * catalog item): its raw footprint for the host-top fit, and the anchor to
   * restore on esc (null for an item grabbed off the floor). While set, the
   * drag snaps onto hovered hosts and floor-places everywhere else.
   */
  rider?: {
    footprint: { width: number; depth: number };
    original: Stack | null;
  };
}

/**
 * Pausing the camera controls around any in-scene drag (furniture moves,
 * opening slides): `begin` disables them *synchronously* — the declarative
 * lock prop flushes only after OrbitControls has accepted the pointerdown
 * and eaten the first pointermoves as a gesture. Unmounting mid-drag (a lens
 * switch) releases the controls too.
 */
export function useControlsPause(onActiveChange: (active: boolean) => void) {
  // The default controls (OrbitControls, via makeDefault).
  const controls = useThree((state) => state.controls) as {
    enabled: boolean;
  } | null;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const activeRef = useRef(false);
  const begin = useCallback(() => {
    activeRef.current = true;
    if (controlsRef.current) controlsRef.current.enabled = false;
    onActiveChange(true);
  }, [onActiveChange]);
  const end = useCallback(() => {
    activeRef.current = false;
    if (controlsRef.current) controlsRef.current.enabled = true;
    onActiveChange(false);
  }, [onActiveChange]);
  useEffect(
    () => () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      onActiveChange(false);
    },
    [onActiveChange],
  );
  return { begin, end };
}

/**
 * Project window pointer events onto a horizontal plane (the floor by
 * default) through `camera`. Ignores the event target on purpose: mid-drag
 * the pointer may cross a DOM overlay (the selection chip) and tracking must
 * not stall there.
 */
export function floorProjector(
  gl: { domElement: HTMLCanvasElement },
  camera: Camera,
  plane: Plane = FLOOR_PLANE,
): (event: PointerEvent) => Point | null {
  const raycaster = new Raycaster();
  const hit = new Vector3();
  return (event) => {
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
}

/**
 * Project window pointer events onto a wall's vertical plane (the plane
 * through the wall line, world-up), in wall-local coordinates: `along` the
 * wall from its start and `up` from the floor. Null while the ray misses the
 * plane (grazing angles). Shared by the 3D opening drag and the free-vertical
 * wall-mount drag.
 */
export function wallProjector(
  gl: { domElement: HTMLCanvasElement },
  camera: Camera,
  wall: { start: Point; dir: Point },
): (event: PointerEvent) => { along: number; up: number } | null {
  const raycaster = new Raycaster();
  const hit = new Vector3();
  // Plan (x, y) maps to world (x, z); the normal is the horizontal
  // perpendicular of the wall direction.
  const plane = new Plane().setFromNormalAndCoplanarPoint(
    new Vector3(-wall.dir.y, 0, wall.dir.x),
    new Vector3(wall.start.x, 0, wall.start.y),
  );
  return (event) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return {
      along:
        (hit.x - wall.start.x) * wall.dir.x +
        (hit.z - wall.start.y) * wall.dir.y,
      up: hit.y,
    };
  };
}

/** How far past a wall's ends a free-vertical drag stays on its plane before
 * the horizontal-plane target re-homes it to the nearest wall, meters. */
const WALL_STAY_MARGIN = 0.5;

/**
 * Move-drag state for a scene: `beginDrag` from an item's pointerdown handler
 * arms a session and pauses the camera controls around it.
 */
export function useMoveDrag(onMoveActiveChange: (active: boolean) => void) {
  const [drag, setDrag] = useState<MoveDrag | null>(null);
  const { begin, end } = useControlsPause(onMoveActiveChange);
  const beginDrag = useCallback(
    (
      item: FurnitureItem,
      /** Where on the item the pointer grabbed it, plan coords. */
      grabPoint: Point,
      screen: { x: number; y: number },
      /** World-space height of the grab point (0 for the flat 2D lens). */
      grabHeight = 0,
      /** Owning floor id (3D stack only; the 2D lens omits this, so its
       * drags default to the single-floor "" the caller's own `floor` prop
       * already resolves without consulting it). */
      floorId = "",
    ) => {
      setDrag({
        id: item.id,
        floorId,
        grab: {
          x: grabPoint.x - item.position.x,
          y: grabPoint.y - item.position.y,
        },
        grabHeight,
        original: item.position,
        originalRotation: item.rotation,
        size: rotatedFootprintSize(item.footprint, item.rotation),
        originScreen: screen,
        mount: item.mount
          ? {
              elevation: item.mount.elevation,
              elevationGrab: grabHeight - item.mount.elevation,
              bodyHeight: item.footprint.height,
              footprint: {
                width: item.footprint.width,
                depth: item.footprint.depth,
              },
              original: item.mount,
            }
          : undefined,
        rider:
          !item.mount && isStackRider(item.catalogId)
            ? {
                footprint: {
                  width: item.footprint.width,
                  depth: item.footprint.depth,
                },
                original: item.stack ?? null,
              }
            : undefined,
      });
      begin();
    },
    [begin],
  );
  const endDrag = useCallback(() => {
    setDrag(null);
    end();
  }, [end]);
  return { drag, beginDrag, endDrag };
}

/**
 * The window-listener half of a move drag. Mounted per session (the pointer
 * is already down when it appears): raycasts pointermoves onto the floor
 * plane, feeds `snapPlacement` (quantize + flush against neighbours and wall
 * solids), pushes the result out of any wall slab it penetrates
 * (`separateFromWalls`) into `onMove`, and renders the wall-clearance guides.
 * Pointerup commits wherever the item is; esc restores `drag.original`.
 */
export function MoveDragSession({
  furniture,
  floor,
  drag,
  unit,
  snapEnabled,
  freeVerticalMounts = false,
  wallSolids,
  elevationY = 0,
  extraObstacles,
  onMove,
  onEnd,
}: {
  /** Every derived furniture item of the floor (rooms' + unassigned) — the
   * drag snaps against them as neighbours and lands riders on their hosts. */
  furniture: FurnitureItem[];
  /** The graph floor — wall slabs bound the drag; mount drags re-anchor. */
  floor: Floor;
  drag: MoveDrag;
  unit: Unit;
  /** Snap toggle: off means free move (still wall-contained, no flush). */
  snapEnabled: boolean;
  /** 3D lens: a wall-item drag tracks the pointer on its wall's vertical
   * plane, so the elevation follows the hand (the 2D plan has no vertical). */
  freeVerticalMounts?: boolean;
  /** The floor's wall solids (3D lens) — the ceiling clamp for free-vertical
   * drags, and the ray pick that re-homes a mount to the wall face the
   * pointer actually aims at. */
  wallSolids?: WallSolid[];
  /** World-space elevation of the dragged floor's storey — the wall ray pick
   * works in floor-local coordinates. */
  elevationY?: number;
  /** Containment obstacles beyond the floor's own wall slabs — stair voids
   * cut into this floor by the floor below, when there is one. Joins
   * `wallObstacles` for the floor-item snap/contain path only (mount and
   * rider drags don't touch it: a wall-mounted or stacked item isn't at
   * floor level). */
  extraObstacles?: Obstacle[];
  /** Live update — a floor item patches its position; a wall item also its
   * rotation and mount as it slides onto the nearest wall; a rider its stack
   * anchor. Furniture is floor-level, so there is no target room to report. */
  onMove: (update: FurnitureUpdate) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<PlacementGuide[]>([]);
  // The host the rider currently hovers, for the top-surface highlight.
  const [armedHost, setArmedHost] = useState<FurnitureItem | null>(null);
  // Latest furniture/callbacks without resubscribing the listeners mid-drag
  // (every move churns the floor as the item's position updates).
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const furnitureRef = useRef(furniture);
  furnitureRef.current = furniture;
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const wallSolidsRef = useRef(wallSolids);
  wallSolidsRef.current = wallSolids;
  const extraObstaclesRef = useRef(extraObstacles);
  extraObstaclesRef.current = extraObstacles;

  useEffect(() => {
    // Track the pointer across the plane of the grab point, so an elevated
    // grab (3D lens) keeps the item under the hand instead of adding the
    // floor-projection parallax.
    const toFloor = floorProjector(
      gl,
      camera,
      new Plane(new Vector3(0, 1, 0), -drag.grabHeight),
    );
    // Wall slabs come from the graph, which never changes during a furniture
    // drag — compute the hard boundary once for the whole gesture. Stair
    // voids (this floor's own, cut by the floor below) join them so a floor
    // item can't be dragged/snapped into the opening.
    const wallObstacles = [
      ...edgeWallObstacles(floorRef.current),
      ...(extraObstaclesRef.current ?? []),
    ];
    // The elevation a free-vertical mount drag currently rides at; a re-home
    // to another wall keeps it until the pointer settles on the new plane.
    let liveElevation = drag.mount?.elevation ?? 0;
    /** A wall's ceiling height, from the solids the 3D lens passes in. */
    const edgeCeiling = (edgeId: string) =>
      wallSolidsRef.current?.find((solid) => solid.edgeId === edgeId)?.height ??
      DEFAULT_WALL_HEIGHT;
    const rayCaster = new Raycaster();
    /** The pointer ray in floor-local space, for the aimed-wall re-home. */
    const pointerRay = (event: PointerEvent): MountRay | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      rayCaster.setFromCamera(ndc, camera);
      const { origin, direction } = rayCaster.ray;
      return {
        origin: { x: origin.x, y: origin.y - elevationY, z: origin.z },
        dir: { x: direction.x, y: direction.y, z: direction.z },
      };
    };
    /** The dragged item's current host edge (live through the previews). */
    const currentMountEdge = () =>
      furnitureRef.current.find((item) => item.id === drag.id)?.mount?.edgeId ??
      drag.mount?.original.edgeId;
    /** Geometry of a graph edge, for the wall-plane projection. */
    const edgeFrame = (edgeId: string) => {
      const current = floorRef.current;
      const edge = current.edges.find((e) => e.id === edgeId);
      const a = edge && current.nodes.find((n) => n.id === edge.a);
      const b = edge && current.nodes.find((n) => n.id === edge.b);
      if (!a || !b) return null;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-9) return null;
      return {
        start: { x: a.x, y: a.y },
        dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
        length,
      };
    };
    // Pointer-still-down presses shouldn't nudge the item onto the snap
    // grid: nothing moves until the pointer clears the click slop.
    let moved = false;
    const handleMove = (event: PointerEvent) => {
      if (!moved) {
        const travel = Math.hypot(
          event.clientX - drag.originScreen.x,
          event.clientY - drag.originScreen.y,
        );
        if (travel <= CLICK_SLOP_PX) return;
        moved = true;
      }
      const point = toFloor(event);
      if (!point) return;
      const furniture = furnitureRef.current;
      let target = {
        x: point.x - drag.grab.x,
        y: point.y - drag.grab.y,
      };
      if (drag.mount) {
        const mountDrag = drag.mount;
        const half = mountDrag.bodyHeight / 2;
        // A re-home resolved from the pointer ray (aimed wall face), taking
        // precedence over the horizontal-plane nearest-edge fallback.
        let aimed: WallMountResult | null = null;
        if (freeVerticalMounts) {
          const edgeId = currentMountEdge();
          const frame = edgeId ? edgeFrame(edgeId) : null;
          // The wall face the pointer ray strikes — the face the user sees
          // under the cursor. It decides re-homes to other walls AND which
          // face of the current wall the item hangs on: the horizontal-plane
          // fallback below lands *behind* an aimed wall and would flip the
          // mount to its back face.
          const ray = pointerRay(event);
          const rayResult =
            ray && wallSolidsRef.current
              ? mountAtRay(
                  floorRef.current,
                  wallSolidsRef.current,
                  ray,
                  {
                    x: camera.position.x,
                    y: camera.position.y - elevationY,
                    z: camera.position.z,
                  },
                  mountDrag.footprint,
                  liveElevation,
                  snapRef.current,
                )
              : null;
          if (rayResult && rayResult.mount.edgeId !== edgeId) {
            // Aimed at another wall: re-home onto the face under the cursor,
            // at the elevation the drag last rode at.
            aimed = rayResult;
          } else if (frame) {
            // Track the pointer on the current wall's vertical plane:
            // sliding along it moves the item (grab offset kept), moving
            // up/down it re-elevates. The hung face follows the aim while
            // the ray sees the wall; off every wall it stays put.
            const side =
              rayResult?.mount.side ??
              furniture.find((item) => item.id === drag.id)?.mount?.side ??
              mountDrag.original.side;
            const wallHit = wallProjector(gl, camera, frame)(event);
            if (wallHit) {
              const grabAlong =
                drag.grab.x * frame.dir.x + drag.grab.y * frame.dir.y;
              const along = wallHit.along - grabAlong;
              if (
                along > -WALL_STAY_MARGIN &&
                along < frame.length + WALL_STAY_MARGIN
              ) {
                // Center target on the wall line, nudged to `side` so
                // `mountAt` hangs it on that face.
                target = {
                  x:
                    frame.start.x +
                    frame.dir.x * along -
                    frame.dir.y * side * 0.05,
                  y:
                    frame.start.y +
                    frame.dir.y * along +
                    frame.dir.x * side * 0.05,
                };
                const ceiling = edgeCeiling(edgeId ?? "");
                liveElevation = Math.min(
                  Math.max(wallHit.up - mountDrag.elevationGrab, half),
                  Math.max(ceiling - half, half),
                );
              }
            }
          }
        }
        // Wall item: the aimed face, else the nearest edge that fits it.
        const result =
          aimed ??
          mountAt(
            floorRef.current,
            target,
            mountDrag.footprint,
            freeVerticalMounts ? liveElevation : mountDrag.elevation,
            snapRef.current,
          );
        if (!result) return;
        // A re-home onto a lower wall pulls the elevation under its ceiling.
        const ceiling = edgeCeiling(result.mount.edgeId);
        const clamped = freeVerticalMounts
          ? Math.min(
              Math.max(result.mount.elevation, half),
              Math.max(ceiling - half, half),
            )
          : result.mount.elevation;
        const mount =
          clamped === result.mount.elevation
            ? result.mount
            : { ...result.mount, elevation: clamped };
        moveRef.current({
          position: result.position,
          rotation: result.rotation,
          mount,
        });
        setGuides(result.guides);
        return;
      }
      if (drag.rider) {
        // Rider over a host — any host on the floor — anchors onto its top
        // (hit-test the cursor, so grabbing a lamp by its edge still stacks
        // where the hand points).
        const hosts = furniture.filter(
          (item) => item.id !== drag.id && canHostStack(item),
        );
        const stacked = stackAt(
          hosts,
          point,
          drag.rider.footprint,
          drag.originalRotation,
          snapRef.current,
          target,
        );
        if (stacked) {
          moveRef.current({ position: stacked.position, stack: stacked.stack });
          setGuides([]);
          setArmedHost(stacked.host);
          return;
        }
        setArmedHost(null);
      }
      // Floor item: snap flush against neighbours and the wall solids, then
      // push out of any wall slab so a piece can't tunnel through a wall — but
      // it can go anywhere the walls allow (another room, the open canvas).
      const obstacles = [
        ...furniture
          .filter((item) => item.id !== drag.id && !item.stack)
          .map(furnitureObstacle),
        ...wallObstacles,
      ];
      const snap = snapPlacement(
        drag.size,
        target,
        obstacles,
        undefined,
        undefined,
        snapRef.current,
      );
      const contained = separateFromWalls(
        wallObstacles,
        drag.size,
        snap.center,
      );
      moveRef.current({
        position: contained,
        // A rider dropped anywhere but a host floor-places (clears anchor).
        ...(drag.rider ? { stack: null } : {}),
      });
      setGuides(snap.guides);
    };
    const handleUp = () => endRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      moveRef.current(
        drag.mount
          ? {
              position: drag.original,
              rotation: drag.originalRotation,
              mount: drag.mount.original,
            }
          : {
              position: drag.original,
              ...(drag.rider ? { stack: drag.rider.original } : {}),
            },
      );
      endRef.current();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drag, camera, gl, freeVerticalMounts, elevationY]);

  return (
    <group>
      <SnapGuides guides={guides} unit={unit} />
      {armedHost && <HostHighlight host={armedHost} />}
    </group>
  );
}
