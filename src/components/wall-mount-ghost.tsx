import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
	DoubleSide,
	MathUtils,
	Plane,
	Raycaster,
	Vector2,
	Vector3,
} from "three";
import { SnapGuides } from "#/components/snap-guides";
import {
	type CatalogItem,
	defaultMountElevation,
	type Point,
	wallFrames,
} from "#/lib/model";
import { mountAt, type WallMountResult } from "#/lib/mount-place";
import type { Unit } from "#/lib/units";

/**
 * The placement ghost for wall-mounted items (picture frames, clocks) — the
 * wall-item counterpart to `PlacementGhost`. It raycasts window pointermoves
 * onto the floor (the drag started on a DOM card, outside R3F's events),
 * finds the nearest wall via `mountAt`, and previews the item as a bright
 * standing rectangle hung on that wall at its mount elevation, with the same
 * distance-to-corner guide pills the opening tools use. Pointerup on the
 * canvas commits the mount; anywhere else the drag layer cancels.
 */

const GHOST_COLOR = "#3a5bf0";

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

export interface WallMountGhostProps {
	outline: Point[];
	item: CatalogItem;
	unit: Unit;
	/** Snap toggle: off means free slide along the wall (no quantize/guides). */
	snapEnabled: boolean;
	onPlace: (result: WallMountResult) => void;
	onCancel: () => void;
}

export function WallMountGhost({
	outline,
	item,
	unit,
	snapEnabled,
	onPlace,
	onCancel,
}: WallMountGhostProps) {
	const camera = useThree((state) => state.camera);
	const gl = useThree((state) => state.gl);
	const [result, setResult] = useState<WallMountResult | null>(null);
	const frames = useMemo(() => wallFrames(outline), [outline]);
	const elevation = defaultMountElevation(item.id);

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
		const resolve = (point: Point): WallMountResult | null =>
			mountAt(frames, point, item.footprint, elevation, snapEnabled);
		const handleMove = (event: PointerEvent) => {
			const point = toFloor(event);
			setResult(point ? resolve(point) : null);
		};
		const handleUp = (event: PointerEvent) => {
			// Off-canvas releases belong to the drag layer.
			if (!(event.target instanceof HTMLCanvasElement)) return;
			const point = toFloor(event);
			const placed = point ? resolve(point) : null;
			if (placed) onPlace(placed);
			else onCancel();
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [frames, item, elevation, snapEnabled, camera, gl, onPlace, onCancel]);

	if (!result) return null;
	const { width, height } = item.footprint;
	const hw = width / 2;
	// Face rectangle in the group's local frame: width along local x, height
	// vertical, centered at the mount elevation.
	const top = result.mount.elevation + height / 2;
	const bottom = result.mount.elevation - height / 2;
	const outlineLoop: [number, number, number][] = [
		[-hw, bottom, 0],
		[hw, bottom, 0],
		[hw, top, 0],
		[-hw, top, 0],
		[-hw, bottom, 0],
	];

	return (
		<group>
			<group
				position={[result.position.x, 0, result.position.y]}
				rotation-y={MathUtils.degToRad(result.rotation)}
			>
				<mesh position-y={result.mount.elevation}>
					<planeGeometry args={[width, height]} />
					<meshBasicMaterial
						color={GHOST_COLOR}
						transparent
						opacity={0.16}
						side={DoubleSide}
						depthWrite={false}
					/>
				</mesh>
				<Line
					points={outlineLoop}
					color={GHOST_COLOR}
					lineWidth={2.5}
					alphaToCoverage={false}
				/>
			</group>
			<SnapGuides guides={result.guides} unit={unit} />
		</group>
	);
}
