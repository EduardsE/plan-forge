import {
	Grid,
	OrbitControls,
	OrthographicCamera,
	PerspectiveCamera,
} from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
	type ComponentRef,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import {
	MathUtils,
	Shape,
	Spherical,
	type OrthographicCamera as ThreeOrthographicCamera,
	type PerspectiveCamera as ThreePerspectiveCamera,
	Vector3,
} from "three";
import {
	type CameraApi,
	type CameraReadoutStore,
	perspectiveFitDistance,
	planFitZoom,
} from "#/lib/camera";
import { outlineBounds, type Point, type Room } from "#/lib/model";
import type { ViewMode } from "#/lib/view-mode";

/**
 * The R3F workspace canvas: one scene for both lenses, switched by camera.
 * 3D (and objects) mode orbits a perspective camera; 2D and draw mode look
 * straight down through an orthographic one. The floating toolbar drives the
 * rig through `CameraApi` and the readout chip listens on the readout store.
 *
 * Scene content is still skeletal — an in-scene ground grid plus a flat
 * floor slab from the model. The 3D/2D lens tasks build the real room here.
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

/** --room-floor. */
const FLOOR_COLOR = "#e6dbc6";
/**
 * The CSS grid tokens are alpha layers over the canvas color; WebGL wants
 * opaque line colors, so these are --canvas-grid-minor / -major pre-blended
 * onto --canvas (#f3f6fa).
 */
const GRID_MINOR_COLOR = "#e9eff7";
const GRID_MAJOR_COLOR = "#dfe8f4";

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

interface CameraRigProps {
	room: Room;
	planView: boolean;
	apiRef: RefObject<CameraApi | null>;
	readoutStore: CameraReadoutStore;
}

function CameraRig({ room, planView, apiRef, readoutStore }: CameraRigProps) {
	const size = useThree((state) => state.size);
	const controlsRef = useRef<OrbitControlsRef | null>(null);
	const perspectiveRef = useRef<ThreePerspectiveCamera | null>(null);
	const orthoRef = useRef<ThreeOrthographicCamera | null>(null);
	/** Perspective fit distance; "zoom 1.0×" in the readout means this far. */
	const fitDistanceRef = useRef(1);

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

	const publish = useCallback(() => {
		if (planView) {
			const camera = orthoRef.current;
			if (camera) {
				readoutStore.publish({ kind: "plan", pxPerMeter: camera.zoom });
			}
			return;
		}
		const camera = perspectiveRef.current;
		if (!camera) return;
		const target = controlsRef.current?.target ?? center;
		const offset = camera.position.clone().sub(target);
		const spherical = new Spherical().setFromVector3(offset);
		readoutStore.publish({
			kind: "orbit",
			azimuthDeg: MathUtils.radToDeg(spherical.theta),
			polarDeg: MathUtils.radToDeg(spherical.phi),
			zoom: fitDistanceRef.current / spherical.radius,
		});
	}, [planView, center, readoutStore]);

	const fitPerspective = useCallback(() => {
		const camera = perspectiveRef.current;
		if (!camera || size.height === 0) return;
		const distance = perspectiveFitDistance(
			fitRadius,
			FOV_DEG,
			size.width / size.height,
		);
		fitDistanceRef.current = distance;
		const target = controlsRef.current?.target ?? center;
		const spherical = new Spherical().setFromVector3(
			camera.position.clone().sub(target),
		);
		spherical.radius = distance;
		camera.position.setFromSpherical(spherical).add(target);
		camera.lookAt(target);
	}, [fitRadius, size, center]);

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
		controlsRef.current?.target.copy(center);
		if (planView) {
			fitOrtho();
		} else {
			fitPerspective();
		}
		controlsRef.current?.update();
		publish();
	}, [planView, center, fitOrtho, fitPerspective, publish]);

	const applyZoom = useCallback(
		(factor: number) => {
			if (planView) {
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
				const target = controlsRef.current?.target ?? center;
				const offset = camera.position.clone().sub(target);
				offset.setLength(
					MathUtils.clamp(
						offset.length() / factor,
						PERSPECTIVE_MIN_DISTANCE,
						PERSPECTIVE_MAX_DISTANCE,
					),
				);
				camera.position.copy(target).add(offset);
			}
			controlsRef.current?.update();
			publish();
		},
		[planView, center, publish],
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

	// Refresh the readout when the lens flips (publish identity tracks planView).
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
				makeDefault={!planView}
				fov={FOV_DEG}
				near={0.1}
				far={200}
				position={initialPerspectivePosition}
			/>
			<OrthographicCamera
				ref={orthoRef}
				makeDefault={planView}
				near={0.1}
				far={100}
				up={[0, 0, -1]}
				position={[center.x, PLAN_CAMERA_HEIGHT, center.z]}
				zoom={80}
			/>
			<OrbitControls
				key={planView ? "plan" : "orbit"}
				ref={controlsRef}
				target={[center.x, 0, center.z]}
				enableRotate={!planView}
				minDistance={PERSPECTIVE_MIN_DISTANCE}
				maxDistance={PERSPECTIVE_MAX_DISTANCE}
				minZoom={PLAN_MIN_ZOOM}
				maxZoom={PLAN_MAX_ZOOM}
				// Keep the orbit above the floor; the plan camera's straight-down
				// pose reads as polar 90° in the controls' up-relative frame, so it
				// must stay unclamped there.
				maxPolarAngle={planView ? Math.PI : Math.PI / 2 - 0.06}
				onChange={publish}
			/>
		</>
	);
}

/**
 * Interim scene content: a flat slab of the room outline so the cameras have
 * something to frame. The 3D lens task replaces this with real floor + walls.
 */
function FloorSlab({ outline }: { outline: Point[] }) {
	const shape = useMemo(() => {
		const s = new Shape();
		// Plan coordinates are y-down; Shape lives in y-up XY, so mirror y and
		// lay the mesh flat with rotation so plan (x, y) lands on world (x, 0, y).
		for (const [i, point] of outline.entries()) {
			if (i === 0) s.moveTo(point.x, -point.y);
			else s.lineTo(point.x, -point.y);
		}
		s.closePath();
		return s;
	}, [outline]);

	if (outline.length < 3) return null;
	return (
		<mesh rotation-x={-Math.PI / 2} position-y={0.001}>
			<shapeGeometry args={[shape]} />
			<meshBasicMaterial color={FLOOR_COLOR} />
		</mesh>
	);
}

export interface PlannerCanvasProps {
	room: Room;
	viewMode: ViewMode;
	cameraApiRef: RefObject<CameraApi | null>;
	readoutStore: CameraReadoutStore;
}

export function PlannerCanvas({
	room,
	viewMode,
	cameraApiRef,
	readoutStore,
}: PlannerCanvasProps) {
	// Same lens split as the 2D|3D pill: draw is a top-down 2D flow, the
	// objects catalog drops onto the 3D dollhouse.
	const planView = viewMode === "2d" || viewMode === "draw";

	return (
		<div className="absolute inset-0">
			<Canvas flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
				<CameraRig
					room={room}
					planView={planView}
					apiRef={cameraApiRef}
					readoutStore={readoutStore}
				/>
				<Grid
					infiniteGrid
					followCamera={false}
					cellSize={0.5}
					cellThickness={1}
					cellColor={GRID_MINOR_COLOR}
					sectionSize={2.5}
					sectionThickness={1.4}
					sectionColor={GRID_MAJOR_COLOR}
					fadeDistance={planView ? 400 : 55}
					fadeStrength={1}
				/>
				<FloorSlab outline={room.outline} />
			</Canvas>
		</div>
	);
}
