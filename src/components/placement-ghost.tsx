import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Plane, Raycaster, Shape, Vector2, Vector3 } from "three";
import { SnapGuides } from "#/components/snap-guides";
import type { CatalogItem, Point } from "#/lib/model";
import { type Obstacle, type PlacementSnap, snapPlacement } from "#/lib/place";
import { dashedPolyline, roundedRectPoints } from "#/lib/plan-scene";
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

const GHOST_COLOR = "#22d3ee";
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

export interface PlacementGhostProps {
	outline: Point[];
	/** Placed items the ghost snaps flush against, alongside the walls. */
	obstacles: Obstacle[];
	item: CatalogItem;
	unit: Unit;
	onPlace: (center: Point) => void;
	onCancel: () => void;
}

export function PlacementGhost({
	outline,
	obstacles,
	item,
	unit,
	onPlace,
	onCancel,
}: PlacementGhostProps) {
	const camera = useThree((state) => state.camera);
	const gl = useThree((state) => state.gl);
	const [snap, setSnap] = useState<PlacementSnap | null>(null);

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
		const handleMove = (event: PointerEvent) => {
			const point = toFloor(event);
			setSnap(
				point ? snapPlacement(outline, item.footprint, point, obstacles) : null,
			);
		};
		const handleUp = (event: PointerEvent) => {
			// Off-canvas releases belong to the drag layer.
			if (!(event.target instanceof HTMLCanvasElement)) return;
			const point = toFloor(event);
			if (point)
				onPlace(
					snapPlacement(outline, item.footprint, point, obstacles).center,
				);
			else onCancel();
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [outline, obstacles, item, camera, gl, onPlace, onCancel]);

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

	return (
		<group>
			<group position={[center.x, 0, center.y]}>
				{/* Floor footprint: translucent fill + bright dashed outline. */}
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
			<SnapGuides guides={snap.guides} unit={unit} />
		</group>
	);
}
