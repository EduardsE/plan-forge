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
import { containRoomFurniture } from "#/lib/collision";
import {
	addFurniture,
	addOpening,
	type CatalogItem,
	duplicateFurniture,
	type FurnitureUpdate,
	flipDoorHinge,
	isWallItem,
	moveOpening,
	type Opening,
	type OpeningKind,
	outlineBounds,
	type Point,
	type Room,
	removeFurniture,
	removeOpening,
	rotateFurniture,
	updateFurniture,
} from "#/lib/model";
import type { WallMountResult } from "#/lib/mount-place";
import { furnitureObstacle } from "#/lib/place";
import type { Unit } from "#/lib/units";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

/**
 * The R3F workspace canvas: one scene for both lenses, switched by camera.
 * 3D (and objects) mode orbits a perspective camera; 2D and draw mode look
 * straight down through an orthographic one. The floating toolbar drives the
 * rig through `CameraApi` and the readout chip listens on the readout store.
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
 * The CSS grid tokens are alpha layers over the canvas color; WebGL wants
 * opaque line colors, so these are --canvas-grid-minor / -major pre-blended
 * onto --canvas (#f3f6fa).
 */
const GRID_MINOR_COLOR = "#e9eff7";
const GRID_MAJOR_COLOR = "#dfe8f4";

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
	room: Room;
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
	room,
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

	const bounds = useMemo(() => outlineBounds(room.outline), [room.outline]);
	const center = useMemo(
		() =>
			bounds
				? new Vector3(
						(bounds.min.x + bounds.max.x) / 2,
						0,
						(bounds.min.y + bounds.max.y) / 2,
					)
				: new Vector3(),
		[bounds],
	);
	const fitRadius = bounds ? Math.hypot(bounds.width, bounds.height) / 2 : 5;

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
				.add(center),
		[center],
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
				position={[center.x, PLAN_CAMERA_HEIGHT, center.z]}
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

/** How many degrees one press of the selection toolbar's rotate turns an item. */
const ROTATE_STEP_DEG = 90;
/** Clicks that travelled further than this (px) were camera drags, not picks. */
const CLICK_SLOP_PX = 4;

export interface PlannerCanvasProps {
	room: Room;
	onRoomChange: (room: Room) => void;
	viewMode: ViewMode;
	cameraApiRef: RefObject<CameraApi | null>;
	readoutStore: CameraReadoutStore;
	/** Display unit for draw-mode labels. */
	unit: Unit;
	/** Bottom-left toggles: show the reference grid, and snap while editing. */
	gridVisible: boolean;
	snapEnabled: boolean;
	/** Draw-mode state, owned by the route (the header shows the count). */
	drawTool: DrawTool;
	draftCorners: Point[];
	/** Closed draft: draw mode is reshaping the room, not placing corners. */
	draftClosed: boolean;
	onPlaceCorner: (point: Point) => void;
	onSetDraftSegmentLength: (segmentIndex: number, meters: number) => void;
	onRequestCloseDraft: () => void;
	onMoveDraftCorner: (index: number, point: Point) => void;
	onSplitDraftWall: (wallIndex: number, point: Point) => void;
	/** Catalog item mid-drag from the objects panel, if any. */
	placingItem: CatalogItem | null;
	/** Placement session over — dropped or cancelled (route clears it). */
	onPlacingEnd: () => void;
	/** Armed door/window tool on the 2D lens (route owns it, like drawTool). */
	openingTool: OpeningKind | null;
	/** An insert landed — the route disarms the tool. */
	onOpeningToolDone: () => void;
}

export function PlannerCanvas({
	room,
	onRoomChange,
	viewMode,
	cameraApiRef,
	readoutStore,
	unit,
	gridVisible,
	snapEnabled,
	drawTool,
	draftCorners,
	draftClosed,
	onPlaceCorner,
	onSetDraftSegmentLength,
	onRequestCloseDraft,
	onMoveDraftCorner,
	onSplitDraftWall,
	placingItem,
	onPlacingEnd,
	openingTool,
	onOpeningToolDone,
}: PlannerCanvasProps) {
	// Same lens split as the 2D|3D pill: draw is a top-down 2D flow, the
	// objects catalog drops onto the 3D dollhouse.
	const planView = viewMode === "2d" || viewMode === "draw";
	const drawing = viewMode === "draw";
	// Scene presentation follows the rendering camera, not the requested
	// lens: during a transition flight the warm 3D room stays up, and the
	// plan drawing swaps in only at the matched top-down endpoint.
	const [renderPlan, setRenderPlan] = useState(planView);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Selected opening (2D lens only) — one selection at a time across both.
	const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
		null,
	);
	// Screen position of the last pointer-down, to tell orbit drags from
	// picks in onPointerMissed (which only carries the raw MouseEvent).
	const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
	// A furniture or opening drag in either lens; camera controls pause for it.
	const [sceneDragActive, setSceneDragActive] = useState(false);
	// Placed items the placement ghost snaps flush against (a fresh drop isn't
	// in the room yet, so every item is a neighbor).
	const placementObstacles = useMemo(
		() => room.furniture.map(furnitureObstacle),
		[room.furniture],
	);

	const selectItem = useCallback((id: string) => {
		setSelectedId(id);
		setSelectedOpeningId(null);
	}, []);
	const selectOpening = useCallback((id: string) => {
		setSelectedOpeningId(id);
		setSelectedId(null);
	}, []);

	const rotateItem = useCallback(
		// A 90° turn grows the footprint's hull along the wall it faced; contain
		// it so the spun item can't poke through (a duplicated copy likewise).
		(id: string) =>
			onRoomChange(
				containRoomFurniture(rotateFurniture(room, id, ROTATE_STEP_DEG), id),
			),
		[room, onRoomChange],
	);
	const moveItem = useCallback(
		(id: string, update: FurnitureUpdate) =>
			onRoomChange(updateFurniture(room, id, update)),
		[room, onRoomChange],
	);
	const duplicateItem = useCallback(
		(id: string) => {
			const newId = crypto.randomUUID();
			onRoomChange(
				containRoomFurniture(duplicateFurniture(room, id, newId), newId),
			);
			setSelectedId(newId);
		},
		[room, onRoomChange],
	);
	const deleteItem = useCallback(
		(id: string) => {
			onRoomChange(removeFurniture(room, id));
			setSelectedId(null);
		},
		[room, onRoomChange],
	);

	const insertOpening = useCallback(
		(kind: OpeningKind, wallIndex: number, offset: number, width: number) => {
			const opening: Opening = {
				id: crypto.randomUUID(),
				kind,
				wallIndex,
				offset,
				width,
			};
			if (kind === "door") opening.hinge = "start";
			onRoomChange(addOpening(room, opening));
			// Selection follows the insert (like a drop), ready to drag/adjust.
			selectOpening(opening.id);
			onOpeningToolDone();
		},
		[room, onRoomChange, selectOpening, onOpeningToolDone],
	);
	const moveOpeningTo = useCallback(
		(id: string, offset: number) => onRoomChange(moveOpening(room, id, offset)),
		[room, onRoomChange],
	);
	const flipHinge = useCallback(
		(id: string) => onRoomChange(flipDoorHinge(room, id)),
		[room, onRoomChange],
	);
	const deleteOpening = useCallback(
		(id: string) => {
			onRoomChange(removeOpening(room, id));
			setSelectedOpeningId(null);
		},
		[room, onRoomChange],
	);

	// A placement drag takes over the scene; a leftover selection chip would
	// sit between the pointer and the floor (its DOM would eat the drop).
	useEffect(() => {
		if (placingItem) setSelectedId(null);
	}, [placingItem]);
	// Arming a door/window tool likewise clears any selection — clicks now
	// mean "insert here", and a chip would sit over the wall pick strips.
	useEffect(() => {
		if (!openingTool) return;
		setSelectedId(null);
		setSelectedOpeningId(null);
	}, [openingTool]);

	const placeDraggedItem = useCallback(
		(center: Point) => {
			if (!placingItem) return;
			const id = crypto.randomUUID();
			onRoomChange(
				addFurniture(room, {
					id,
					catalogId: placingItem.id,
					position: center,
					rotation: 0,
					footprint: placingItem.footprint,
				}),
			);
			// Selection follows the drop, same as duplicate.
			setSelectedId(id);
			onPlacingEnd();
		},
		[placingItem, room, onRoomChange, onPlacingEnd],
	);
	const placeMountedItem = useCallback(
		(result: WallMountResult) => {
			if (!placingItem) return;
			const id = crypto.randomUUID();
			onRoomChange(
				addFurniture(room, {
					id,
					catalogId: placingItem.id,
					position: result.position,
					rotation: result.rotation,
					footprint: placingItem.footprint,
					mount: result.mount,
				}),
			);
			setSelectedId(id);
			onPlacingEnd();
		},
		[placingItem, room, onRoomChange, onPlacingEnd],
	);

	return (
		// isolate: drei <Html> overlays carry huge z-indexes; contain them so
		// the chrome around the workspace still paints on top.
		// cursor-none: the wall tool draws its own crosshair cursor; the length
		// pills restore their own pointer cursor.
		<div
			className={cn(
				"absolute inset-0 isolate",
				// The drawn crosshair replaces the OS cursor only while placing
				// corners — a closed draft is reshaped with the normal pointer.
				drawing &&
					renderPlan &&
					drawTool === "wall" &&
					!draftClosed &&
					"cursor-none",
				viewMode === "2d" && renderPlan && openingTool && "cursor-crosshair",
			)}
			onPointerDown={(event) => {
				pointerDownRef.current = { x: event.clientX, y: event.clientY };
			}}
		>
			<Canvas
				flat
				dpr={[1, 2]}
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
					room={room}
					planView={planView}
					renderPlan={renderPlan}
					onRenderPlanChange={setRenderPlan}
					locked={sceneDragActive}
					apiRef={cameraApiRef}
					readoutStore={readoutStore}
				/>
				{gridVisible && (
					<Grid
						infiniteGrid
						followCamera={false}
						cellSize={0.5}
						cellThickness={1}
						cellColor={GRID_MINOR_COLOR}
						sectionSize={2.5}
						sectionThickness={1.4}
						sectionColor={GRID_MAJOR_COLOR}
						// One value for both lenses: a per-lens fade would pop while the
						// transition camera is still ~40 m out at the top-down end.
						fadeDistance={130}
						fadeStrength={1}
					/>
				)}
				{renderPlan ? (
					drawing ? (
						<DrawScene
							corners={draftCorners}
							closed={draftClosed}
							unit={unit}
							snapEnabled={snapEnabled}
							placing={drawTool === "wall" && !draftClosed}
							onPlaceCorner={onPlaceCorner}
							onSetSegmentLength={onSetDraftSegmentLength}
							onRequestClose={onRequestCloseDraft}
							onMoveCorner={onMoveDraftCorner}
							onSplitWall={onSplitDraftWall}
							onDragActiveChange={setSceneDragActive}
						/>
					) : (
						<PlanScene
							room={room}
							selectedId={selectedId}
							selectedOpeningId={selectedOpeningId}
							openingTool={openingTool}
							unit={unit}
							snapEnabled={snapEnabled}
							onSelectItem={selectItem}
							onRotateItem={rotateItem}
							onDuplicateItem={duplicateItem}
							onDeleteItem={deleteItem}
							onMoveItem={moveItem}
							onMoveActiveChange={setSceneDragActive}
							onSelectOpening={selectOpening}
							onInsertOpening={insertOpening}
							onMoveOpening={moveOpeningTo}
							onFlipDoorHinge={flipHinge}
							onDeleteOpening={deleteOpening}
						/>
					)
				) : (
					<>
						<RoomScene
							room={room}
							selectedId={selectedId}
							unit={unit}
							snapEnabled={snapEnabled}
							onSelectItem={selectItem}
							onRotateItem={rotateItem}
							onDuplicateItem={duplicateItem}
							onDeleteItem={deleteItem}
							onMoveItem={moveItem}
							onMoveActiveChange={setSceneDragActive}
						/>
						{placingItem &&
							(isWallItem(placingItem.id) ? (
								<WallMountGhost
									outline={room.outline}
									item={placingItem}
									unit={unit}
									snapEnabled={snapEnabled}
									onPlace={placeMountedItem}
									onCancel={onPlacingEnd}
								/>
							) : (
								<PlacementGhost
									outline={room.outline}
									obstacles={placementObstacles}
									item={placingItem}
									unit={unit}
									snapEnabled={snapEnabled}
									onPlace={placeDraggedItem}
									onCancel={onPlacingEnd}
								/>
							))}
					</>
				)}
			</Canvas>
		</div>
	);
}
