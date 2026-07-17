import {
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MathUtils,
  Spherical,
  type OrthographicCamera as ThreeOrthographicCamera,
  type PerspectiveCamera as ThreePerspectiveCamera,
  Vector3,
} from "three";
import { DrawScene } from "#/components/draw-scene";
import type { DrawTool } from "#/components/draw-tool-stack";
import { OpeningGhost } from "#/components/opening-ghost";
import { PlacementGhost } from "#/components/placement-ghost";
import { PlanScene } from "#/components/plan-scene";
import { RoomScene } from "#/components/room-scene";
import { WallMountGhost } from "#/components/wall-mount-ghost";
import {
  type CameraApi,
  type CameraReadoutStore,
  easeInOutCubic,
  frustumDistance,
  frustumHeight,
  perspectiveFitDistance,
  planFitZoom,
  wrapAngle,
} from "#/lib/camera";
import {
  addFloorOpening,
  addFurniture,
  allFurnitureOf,
  type Bounds,
  type CatalogItem,
  type DerivedRoom,
  edgeCeiling,
  type Floor,
  type FurnitureItem,
  type FurnitureUpdate,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  floorBounds,
  isOpeningItem,
  isWallItem,
  moveFloorOpening,
  type Opening,
  type OpeningKind,
  type Point,
  removeFloorOpening,
  resizeFloorOpening,
  type Stack,
  shiftOpeningVertical,
  updateFloorFurniture,
  updateFurniture,
} from "#/lib/model";
import type { WallMountResult } from "#/lib/mount-place";
import { OPENING_GRID, type OpeningPlacement } from "#/lib/opening-place";
import type { Unit } from "#/lib/units";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

/**
 * The R3F workspace canvas: one scene for both lenses, switched by camera.
 * The 3D lens orbits a perspective camera; 2D and draw mode look
 * straight down through an orthographic one. The zoom pill drives the rig
 * through `CameraApi`; the status bar and pill listen on the readout store.
 *
 * Lens switches animate: the perspective camera flies between its orbit pose
 * and a top-down, narrow-fov pose whose framing matches the orthographic
 * view (a dolly-zoom), and the projection swap happens only at the matched
 * endpoint, where it is imperceptible.
 *
 * Scene content is the in-scene ground grid plus the warm room built from
 * the model in `RoomScene` (floor platform, cutaway walls, furniture).
 */

const FOV_DEG = 42;
/** Initial orbit matching the mockup's readout chip: "orbit 38° / 62°". */
const INITIAL_AZIMUTH_DEG = 38;
const INITIAL_POLAR_DEG = 62;
const PERSPECTIVE_MIN_DISTANCE = 1.5;
const PERSPECTIVE_MAX_DISTANCE = 60;
/** Orthographic zoom limits, in CSS px per meter. */
const PLAN_MIN_ZOOM = 5;
const PLAN_MAX_ZOOM = 1000;
const ZOOM_STEP = 1.25;
/** Height of the top-down camera above the floor plane. */
const PLAN_CAMERA_HEIGHT = 30;

const TRANSITION_MS = 600;
/**
 * Fov the perspective camera narrows to at the top-down end of a lens
 * transition; tight enough that swapping to the true orthographic
 * projection there doesn't visibly shift the image.
 */
const TRANSITION_FOV_DEG = 10;
/**
 * Polar angle standing in for "straight down" during transitions — exactly
 * 0 would make lookAt degenerate against the camera's (0,1,0) up.
 */
const TOP_DOWN_PHI = 0.01;

/**
 * Faint warm-ink drafting grid for the plan lenses. WebGL wants opaque line
 * colors, so these are rgba(30,30,25,.05/.09) pre-blended onto the paper
 * ground (--paper, #f1f1ed). The 3D lens has no in-scene grid at all — its
 * ground is the CSS studio spotlight pool (screen 3d).
 */
const GRID_MINOR_COLOR = "#e6e6e2";
const GRID_MAJOR_COLOR = "#dededa";

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

/**
 * A perspective camera pose during a lens transition. Framing is tracked as
 * the frustum height at the target plane rather than distance, so fov and
 * distance can change together without the room appearing to resize.
 */
interface CameraPose {
  /** Polar angle from straight-above, radians. */
  phi: number;
  /** Azimuth, radians, wrapped to [-π, π]. */
  theta: number;
  fovDeg: number;
  /** Frustum height at the target plane, meters. */
  viewHeight: number;
}

interface CameraTransition {
  toPlan: boolean;
  from: CameraPose;
  to: CameraPose;
  target: Vector3;
  /** Normalized progress 0→1. */
  t: number;
}

function poseOf(camera: ThreePerspectiveCamera, target: Vector3): CameraPose {
  const spherical = new Spherical().setFromVector3(
    camera.position.clone().sub(target),
  );
  return {
    phi: spherical.phi,
    theta: wrapAngle(spherical.theta),
    fovDeg: camera.fov,
    viewHeight: frustumHeight(spherical.radius, camera.fov),
  };
}

function applyPose(
  camera: ThreePerspectiveCamera,
  pose: CameraPose,
  target: Vector3,
) {
  const distance = frustumDistance(pose.viewHeight, pose.fovDeg);
  camera.position
    .setFromSpherical(
      new Spherical(distance, Math.max(pose.phi, TOP_DOWN_PHI), pose.theta),
    )
    .add(target);
  camera.fov = pose.fovDeg;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}

function lerpPose(from: CameraPose, to: CameraPose, k: number): CameraPose {
  return {
    phi: MathUtils.lerp(from.phi, to.phi, k),
    theta: MathUtils.lerp(from.theta, to.theta, k),
    fovDeg: MathUtils.lerp(from.fovDeg, to.fovDeg, k),
    viewHeight: MathUtils.lerp(from.viewHeight, to.viewHeight, k),
  };
}

interface CameraRigProps {
  /** Whole-floor bounding box the cameras frame (every room together). */
  bounds: Bounds | null;
  planView: boolean;
  /**
   * Which camera actually renders — owned by the parent so the scene
   * presentation can switch with it. Lags planView while a transition
   * flies: the perspective camera animates in both directions, so the
   * ortho camera only takes over once a to-plan flight has landed on its
   * matched pose.
   */
  renderPlan: boolean;
  onRenderPlanChange: (renderPlan: boolean) => void;
  /** A furniture move drag owns the pointer — the controls sit it out. */
  locked: boolean;
  apiRef: RefObject<CameraApi | null>;
  readoutStore: CameraReadoutStore;
}

function CameraRig({
  bounds,
  planView,
  renderPlan,
  onRenderPlanChange: setRenderPlan,
  locked,
  apiRef,
  readoutStore,
}: CameraRigProps) {
  const size = useThree((state) => state.size);
  const controlsRef = useRef<OrbitControlsRef | null>(null);
  const perspectiveRef = useRef<ThreePerspectiveCamera | null>(null);
  const orthoRef = useRef<ThreeOrthographicCamera | null>(null);
  /** Perspective fit distance; "zoom 1.0×" in the readout means this far. */
  const fitDistanceRef = useRef(1);

  const [transitioning, setTransitioning] = useState(false);
  const transitionRef = useRef<CameraTransition | null>(null);
  /** Orbit pose saved when leaving 3D, restored on the way back. */
  const savedOrbitRef = useRef<CameraPose | null>(null);

  // Keyed on the center *values*, not the bounds object: `bounds` gets a new
  // identity on every floor mutation — including each frame of a furniture
  // drag — and an identity-keyed Vector3 here would ripple into the camera
  // `position` props below, which R3F re-applies on identity change. That
  // re-apply teleported the live camera back to the initial pose mid-drag.
  const centerX = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
  const centerZ = bounds ? (bounds.min.y + bounds.max.y) / 2 : 0;
  const center = useMemo(
    () => new Vector3(centerX, 0, centerZ),
    [centerX, centerZ],
  );
  const fitRadius = bounds ? Math.hypot(bounds.width, bounds.height) / 2 : 5;

  // Snapshot the center used for the cameras' *initial* declarative placement,
  // captured once the floor bounds first exist. Live `center` tracks the room
  // bounds centroid, which shifts on every wall/corner edit; feeding that into
  // the `position` props below would have R3F re-apply it (teleporting the
  // camera and discarding the current pan/orbit), recentering the canvas
  // mid-edit. Explicit fit / zoom-to-fit still uses live `center`.
  const initialCenterRef = useRef<Vector3 | null>(null);
  if (initialCenterRef.current === null && bounds) {
    initialCenterRef.current = new Vector3(centerX, 0, centerZ);
  }
  const initialCenter = initialCenterRef.current ?? center;

  // Persistent controls target: survives the controls remount on every lens
  // swap (the OrbitControls key), so panning isn't lost across transitions.
  const targetRef = useRef<Vector3 | null>(null);
  if (targetRef.current === null) {
    targetRef.current = new Vector3(center.x, 0, center.z);
  }
  const target = targetRef.current;

  const publish = useCallback(() => {
    if (renderPlan) {
      const camera = orthoRef.current;
      if (camera) {
        readoutStore.publish({ kind: "plan", pxPerMeter: camera.zoom });
      }
      return;
    }
    const camera = perspectiveRef.current;
    if (!camera) return;
    const spherical = new Spherical().setFromVector3(
      camera.position.clone().sub(controlsRef.current?.target ?? target),
    );
    readoutStore.publish({
      kind: "orbit",
      azimuthDeg: MathUtils.radToDeg(spherical.theta),
      polarDeg: MathUtils.radToDeg(spherical.phi),
      zoom: fitDistanceRef.current / spherical.radius,
    });
  }, [renderPlan, target, readoutStore]);

  const handleControlsChange = useCallback(() => {
    const controls = controlsRef.current;
    if (controls) target.copy(controls.target);
    publish();
  }, [target, publish]);

  const fitPerspective = useCallback(() => {
    const camera = perspectiveRef.current;
    if (!camera || size.height === 0) return;
    const distance = perspectiveFitDistance(
      fitRadius,
      FOV_DEG,
      size.width / size.height,
    );
    fitDistanceRef.current = distance;
    const anchor = controlsRef.current?.target ?? target;
    const spherical = new Spherical().setFromVector3(
      camera.position.clone().sub(anchor),
    );
    spherical.radius = distance;
    camera.position.setFromSpherical(spherical).add(anchor);
    camera.lookAt(anchor);
  }, [fitRadius, size, target]);

  const fitOrtho = useCallback(() => {
    const camera = orthoRef.current;
    if (!camera || !bounds || bounds.width === 0 || bounds.height === 0) return;
    camera.zoom = MathUtils.clamp(
      planFitZoom(bounds.width, bounds.height, size.width, size.height),
      PLAN_MIN_ZOOM,
      PLAN_MAX_ZOOM,
    );
    camera.position.set(center.x, PLAN_CAMERA_HEIGHT, center.z);
    camera.updateProjectionMatrix();
  }, [bounds, size, center]);

  const zoomToFit = useCallback(() => {
    if (transitionRef.current) return;
    target.set(center.x, 0, center.z);
    controlsRef.current?.target.copy(target);
    if (renderPlan) {
      fitOrtho();
    } else {
      fitPerspective();
    }
    controlsRef.current?.update();
    publish();
  }, [renderPlan, center, target, fitOrtho, fitPerspective, publish]);

  const applyZoom = useCallback(
    (factor: number) => {
      if (transitionRef.current) return;
      if (renderPlan) {
        const camera = orthoRef.current;
        if (!camera) return;
        camera.zoom = MathUtils.clamp(
          camera.zoom * factor,
          PLAN_MIN_ZOOM,
          PLAN_MAX_ZOOM,
        );
        camera.updateProjectionMatrix();
      } else {
        const camera = perspectiveRef.current;
        if (!camera) return;
        const anchor = controlsRef.current?.target ?? target;
        const offset = camera.position.clone().sub(anchor);
        offset.setLength(
          MathUtils.clamp(
            offset.length() / factor,
            PERSPECTIVE_MIN_DISTANCE,
            PERSPECTIVE_MAX_DISTANCE,
          ),
        );
        camera.position.copy(anchor).add(offset);
      }
      controlsRef.current?.update();
      publish();
    },
    [renderPlan, target, publish],
  );

  useEffect(() => {
    apiRef.current = {
      zoomIn: () => applyZoom(ZOOM_STEP),
      zoomOut: () => applyZoom(1 / ZOOM_STEP),
      zoomToFit,
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, applyZoom, zoomToFit]);

  // Fit both cameras once the viewport size is known.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || size.width === 0 || size.height === 0) return;
    initializedRef.current = true;
    fitPerspective();
    fitOrtho();
    controlsRef.current?.update();
    publish();
  }, [size, fitPerspective, fitOrtho, publish]);

  // Start a lens transition whenever the requested view flips.
  const prevPlanViewRef = useRef(planView);
  useEffect(() => {
    if (prevPlanViewRef.current === planView) return;
    prevPlanViewRef.current = planView;
    const perspective = perspectiveRef.current;
    const ortho = orthoRef.current;
    if (!perspective || !ortho || !initializedRef.current) {
      setRenderPlan(planView);
      return;
    }
    const active = transitionRef.current;
    const flightTarget = (active ? active.target : target).clone().setY(0);
    // Land inside the ortho zoom limits so the projection swap never jumps.
    const minViewHeight = size.height / PLAN_MAX_ZOOM;
    const maxViewHeight = size.height / PLAN_MIN_ZOOM;

    let from: CameraPose;
    let to: CameraPose;
    if (planView) {
      // 3D → 2D: fly the live perspective camera down to a matched pose.
      from = poseOf(perspective, flightTarget);
      if (!active) savedOrbitRef.current = from;
      to = {
        phi: TOP_DOWN_PHI,
        theta: 0,
        fovDeg: TRANSITION_FOV_DEG,
        viewHeight: MathUtils.clamp(
          from.viewHeight,
          minViewHeight,
          maxViewHeight,
        ),
      };
    } else if (active) {
      // Reversed mid-flight: continue from wherever the camera is now.
      from = poseOf(perspective, flightTarget);
      to = savedOrbitRef.current ?? from;
    } else {
      // 2D → 3D: hand off from the ortho camera at a matched perspective
      // pose, then fly out to the remembered (or initial) orbit.
      flightTarget.set(ortho.position.x, 0, ortho.position.z);
      from = {
        phi: TOP_DOWN_PHI,
        theta: 0,
        fovDeg: TRANSITION_FOV_DEG,
        viewHeight: size.height / ortho.zoom,
      };
      applyPose(perspective, from, flightTarget);
      to = savedOrbitRef.current ?? {
        phi: MathUtils.degToRad(INITIAL_POLAR_DEG),
        theta: MathUtils.degToRad(INITIAL_AZIMUTH_DEG),
        fovDeg: FOV_DEG,
        viewHeight: frustumHeight(
          perspectiveFitDistance(
            fitRadius,
            FOV_DEG,
            size.width / Math.max(size.height, 1),
          ),
          FOV_DEG,
        ),
      };
    }
    transitionRef.current = {
      toPlan: planView,
      from,
      to,
      target: flightTarget,
      t: 0,
    };
    target.copy(flightTarget);
    // The perspective camera renders throughout the flight.
    setRenderPlan(false);
    setTransitioning(true);
  }, [planView, size, fitRadius, target, setRenderPlan]);

  useFrame((_, delta) => {
    const transition = transitionRef.current;
    const perspective = perspectiveRef.current;
    if (!transition || !perspective) return;
    transition.t = Math.min(transition.t + (delta * 1000) / TRANSITION_MS, 1);
    const pose = lerpPose(
      transition.from,
      transition.to,
      easeInOutCubic(transition.t),
    );
    applyPose(perspective, pose, transition.target);
    // Keep the chip live mid-flight, in the units of the destination lens.
    if (transition.toPlan) {
      readoutStore.publish({
        kind: "plan",
        pxPerMeter: size.height / pose.viewHeight,
      });
    } else {
      readoutStore.publish({
        kind: "orbit",
        azimuthDeg: MathUtils.radToDeg(pose.theta),
        polarDeg: MathUtils.radToDeg(pose.phi),
        zoom:
          fitDistanceRef.current / frustumDistance(pose.viewHeight, FOV_DEG),
      });
    }
    if (transition.t < 1) return;

    transitionRef.current = null;
    if (transition.toPlan) {
      const ortho = orthoRef.current;
      if (ortho) {
        ortho.zoom = MathUtils.clamp(
          size.height / transition.to.viewHeight,
          PLAN_MIN_ZOOM,
          PLAN_MAX_ZOOM,
        );
        ortho.position.set(
          transition.target.x,
          PLAN_CAMERA_HEIGHT,
          transition.target.z,
        );
        ortho.updateProjectionMatrix();
      }
      perspective.fov = FOV_DEG;
      perspective.updateProjectionMatrix();
    }
    setRenderPlan(transition.toPlan);
    setTransitioning(false);
  });

  // Refresh the readout when the rendering lens settles (publish identity
  // tracks renderPlan).
  useEffect(() => {
    if (initializedRef.current) publish();
  }, [publish]);

  const initialPerspectivePosition = useMemo(
    () =>
      new Vector3()
        .setFromSpherical(
          new Spherical(
            10,
            MathUtils.degToRad(INITIAL_POLAR_DEG),
            MathUtils.degToRad(INITIAL_AZIMUTH_DEG),
          ),
        )
        .add(initialCenter),
    [initialCenter],
  );

  return (
    <>
      <PerspectiveCamera
        ref={perspectiveRef}
        makeDefault={!renderPlan}
        fov={FOV_DEG}
        near={0.1}
        far={200}
        position={initialPerspectivePosition}
      />
      <OrthographicCamera
        ref={orthoRef}
        makeDefault={renderPlan}
        near={0.1}
        far={100}
        up={[0, 0, -1]}
        position={[initialCenter.x, PLAN_CAMERA_HEIGHT, initialCenter.z]}
        zoom={80}
      />
      <OrbitControls
        key={renderPlan ? "plan" : "orbit"}
        ref={controlsRef}
        // makeDefault publishes the instance as state.controls so the
        // move drag can disable it synchronously on pointerdown — the
        // `enabled` prop alone flushes after OrbitControls has already
        // accepted the gesture and eaten the first pointermoves.
        makeDefault
        target={[target.x, 0, target.z]}
        enabled={!transitioning && !locked}
        enableRotate={!renderPlan}
        minDistance={PERSPECTIVE_MIN_DISTANCE}
        maxDistance={PERSPECTIVE_MAX_DISTANCE}
        minZoom={PLAN_MIN_ZOOM}
        maxZoom={PLAN_MAX_ZOOM}
        // Keep the orbit above the floor; the plan camera's straight-down
        // pose reads as polar 90° in the controls' up-relative frame, so it
        // must stay unclamped there.
        maxPolarAngle={renderPlan ? Math.PI : Math.PI / 2 - 0.06}
        onChange={handleControlsChange}
      />
    </>
  );
}

/** Clicks that travelled further than this (px) were camera drags, not picks. */
const CLICK_SLOP_PX = 4;

export interface PlannerCanvasProps {
  floor: Floor;
  /** The floor's derived rooms — scenes render these; "which room" for an
   * edit resolves from them. */
  rooms: DerivedRoom[];
  /** Furniture that lands in no room (dangling / open-canvas) — rendered and
   * editable like any other; its membership readout is "—". */
  unassignedFurniture: FurnitureItem[];
  /** A discrete whole-floor mutation (opening edits, drops) — one undo step. */
  onFloorChange: (floor: Floor) => void;
  /** A mid-drag whole-floor state (opening slide) — not its own step. */
  onFloorPreview: (floor: Floor) => void;
  /** A room drag began/ended (however) — the route settles the previews
   * into one step on end, and stands its keyboard editing down meanwhile. */
  onRoomDragActiveChange: (active: boolean) => void;
  viewMode: ViewMode;
  /** Furniture selection — owned by the route, shared with the inspector. */
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
  /** Opening selection (2D lens) — owned by the route too, so the status
   * bar can label a portal ("connects Living ↔ Kitchen"). */
  selectedOpeningId: string | null;
  onSelectedOpeningIdChange: (id: string | null) => void;
  cameraApiRef: RefObject<CameraApi | null>;
  readoutStore: CameraReadoutStore;
  /** Display unit for draw-mode labels. */
  unit: Unit;
  /** Bottom-left toggles: show the reference grid, and snap while editing. */
  gridVisible: boolean;
  snapEnabled: boolean;
  /** Draw-mode state, owned by the route. Draw edits the wall graph live. */
  drawTool: DrawTool;
  /** Id of the chain's last node (wall tool), or null for no active chain. */
  chainNode: string | null;
  onExtendChain: (from: Point, to: Point) => void;
  onEndChain: () => void;
  onPlaceRect: (a: Point, b: Point) => void;
  onNodeMovePreview: (nodeId: string, point: Point) => void;
  onNodeMoveSettle: (nodeId: string, point: Point) => void;
  onNodeMoveCancel: (nodeId: string, original: Point) => void;
  onBeginSplitDrag: (edgeId: string, point: Point) => string | null;
  onSetEdgeLength: (edgeId: string, length: number, fixed: "a" | "b") => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  /** Catalog item mid-drag from the objects panel, if any. */
  placingItem: CatalogItem | null;
  /** Placement session over — dropped or cancelled (route clears it). */
  onPlacingEnd: () => void;
}

export function PlannerCanvas({
  floor,
  rooms,
  unassignedFurniture,
  onFloorChange,
  onFloorPreview,
  onRoomDragActiveChange,
  viewMode,
  selectedId,
  onSelectedIdChange: setSelectedId,
  selectedOpeningId,
  onSelectedOpeningIdChange: setSelectedOpeningId,
  cameraApiRef,
  readoutStore,
  unit,
  gridVisible,
  snapEnabled,
  drawTool,
  chainNode,
  onExtendChain,
  onEndChain,
  onPlaceRect,
  onNodeMovePreview,
  onNodeMoveSettle,
  onNodeMoveCancel,
  onBeginSplitDrag,
  onSetEdgeLength,
  onDeleteNode,
  onDeleteEdge,
  placingItem,
  onPlacingEnd,
}: PlannerCanvasProps) {
  // Same lens split as the 2D|3D pill: draw is a top-down 2D flow; the
  // objects catalog drops onto either lens.
  const planView = viewMode === "2d" || viewMode === "draw";
  const drawing = viewMode === "draw";
  // Scene presentation follows the rendering camera, not the requested
  // lens: during a transition flight the warm 3D room stays up, and the
  // plan drawing swaps in only at the matched top-down endpoint.
  const [renderPlan, setRenderPlan] = useState(planView);

  // Screen position of the last pointer-down, to tell orbit drags from
  // picks in onPointerMissed (which only carries the raw MouseEvent).
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  // A furniture or opening drag in either lens; camera controls pause for it.
  const [sceneDragActive, setSceneDragActive] = useState(false);
  // Every room drag (furniture move, opening slide) reports through here —
  // the route mirrors it: releasing the controls is also the moment its
  // previews become one history step, and keyboard editing stands down
  // while a drag runs. Ends however the drag does: pointerup, esc (the
  // restore preview lands first, so settling finds nothing to fold), or
  // unmount on a lens switch. DrawScene keeps plain `setSceneDragActive` —
  // corner drags edit the draft, not the room.
  const handleRoomDragActive = useCallback(
    (active: boolean) => {
      setSceneDragActive(active);
      onRoomDragActiveChange(active);
    },
    [onRoomDragActiveChange],
  );
  // Whole-floor camera framing: every room's outline together.
  const bounds = useMemo(() => floorBounds(rooms), [rooms]);
  // Every derived furniture item (rooms' + unassigned) — the placement ghost
  // snaps against all of them, floor-wide.
  const allFurniture = useMemo(
    () => allFurnitureOf(rooms, unassignedFurniture),
    [rooms, unassignedFurniture],
  );

  const selectItem = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedOpeningId(null);
    },
    [setSelectedId, setSelectedOpeningId],
  );
  const selectOpening = useCallback(
    (id: string) => {
      setSelectedOpeningId(id);
      setSelectedId(null);
    },
    [setSelectedId, setSelectedOpeningId],
  );

  const moveItem = useCallback(
    // Streams per pointermove — a preview, folded into one history step when
    // the drag session releases the camera controls below. Furniture is
    // floor-level (membership is a derived readout), so a move is just a
    // position patch on `floor.furniture`; deriveFloor re-partitions the item
    // into whichever room now contains it — or the unassigned bucket.
    (id: string, update: FurnitureUpdate) => {
      onFloorPreview(
        updateFloorFurniture(floor, (room) =>
          updateFurniture(room, id, update),
        ),
      );
    },
    [floor, onFloorPreview],
  );

  // A door/window card released on a wall (the ghost resolved the host edge,
  // the clamped edge-local offset, and which face it opens onto).
  const placeOpeningItem = useCallback(
    (kind: OpeningKind, placement: OpeningPlacement) => {
      const opening: Opening = {
        id: crypto.randomUUID(),
        kind,
        edgeId: placement.edgeId,
        offset: placement.offset,
        width: placement.width,
        side: placement.side,
      };
      if (kind === "door") opening.hinge = "start";
      onFloorChange(addFloorOpening(floor, opening));
      // Selection follows the insert (like a drop), ready to drag/adjust.
      selectOpening(opening.id);
      onPlacingEnd();
    },
    [floor, onFloorChange, selectOpening, onPlacingEnd],
  );
  const moveOpeningTo = useCallback(
    // Streams per pointermove during an opening slide (edge coordinates).
    (id: string, offset: number) =>
      onFloorPreview(moveFloorOpening(floor, id, offset)),
    [floor, onFloorPreview],
  );
  const dragOpening3D = useCallback(
    // Streams per pointermove during a 3D opening drag: the along-wall slide
    // and (for windows) the whole-hole vertical shift — height preserved,
    // clamped to floor/ceiling (the host edge's tallest adjacent room) and
    // quantized like the slide — land on ONE floor, one preview. The shift
    // applies first so the slide's no-overlap check sees the band the window
    // is headed for: a diagonal drag can lift it over a stacked neighbor and
    // slide across in the same gesture.
    (id: string, offset: number | null, bottom: number | null) => {
      let next = floor;
      if (bottom !== null) {
        const opening = next.openings.find((o) => o.id === id);
        if (opening) {
          next = shiftOpeningVertical(
            next,
            id,
            bottom,
            edgeCeiling(rooms, opening.edgeId),
            snapEnabled ? OPENING_GRID : 0,
          );
        }
      }
      if (offset !== null) next = moveFloorOpening(next, id, offset);
      if (next !== floor) onFloorPreview(next);
    },
    [floor, rooms, snapEnabled, onFloorPreview],
  );
  const flipHinge = useCallback(
    (id: string) => onFloorChange(flipFloorOpeningHinge(floor, id)),
    [floor, onFloorChange],
  );
  const flipSide = useCallback(
    (id: string) => onFloorChange(flipFloorOpeningSide(floor, id)),
    [floor, onFloorChange],
  );
  const resizeOpeningTo = useCallback(
    // A committed width from the chip's field; `resizeFloorOpening` owns the
    // clamping (clear of the edge's other openings) and no-ops by reference.
    (id: string, width: number) =>
      onFloorChange(resizeFloorOpening(floor, id, width)),
    [floor, onFloorChange],
  );
  const deleteOpening = useCallback(
    (id: string) => {
      onFloorChange(removeFloorOpening(floor, id));
      setSelectedOpeningId(null);
    },
    [floor, onFloorChange, setSelectedOpeningId],
  );

  // A placement drag takes over the scene; a leftover selection chip would
  // sit between the pointer and the floor (its DOM would eat the drop).
  useEffect(() => {
    if (!placingItem) return;
    setSelectedId(null);
    setSelectedOpeningId(null);
  }, [placingItem, setSelectedId, setSelectedOpeningId]);

  const placeDraggedItem = useCallback(
    // Furniture is floor-level: the drop lands on `floor.furniture` wherever
    // the walls allowed the ghost to sit — a room, the dead band at a shared
    // wall, or the open canvas. deriveFloor assigns membership (or the
    // unassigned bucket); no drop is ever silently discarded.
    (center: Point, stack?: Stack) => {
      if (!placingItem) return;
      const id = crypto.randomUUID();
      onFloorChange(
        updateFloorFurniture(floor, (room) =>
          addFurniture(room, {
            id,
            catalogId: placingItem.id,
            position: center,
            rotation: 0,
            footprint: placingItem.footprint,
            // Dropped on a host's top: the item lands stacked.
            ...(stack ? { stack } : {}),
          }),
        ),
      );
      // Selection follows the drop, same as duplicate.
      setSelectedId(id);
      onPlacingEnd();
    },
    [placingItem, floor, onFloorChange, onPlacingEnd, setSelectedId],
  );
  const placeMountedItem = useCallback(
    // A mount stores only its edge — floor-level like every other item; the
    // room (if any) is a derived readout of where the position falls.
    (result: WallMountResult) => {
      if (!placingItem) return;
      const id = crypto.randomUUID();
      onFloorChange(
        updateFloorFurniture(floor, (room) =>
          addFurniture(room, {
            id,
            catalogId: placingItem.id,
            position: result.position,
            rotation: result.rotation,
            footprint: placingItem.footprint,
            mount: result.mount,
          }),
        ),
      );
      setSelectedId(id);
      onPlacingEnd();
    },
    [placingItem, floor, onFloorChange, onPlacingEnd, setSelectedId],
  );

  return (
    // isolate: drei <Html> overlays carry huge z-indexes; contain them so
    // the chrome around the workspace still paints on top.
    // cursor-none: the wall tool draws its own crosshair cursor; the length
    // pills restore their own pointer cursor.
    <div
      className={cn(
        "absolute inset-0 isolate",
        // The drawn crosshair replaces the OS cursor while the wall tool is
        // active — other tools reshape with the normal pointer.
        drawing && renderPlan && drawTool === "wall" && "cursor-none",
      )}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <Canvas
        flat
        // Soft (PCF) shadow maps so the 3D lens's sun can throw real daylight
        // patches through the window holes; the plan/draw lenses register no
        // shadow casters, so their shadow pass is a no-op.
        shadows
        dpr={[1, 2]}
        // react-use-measure wires its ResizeObserver to the *scroll*-debounced
        // handler (50 ms by default), so a container resize — the library
        // column docking — leaves the canvas at its stale size for several
        // frames and the room visibly lurches, then snaps. Undebounced, the
        // buffer follows the grid within a frame.
        resize={{ debounce: 0 }}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={(event) => {
          // Only furniture raycasts, so any true click elsewhere lands here.
          if (event.type !== "click") return;
          // R3F listens on the canvas *container*, so clicks on DOM
          // overlays (the selection chip) also arrive as misses — only a
          // click on the canvas itself may deselect.
          if (!(event.target instanceof HTMLCanvasElement)) return;
          const down = pointerDownRef.current;
          if (
            down &&
            Math.hypot(event.clientX - down.x, event.clientY - down.y) >
              CLICK_SLOP_PX
          ) {
            return;
          }
          setSelectedId(null);
          setSelectedOpeningId(null);
        }}
      >
        <CameraRig
          bounds={bounds}
          planView={planView}
          renderPlan={renderPlan}
          onRenderPlanChange={setRenderPlan}
          locked={sceneDragActive}
          apiRef={cameraApiRef}
          readoutStore={readoutStore}
        />
        {/* Drafting grid, plan lenses only — the 3D lens grounds the room on
				    the CSS spotlight pool instead (it also stays out of transition
				    flights, which start and end at the matched top-down pose). */}
        {gridVisible && renderPlan && (
          <Grid
            infiniteGrid
            followCamera={false}
            cellSize={0.5}
            cellThickness={1}
            cellColor={GRID_MINOR_COLOR}
            sectionSize={2.5}
            sectionThickness={1.4}
            sectionColor={GRID_MAJOR_COLOR}
            fadeDistance={130}
            fadeStrength={1}
          />
        )}
        {renderPlan ? (
          drawing ? (
            <DrawScene
              floor={floor}
              rooms={rooms}
              unit={unit}
              snapEnabled={snapEnabled}
              tool={drawTool}
              chainNode={chainNode}
              onExtendChain={onExtendChain}
              onEndChain={onEndChain}
              onPlaceRect={onPlaceRect}
              onNodeMovePreview={onNodeMovePreview}
              onNodeMoveSettle={onNodeMoveSettle}
              onNodeMoveCancel={onNodeMoveCancel}
              onNodeDragActiveChange={setSceneDragActive}
              onBeginSplitDrag={onBeginSplitDrag}
              onSetEdgeLength={onSetEdgeLength}
              onDeleteNode={onDeleteNode}
              onDeleteEdge={onDeleteEdge}
            />
          ) : (
            <PlanScene
              rooms={rooms}
              unassignedFurniture={unassignedFurniture}
              floor={floor}
              selectedId={selectedId}
              selectedOpeningId={selectedOpeningId}
              unit={unit}
              snapEnabled={snapEnabled}
              onSelectItem={selectItem}
              onMoveItem={moveItem}
              onMoveActiveChange={handleRoomDragActive}
              onSelectOpening={selectOpening}
              onMoveOpening={moveOpeningTo}
              onFlipDoorHinge={flipHinge}
              onFlipOpeningSide={flipSide}
              onDeleteOpening={deleteOpening}
              onResizeOpening={resizeOpeningTo}
            />
          )
        ) : (
          <RoomScene
            rooms={rooms}
            unassignedFurniture={unassignedFurniture}
            floor={floor}
            selectedId={selectedId}
            selectedOpeningId={selectedOpeningId}
            unit={unit}
            snapEnabled={snapEnabled}
            onSelectItem={selectItem}
            onMoveItem={moveItem}
            onMoveActiveChange={handleRoomDragActive}
            onSelectOpening={selectOpening}
            onDragOpening={dragOpening3D}
          />
        )}
        {/* The placement ghost raycasts the active camera onto the floor
				    plane, so the same drag lands in either lens — the 2D plan and
				    the 3D dollhouse are both drop targets. */}
        {!drawing &&
          placingItem &&
          (isOpeningItem(placingItem.id) ? (
            <OpeningGhost
              floor={floor}
              rooms={rooms}
              item={placingItem}
              unit={unit}
              snapEnabled={snapEnabled}
              onPlace={placeOpeningItem}
              onCancel={onPlacingEnd}
            />
          ) : isWallItem(placingItem.id) ? (
            <WallMountGhost
              floor={floor}
              item={placingItem}
              unit={unit}
              snapEnabled={snapEnabled}
              onPlace={placeMountedItem}
              onCancel={onPlacingEnd}
            />
          ) : (
            <PlacementGhost
              furniture={allFurniture}
              floor={floor}
              item={placingItem}
              unit={unit}
              snapEnabled={snapEnabled}
              onPlace={placeDraggedItem}
              onCancel={onPlacingEnd}
            />
          ))}
      </Canvas>
    </div>
  );
}
