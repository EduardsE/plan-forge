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
  Room,
  Stack,
  WallMount,
} from "#/lib/model";
import { canHostStack, isStackRider, roomAtPoint } from "#/lib/model";
import { mountAt } from "#/lib/mount-place";
import {
  furnitureObstacle,
  outlineWallObstacles,
  type PlacementGuide,
  rotatedFootprintSize,
  snapPlacement,
} from "#/lib/place";
import { stackAt } from "#/lib/stack-place";
import type { Unit } from "#/lib/units";

/**
 * Moving a placed item by pointer-drag, shared by both lenses: the 3D
 * dollhouse and the 2D plan arm a drag from a pointerdown on an
 * already-selected item, and the session reuses `snapPlacement`'s quantize /
 * outline clamp / wall-flush snap plus the wall-clearance guide pills.
 *
 * Drags are floor-wide: each move resolves the room under the dragged
 * *center* and contains/snaps within it, so carrying an item across a seam
 * reparents it into the destination room (the update reports the target
 * room's id). Neighbor rooms' walls join the snap pipeline as obstacle
 * faces, and wall/host drags likewise consider every room's walls/hosts.
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
  /** Room owning the item at drag start, restored (with position) by esc. */
  roomId: string;
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
 * Move-drag state for a scene: `beginDrag` from an item's pointerdown handler
 * arms a session and pauses the camera controls around it.
 */
export function useMoveDrag(onMoveActiveChange: (active: boolean) => void) {
  const [drag, setDrag] = useState<MoveDrag | null>(null);
  const { begin, end } = useControlsPause(onMoveActiveChange);
  const beginDrag = useCallback(
    (
      item: FurnitureItem,
      /** Id of the room whose furniture array holds the item right now. */
      roomId: string,
      /** Where on the item the pointer grabbed it, plan coords. */
      grabPoint: Point,
      screen: { x: number; y: number },
      /** World-space height of the grab point (0 for the flat 2D lens). */
      grabHeight = 0,
    ) => {
      setDrag({
        id: item.id,
        roomId,
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
 * plane, resolves the target room under the dragged center, feeds
 * `snapPlacement` (same quantize / clamp / wall-flush as the placement
 * ghost) into `onMove` with that room's id, and renders the wall-clearance
 * guides. Pointerup commits wherever the item is; esc restores
 * `drag.original` in `drag.roomId`.
 */
export function MoveDragSession({
  rooms,
  floor,
  drag,
  unit,
  snapEnabled,
  onMove,
  onEnd,
}: {
  /** Every room of the floor — the drag resolves its target per move. */
  rooms: Room[];
  /** The graph floor — wall-mount drags re-anchor to its edges. */
  floor: Floor;
  drag: MoveDrag;
  unit: Unit;
  /** Snap toggle: off means free move (contained, but no flush/quantize). */
  snapEnabled: boolean;
  /** Live update — a floor item patches its position; a wall item also its
   * rotation and mount as it slides onto the nearest wall. `targetRoomId`
   * differing from the item's current room reparents it there. */
  onMove: (update: FurnitureUpdate, targetRoomId: string) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<PlacementGuide[]>([]);
  // The host the rider currently hovers, for the top-surface highlight.
  const [armedHost, setArmedHost] = useState<FurnitureItem | null>(null);
  // Latest rooms/callbacks without resubscribing the listeners mid-drag
  // (every move churns the floor, reparenting included).
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  // The room the drag last targeted — the fallback when the dragged center
  // sits over no room (the gap between non-flush rooms, or past the floor).
  const lastRoomIdRef = useRef(drag.roomId);

  useEffect(() => {
    // Track the pointer across the plane of the grab point, so an elevated
    // grab (3D lens) keeps the item under the hand instead of adding the
    // floor-projection parallax.
    const toFloor = floorProjector(
      gl,
      camera,
      new Plane(new Vector3(0, 1, 0), -drag.grabHeight),
    );
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
      const rooms = roomsRef.current;
      const target = {
        x: point.x - drag.grab.x,
        y: point.y - drag.grab.y,
      };
      if (drag.mount) {
        // Wall item: re-mount to the nearest graph edge that fits it. The
        // owning room falls out of where the mounted position lands (the
        // graph is one shared space — no cross-room mount variant needed).
        const result = mountAt(
          floorRef.current,
          target,
          drag.mount.footprint,
          drag.mount.elevation,
          snapRef.current,
        );
        if (!result) return;
        const roomId =
          roomAtPoint(rooms, result.position)?.id ?? lastRoomIdRef.current;
        lastRoomIdRef.current = roomId;
        moveRef.current(
          {
            position: result.position,
            rotation: result.rotation,
            mount: result.mount,
          },
          roomId,
        );
        setGuides(result.guides);
        return;
      }
      if (drag.rider) {
        // Rider over a host — any room's host — anchors onto its top
        // (hit-test the cursor, so grabbing a lamp by its edge still stacks
        // where the hand points). Landing on another room's host reparents
        // the rider into that room.
        const hosts = rooms.flatMap((room) =>
          room.furniture.filter(
            (item) => item.id !== drag.id && canHostStack(item),
          ),
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
          const hostRoom = rooms.find((room) =>
            room.furniture.some((item) => item.id === stacked.host.id),
          );
          const roomId = hostRoom?.id ?? lastRoomIdRef.current;
          lastRoomIdRef.current = roomId;
          moveRef.current(
            { position: stacked.position, stack: stacked.stack },
            roomId,
          );
          setGuides([]);
          setArmedHost(stacked.host);
          return;
        }
        setArmedHost(null);
      }
      // Floor item: the room under the dragged center is the target —
      // crossing a seam reparents. Its own furniture plus every other
      // room's walls are the snap obstacles, so a piece can't slide over a
      // party wall unnoticed.
      const targetRoom =
        roomAtPoint(rooms, target) ??
        rooms.find((room) => room.id === lastRoomIdRef.current) ??
        rooms[0];
      if (!targetRoom) return;
      lastRoomIdRef.current = targetRoom.id;
      const obstacles = [
        ...targetRoom.furniture
          .filter((item) => item.id !== drag.id && !item.stack)
          .map(furnitureObstacle),
        ...rooms
          .filter((room) => room.id !== targetRoom.id)
          .flatMap((room) => outlineWallObstacles(room.outline)),
      ];
      const snap = snapPlacement(
        targetRoom.outline,
        drag.size,
        target,
        obstacles,
        undefined,
        undefined,
        snapRef.current,
      );
      moveRef.current(
        {
          position: snap.center,
          // A rider dropped anywhere but a host floor-places (clears anchor).
          ...(drag.rider ? { stack: null } : {}),
        },
        targetRoom.id,
      );
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
        // Esc restores the original room along with the original spot.
        drag.roomId,
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
  }, [drag, camera, gl]);

  return (
    <group>
      <SnapGuides guides={guides} unit={unit} />
      {armedHost && <HostHighlight host={armedHost} />}
    </group>
  );
}
