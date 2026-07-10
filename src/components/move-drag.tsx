import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { SnapGuides } from "#/components/snap-guides";
import type {
	FurnitureItem,
	FurnitureUpdate,
	Point,
	WallMount,
} from "#/lib/model";
import { wallFrames } from "#/lib/model";
import { mountAt } from "#/lib/mount-place";
import {
	type Obstacle,
	type PlacementGuide,
	rotatedFootprintSize,
	snapPlacement,
} from "#/lib/place";
import type { Unit } from "#/lib/units";

/**
 * Moving a placed item by pointer-drag, shared by both lenses: the 3D
 * dollhouse and the 2D plan arm a drag from a pointerdown on an
 * already-selected item, and the session reuses `snapPlacement`'s quantize /
 * outline clamp / wall-flush snap plus the wall-clearance guide pills.
 */

/**
 * A click whose pointer travelled further than this (px) was a camera drag
 * that happened to end on an item, not a pick.
 */
export const CLICK_SLOP_PX = 4;

/** The y=0 floor plane a move drag tracks the pointer across. */
export const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

/** A live move drag: which item, where it was grabbed, where it started. */
export interface MoveDrag {
	id: string;
	/** Grab offset from the item's center, plan coords — dragging keeps it. */
	grab: Point;
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
 * Project window pointer events onto the y=0 floor plane through `camera`.
 * Ignores the event target on purpose: mid-drag the pointer may cross a DOM
 * overlay (the selection chip) and tracking must not stall there.
 */
export function floorProjector(
	gl: { domElement: HTMLCanvasElement },
	camera: Camera,
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
		return raycaster.ray.intersectPlane(FLOOR_PLANE, hit)
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
			floorPoint: Point,
			screen: { x: number; y: number },
		) => {
			setDrag({
				id: item.id,
				grab: {
					x: floorPoint.x - item.position.x,
					y: floorPoint.y - item.position.y,
				},
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
 * plane, feeds `snapPlacement` (same quantize / clamp / wall-flush as the
 * placement ghost) into `onMove`, and renders the wall-clearance guides.
 * Pointerup commits wherever the item is; esc restores `drag.original`.
 */
export function MoveDragSession({
	outline,
	obstacles,
	drag,
	unit,
	snapEnabled,
	onMove,
	onEnd,
}: {
	outline: Point[];
	/** Other placed items to snap flush against (excludes the dragged one). */
	obstacles: Obstacle[];
	drag: MoveDrag;
	unit: Unit;
	/** Snap toggle: off means free move (contained, but no flush/quantize). */
	snapEnabled: boolean;
	/** Live update — a floor item patches its position; a wall item also its
	 * rotation and mount as it slides onto the nearest wall. */
	onMove: (update: FurnitureUpdate) => void;
	onEnd: () => void;
}) {
	const camera = useThree((state) => state.camera);
	const gl = useThree((state) => state.gl);
	const [guides, setGuides] = useState<PlacementGuide[]>([]);
	// Wall frames for a mounted drag; empty for a floor drag. Memoised on the
	// outline so the per-move room churn doesn't rebuild them.
	const frames = useMemo(
		() => (drag.mount ? wallFrames(outline) : []),
		[drag.mount, outline],
	);
	// Latest callbacks/obstacles without resubscribing the listeners mid-drag
	// (both close over the room, which changes on every move).
	const moveRef = useRef(onMove);
	moveRef.current = onMove;
	const endRef = useRef(onEnd);
	endRef.current = onEnd;
	const obstaclesRef = useRef(obstacles);
	obstaclesRef.current = obstacles;
	const snapRef = useRef(snapEnabled);
	snapRef.current = snapEnabled;
	const framesRef = useRef(frames);
	framesRef.current = frames;

	useEffect(() => {
		const toFloor = floorProjector(gl, camera);
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
			const target = {
				x: point.x - drag.grab.x,
				y: point.y - drag.grab.y,
			};
			if (drag.mount) {
				// Wall item: re-mount to the nearest wall that fits it. When no
				// wall does, hold the item still rather than dropping it.
				const result = mountAt(
					framesRef.current,
					target,
					drag.mount.footprint,
					drag.mount.elevation,
					snapRef.current,
				);
				if (!result) return;
				moveRef.current({
					position: result.position,
					rotation: result.rotation,
					mount: result.mount,
				});
				setGuides(result.guides);
				return;
			}
			const snap = snapPlacement(
				outline,
				drag.size,
				target,
				obstaclesRef.current,
				undefined,
				undefined,
				snapRef.current,
			);
			moveRef.current({ position: snap.center });
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
					: { position: drag.original },
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
	}, [outline, drag, camera, gl]);

	return <SnapGuides guides={guides} unit={unit} />;
}
