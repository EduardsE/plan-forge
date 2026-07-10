import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import type { OrthographicCamera as ThreeOrthographicCamera } from "three";
import { type DraftSnap, snapDraftPoint } from "#/lib/draw";
import type { Point } from "#/lib/model";
import { dashedPolyline } from "#/lib/plan-scene";
import {
	formatLength,
	formatLengthValue,
	parseLength,
	type Unit,
} from "#/lib/units";

/**
 * The draw-mode scene (mockup screen 1c): click the grid plane to place
 * outline corners. Committed segments render as navy bars with white length
 * pills (click one to type an exact length); the preview segment to the
 * cursor is dashed cyan with a live label, axis snapping shows the 90° badge
 * and corner-alignment snaps show a dashed guide + chip. Geometry lives in
 * `src/lib/draw.ts`; every color/proportion is lifted from the mockup.
 *
 * Labels are drei `<Html>` overlays like the plan lens, so they stay crisp
 * and the length input is a real DOM input.
 */

const WALL_COLOR = "#16213e";
const SNAP_COLOR = "#22d3ee";
/** Snap radius in screen px, converted per-event to meters via camera zoom. */
const SNAP_TOLERANCE_PX = 12;
/** Clicking this close (px) to the start corner closes the outline instead. */
const CLOSE_TOLERANCE_PX = 14;
/** Clicks that travelled further than this (px) were pans, not placements. */
const CLICK_SLOP_PX = 4;
/** Ignore clicks that would stack a corner onto the previous one (meters). */
const MIN_SEGMENT = 0.01;
/** Side length of the right-angle marker at the snapped corner (meters). */
const ANGLE_MARKER_SIZE = 0.22;
/** Perpendicular offset from a segment to its length label (meters). */
const LABEL_OFFSET = 0.4;

/** Stacked heights above the ground grid, same trick as the plan lens. */
const GUIDE_Y = 0.012;
const WALL_Y = 0.014;
const PREVIEW_Y = 0.016;
const LABEL_Y = 0.02;

/** Plan point → world vector on the floor plane (world z = plan y). */
function v3(p: Point, y: number): [number, number, number] {
	return [p.x, y, p.y];
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function centroidOf(points: Point[]): Point {
	if (points.length === 0) return { x: 0, y: 0 };
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
	}
	return { x: x / points.length, y: y / points.length };
}

/**
 * Unit perpendicular of a→b pointing away from the draft centroid, so
 * length labels sit outside the shape being drawn (mockup: every label is
 * on the outward side). Falls back to "up" (-y) for degenerate cases.
 */
function outwardPerp(a: Point, b: Point, centroid: Point): Point {
	const len = distance(a, b);
	if (len === 0) return { x: 0, y: -1 };
	let px = -(b.y - a.y) / len;
	let py = (b.x - a.x) / len;
	const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	const dot = (mid.x - centroid.x) * px + (mid.y - centroid.y) * py;
	if (dot < 0) {
		px = -px;
		py = -py;
	}
	return { x: px, y: py };
}

function labelPosition(a: Point, b: Point, centroid: Point): Point {
	const perp = outwardPerp(a, b, centroid);
	return {
		x: (a.x + b.x) / 2 + perp.x * LABEL_OFFSET,
		y: (a.y + b.y) / 2 + perp.y * LABEL_OFFSET,
	};
}

/** White length pill of a committed segment; click to edit, or the inline
 * input while editing (mockup: "2.80|m" with the cyan focus ring). */
function SegmentLabel({
	a,
	b,
	unit,
	editing,
	onBeginEdit,
	onCommit,
	onCancel,
	centroid,
}: {
	a: Point;
	b: Point;
	unit: Unit;
	editing: boolean;
	onBeginEdit: () => void;
	onCommit: (meters: number) => void;
	onCancel: () => void;
	centroid: Point;
}) {
	const length = distance(a, b);
	const at = labelPosition(a, b, centroid);
	const commitInput = (value: string) => {
		const meters = parseLength(value, unit);
		if (meters === null) onCancel();
		else onCommit(meters);
	};
	return (
		<Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
			{editing ? (
				<div className="pointer-events-auto flex items-center gap-1 rounded-lg border-2 border-[#22D3EE] bg-white px-2 py-[3px] shadow-[0_0_0_4px_rgba(34,211,238,0.15),0_6px_16px_rgba(15,27,61,0.10)]">
					<input
						// biome-ignore lint/a11y/noAutofocus: the input replaces the label the user just clicked
						autoFocus
						defaultValue={formatLengthValue(length, unit)}
						onFocus={(event) => event.currentTarget.select()}
						onBlur={(event) => commitInput(event.currentTarget.value)}
						onKeyDown={(event) => {
							// Keep Enter/Esc away from the route's close/cancel keys.
							event.stopPropagation();
							if (event.key === "Enter") {
								commitInput(event.currentTarget.value);
							} else if (event.key === "Escape") {
								onCancel();
							}
						}}
						className="w-[52px] bg-transparent text-right font-mono text-[13.5px] text-[#0F1B3D] outline-none"
					/>
					<span className="font-mono text-[13.5px] text-[#9AA9C7]">{unit}</span>
				</div>
			) : (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onBeginEdit();
					}}
					className="pointer-events-auto cursor-pointer whitespace-nowrap rounded-lg border border-[rgba(15,27,61,0.12)] bg-white px-[11px] py-[3px] font-mono text-[13.5px] text-[#33415C] shadow-[0_6px_16px_rgba(15,27,61,0.08)]"
				>
					{formatLength(length, unit)}
				</button>
			)}
		</Html>
	);
}

/** The dashed alignment guide from a matched earlier corner to the cursor,
 * with the "snap · aligned with start" chip beside its midpoint. */
function AlignmentGuide({
	from,
	to,
	startAligned,
}: {
	from: Point;
	to: Point;
	startAligned: boolean;
}) {
	const dashes = useMemo(
		() => dashedPolyline([from, to], 0.14, 0.1),
		[from, to],
	);
	if (dashes.length === 0) return null;
	const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
	return (
		<group>
			<Line
				segments
				points={dashes.map((p) => v3(p, GUIDE_Y))}
				color={SNAP_COLOR}
				lineWidth={2.5}
				transparent
				opacity={0.6}
				alphaToCoverage={false}
			/>
			<Html
				position={[mid.x, LABEL_Y, mid.y]}
				style={{ pointerEvents: "none", transform: "translateY(-50%)" }}
			>
				<div className="ml-3 whitespace-nowrap rounded-lg border-[1.5px] border-dashed border-[rgba(34,211,238,0.7)] bg-[rgba(34,211,238,0.10)] px-[11px] py-1 font-mono text-[12px] text-[#0F766E]">
					{startAligned ? "snap · aligned with start" : "snap · aligned"}
				</div>
			</Html>
		</group>
	);
}

/** Right-angle marker + "90°" badge in the wedge at the last corner. */
function AngleBadge({
	prev,
	corner,
	next,
	angleDeg,
}: {
	prev: Point;
	corner: Point;
	next: Point;
	angleDeg: number;
}) {
	const s = ANGLE_MARKER_SIZE;
	const backLen = distance(corner, prev);
	const outLen = distance(corner, next);
	if (backLen === 0 || outLen === 0) return null;
	const back = {
		x: ((prev.x - corner.x) / backLen) * s,
		y: ((prev.y - corner.y) / backLen) * s,
	};
	const out = {
		x: ((next.x - corner.x) / outLen) * s,
		y: ((next.y - corner.y) / outLen) * s,
	};
	const marker: Point[] = [
		{ x: corner.x + back.x, y: corner.y + back.y },
		{ x: corner.x + back.x + out.x, y: corner.y + back.y + out.y },
		{ x: corner.x + out.x, y: corner.y + out.y },
	];
	const badgeAt = {
		x: corner.x + (back.x + out.x) * 1.9,
		y: corner.y + (back.y + out.y) * 1.9,
	};
	return (
		<group>
			<Line
				points={marker.map((p) => v3(p, PREVIEW_Y))}
				color={SNAP_COLOR}
				lineWidth={2}
				alphaToCoverage={false}
			/>
			<Html
				position={v3(badgeAt, LABEL_Y)}
				center
				style={{ pointerEvents: "none" }}
			>
				<span className="whitespace-nowrap rounded-md border border-[rgba(34,211,238,0.6)] bg-white px-2 py-[2px] font-mono text-[11.5px] text-[#0F766E]">
					{angleDeg}°
				</span>
			</Html>
		</group>
	);
}

/** Corner dot; the start corner carries the cyan glow (mockup screen 1c). */
function CornerDot({ at, isStart }: { at: Point; isStart: boolean }) {
	return (
		<Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
			<div
				className="h-4 w-4 rounded-full border-[3px] border-[#16213E] bg-white"
				style={{
					boxShadow: isStart
						? "0 0 0 6px rgba(34,211,238,0.25), 0 0 16px rgba(34,211,238,0.5)"
						: "0 2px 6px rgba(15,27,61,0.25)",
				}}
			/>
		</Html>
	);
}

/** The drawn crosshair cursor: cyan dot + thin hairlines (the OS cursor is
 * hidden over the canvas while the wall tool is active). */
function DrawCursor({ at }: { at: Point }) {
	return (
		<Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
			<div className="relative">
				<div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-[60px] w-[1.5px] bg-[rgba(34,211,238,0.7)]" />
				<div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-[1.5px] w-[60px] bg-[rgba(34,211,238,0.7)]" />
				<div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-[#22D3EE] shadow-[0_0_0_5px_rgba(34,211,238,0.25),0_0_18px_rgba(34,211,238,0.7)]" />
			</div>
		</Html>
	);
}

export interface DrawSceneProps {
	corners: Point[];
	unit: Unit;
	/** Wall tool active: pointer places corners and shows the crosshair. */
	placing: boolean;
	onPlaceCorner: (point: Point) => void;
	onSetSegmentLength: (segmentIndex: number, meters: number) => void;
	/** Requested by clicking back on the start corner (≥ 3 corners placed). */
	onRequestClose: () => void;
}

export function DrawScene({
	corners,
	unit,
	placing,
	onPlaceCorner,
	onSetSegmentLength,
	onRequestClose,
}: DrawSceneProps) {
	const [snap, setSnap] = useState<DraftSnap | null>(null);
	const [editingSegment, setEditingSegment] = useState<number | null>(null);

	const centroid = useMemo(() => centroidOf(corners), [corners]);
	const last = corners.at(-1);
	const preview = placing && last && snap ? snap : null;
	const previewDashes = useMemo(
		() =>
			preview && last ? dashedPolyline([last, preview.point], 0.12, 0.08) : [],
		[preview, last],
	);

	/** Snap tolerance in meters at the event camera's current zoom. */
	const toleranceOf = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
		const zoom = (event.camera as ThreeOrthographicCamera).zoom || 80;
		return SNAP_TOLERANCE_PX / zoom;
	};

	const handleMove = (event: ThreeEvent<PointerEvent>) => {
		if (!placing) return;
		const cursor = { x: event.point.x, y: event.point.z };
		setSnap(snapDraftPoint(corners, cursor, toleranceOf(event)));
	};

	const handleClick = (event: ThreeEvent<MouseEvent>) => {
		if (!placing) return;
		// Clicks on DOM overlays (length pills) also raycast through to this
		// plane; only true canvas clicks may place corners.
		if (!(event.nativeEvent.target instanceof HTMLCanvasElement)) return;
		if (event.delta > CLICK_SLOP_PX) return;
		const tolerance = toleranceOf(event);
		const { point } = snapDraftPoint(
			corners,
			{ x: event.point.x, y: event.point.z },
			tolerance,
		);
		if (corners.length >= 3) {
			const closeTolerance =
				CLOSE_TOLERANCE_PX /
				((event.camera as ThreeOrthographicCamera).zoom || 80);
			if (distance(point, corners[0]) < closeTolerance) {
				onRequestClose();
				return;
			}
		}
		if (last && distance(point, last) < MIN_SEGMENT) return;
		onPlaceCorner(point);
	};

	return (
		<group>
			{/* Invisible pick plane: the "grid plane" the task says to click. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
			<mesh
				rotation-x={-Math.PI / 2}
				position-y={0.001}
				onPointerMove={handleMove}
				onPointerOut={() => setSnap(null)}
				onClick={handleClick}
			>
				<planeGeometry args={[1000, 1000]} />
				<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			</mesh>

			{corners.length >= 2 && (
				<Line
					points={corners.map((p) => v3(p, WALL_Y))}
					color={WALL_COLOR}
					lineWidth={7}
					alphaToCoverage={false}
				/>
			)}

			{corners.slice(0, -1).map((corner, index) => (
				<SegmentLabel
					// biome-ignore lint/suspicious/noArrayIndexKey: segments are identified by position in the draft
					key={index}
					a={corner}
					b={corners[index + 1]}
					unit={unit}
					centroid={centroid}
					editing={editingSegment === index}
					onBeginEdit={() => setEditingSegment(index)}
					onCommit={(meters) => {
						onSetSegmentLength(index, meters);
						setEditingSegment(null);
					}}
					onCancel={() => setEditingSegment(null)}
				/>
			))}

			{preview && last && distance(last, preview.point) > MIN_SEGMENT && (
				<group>
					<Line
						segments
						points={previewDashes.map((p) => v3(p, PREVIEW_Y))}
						color={SNAP_COLOR}
						lineWidth={3.5}
						alphaToCoverage={false}
					/>
					<Html
						position={v3(labelPosition(last, preview.point, centroid), LABEL_Y)}
						center
						style={{ pointerEvents: "none" }}
					>
						<span className="whitespace-nowrap rounded-lg border-[1.5px] border-[#22D3EE] bg-[rgba(34,211,238,0.10)] px-[11px] py-[3px] font-mono text-[13.5px] text-[#0F766E]">
							{formatLength(distance(last, preview.point), unit)}
						</span>
					</Html>
				</group>
			)}

			{preview?.alignment && (
				<AlignmentGuide
					from={corners[preview.alignment.cornerIndex]}
					to={preview.point}
					startAligned={preview.alignment.cornerIndex === 0}
				/>
			)}

			{preview?.turnAngleDeg === 90 && last && corners.length >= 2 && (
				<AngleBadge
					prev={corners[corners.length - 2]}
					corner={last}
					next={preview.point}
					angleDeg={90}
				/>
			)}

			{corners.map((corner, index) => (
				<CornerDot
					// biome-ignore lint/suspicious/noArrayIndexKey: corners are identified by position in the draft
					key={index}
					at={corner}
					isStart={index === 0}
				/>
			))}

			{placing && snap && <DrawCursor at={snap.point} />}
		</group>
	);
}
