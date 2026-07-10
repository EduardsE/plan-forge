import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import {
	CanvasTexture,
	MathUtils,
	RepeatWrapping,
	Shape,
	ShapeGeometry,
	SRGBColorSpace,
} from "three";
import type { FurnitureItem, Point, Room } from "#/lib/model";
import { floorArea, outlineBounds } from "#/lib/model";
import {
	circlePoints,
	dashedPolyline,
	doorSwing,
	roundedRectPoints,
	solidSpans,
	wallPoint,
	wallSpanRect,
} from "#/lib/plan-scene";
import {
	buildWallSolids,
	cornerPosts,
	WALL_THICKNESS,
	type WallHole,
	type WallSolid,
} from "#/lib/room-scene";

/**
 * The 2D plan lens (mockup screen 1b): the same room model presented as an
 * architectural drawing — navy wall fills, window/door symbols, tinted
 * furniture footprints — with DOM (`<Html>`) overlays for labels, external
 * dimension lines and the room area card, so text stays crisp at any zoom.
 * Every color and proportion is lifted from `design/planforge-mockups.html`.
 *
 * Every stroke disables the line material's alpha-to-coverage: with it on,
 * some GPUs resolve a line's coverage-discarded fragments as opaque
 * background over the whole expanded quad (seen here as a white rectangle
 * swallowing the ground grid around the door arc). Dashes are pre-chopped
 * into explicit segments (`dashedPolyline`) instead of using the dashed
 * material, which misrendered the same way.
 */

const WALL_COLOR = "#16213e";
const FLOOR_COLOR = "#fcfdff";
/** Mockup interior grid rgba(48,106,190,.09), pre-blended onto the floor. */
const FLOOR_GRID_COLOR = "#eaf0f9";
const FLOOR_GRID_CELL = 0.5;
const SYMBOL_COLOR = "#33415c";
const DOOR_ARC_COLOR = "#8fa3c8";
const DIMENSION_COLOR = "#7e93be";
/** Distance from the outer wall face to a dimension line. */
const DIMENSION_GAP = 0.4;
/** Half-length of a dimension line's end tick (mockup: 14 px). */
const DIMENSION_TICK = 0.065;

/** Stacked heights above the ground grid; the plan is only ever seen from
 * straight above, so tiny offsets are all the layering needed. */
const SHADOW_Y = 0.002;
const FLOOR_Y = 0.004;
const WALL_Y = 0.006;
const OPENING_Y = 0.008;
const RUG_FILL_Y = 0.009;
const FILL_Y = 0.01;
const RUG_LINE_Y = 0.013;
const LINE_Y = 0.014;

interface FootprintStyle {
	label: string;
	fill: string;
	fillOpacity: number;
	/** Corner radius, uniform or CSS-order [tl, tr, br, bl]. */
	radius: number | [number, number, number, number];
	dashed?: boolean;
}

/** Plan styling per catalog item, straight from mockup screen 1b. */
const FOOTPRINT_STYLES: Record<string, FootprintStyle> = {
	desk: { label: "DESK", fill: "#b98a5f", fillOpacity: 0.16, radius: 0.055 },
	"desk-chair": {
		label: "CHAIR",
		fill: "#ce7b52",
		fillOpacity: 0.18,
		radius: [0.13, 0.13, 0.055, 0.055],
	},
	credenza: {
		label: "CABINET",
		fill: "#a9805a",
		fillOpacity: 0.18,
		radius: 0.036,
	},
	shelf: { label: "SHELF", fill: "#a9805a", fillOpacity: 0.18, radius: 0.036 },
	rug: {
		label: "RUG",
		fill: "#c9805f",
		fillOpacity: 0.08,
		radius: 0.09,
		dashed: true,
	},
};
const FOOTPRINT_FALLBACK: FootprintStyle = {
	label: "",
	fill: "#a9805a",
	fillOpacity: 0.18,
	radius: 0.04,
};
const PLANT_FILL = "#4f7d46";

const LABEL_CLASS =
	"whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#475569]";
const FAINT_LABEL_CLASS =
	"whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#8a97b1]";

/** Plan point → world vector on the floor plane (world z = plan y). */
function v3(p: Point, y: number): [number, number, number] {
	return [p.x, y, p.y];
}

/** Plan-coordinate polygon as a three Shape (mirrored so world z = plan y
 * after the standard `rotation-x={-Math.PI / 2}`). */
function shapeFromPoints(points: Point[]): Shape {
	const shape = new Shape();
	for (const [i, p] of points.entries()) {
		if (i === 0) shape.moveTo(p.x, -p.y);
		else shape.lineTo(p.x, -p.y);
	}
	shape.closePath();
	return shape;
}

/** A mesh lying flat on the floor built from plan-coordinate shapes. */
function FlatShape({
	shapes,
	y,
	color,
	opacity = 1,
}: {
	shapes: Shape | Shape[];
	y: number;
	color: string;
	opacity?: number;
}) {
	const geometry = useMemo(() => new ShapeGeometry(shapes), [shapes]);
	return (
		<mesh geometry={geometry} rotation-x={-Math.PI / 2} position-y={y}>
			<meshBasicMaterial
				color={color}
				transparent={opacity < 1}
				opacity={opacity}
				depthWrite={opacity >= 1}
			/>
		</mesh>
	);
}

/** Interior floor grid, one 0.5 m cell (module-cached; client-only file). */
let floorTextureCache: CanvasTexture | null = null;
function floorTexture(): CanvasTexture {
	if (floorTextureCache) return floorTextureCache;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d canvas context unavailable");
	ctx.fillStyle = FLOOR_COLOR;
	ctx.fillRect(0, 0, 128, 128);
	ctx.fillStyle = FLOOR_GRID_COLOR;
	ctx.fillRect(0, 0, 128, 2);
	ctx.fillRect(0, 0, 2, 128);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	// ShapeGeometry UVs are plan meters; one tile per grid cell.
	texture.repeat.set(1 / FLOOR_GRID_CELL, 1 / FLOOR_GRID_CELL);
	floorTextureCache = texture;
	return texture;
}

/** Soft drop shadow under the whole plan (mockup: large blurred box-shadow),
 * baked into a texture so it hugs the plan's shape instead of ringing it the
 * way a radial blob would. The outline path is filled and stroked with a
 * round join twice the wall thickness — a polygon dilation — so the shadow
 * follows non-rectangular (L-shaped) rooms instead of boxing their bounds. */
const SHADOW_MARGIN = 1;
const SHADOW_SCALE = 48;
function PlanShadow({
	outline,
	min,
	max,
}: {
	outline: Point[];
	min: Point;
	max: Point;
}) {
	const width = max.x - min.x + 2 * WALL_THICKNESS;
	const height = max.y - min.y + 2 * WALL_THICKNESS;
	const texture = useMemo(() => {
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil((width + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
		canvas.height = Math.ceil((height + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2d canvas context unavailable");
		ctx.filter = `blur(${0.35 * SHADOW_SCALE}px)`;
		ctx.fillStyle = "#0f1b3d";
		ctx.strokeStyle = "#0f1b3d";
		ctx.lineWidth = 2 * WALL_THICKNESS * SHADOW_SCALE;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (const [i, p] of outline.entries()) {
			const x = (p.x - min.x + WALL_THICKNESS + SHADOW_MARGIN) * SHADOW_SCALE;
			// Shadow falls slightly downward, like the mockup's 0 34px 90px.
			const y =
				(p.y - min.y + WALL_THICKNESS + SHADOW_MARGIN + 0.2) * SHADOW_SCALE;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		return new CanvasTexture(canvas);
	}, [outline, width, height, min.x, min.y]);
	return (
		<mesh
			rotation-x={-Math.PI / 2}
			position={[(min.x + max.x) / 2, SHADOW_Y, (min.y + max.y) / 2]}
		>
			<planeGeometry
				args={[width + 2 * SHADOW_MARGIN, height + 2 * SHADOW_MARGIN]}
			/>
			<meshBasicMaterial
				map={texture}
				transparent
				opacity={0.3}
				depthWrite={false}
			/>
		</mesh>
	);
}

/** Window symbol: white break in the wall crossed by three parallel lines. */
function WindowSymbol({ solid, hole }: { solid: WallSolid; hole: WallHole }) {
	const inset = 0.02;
	const lines: Array<{ offset: number; width: number }> = [
		{ offset: inset, width: 3 },
		{ offset: WALL_THICKNESS / 2, width: 2 },
		{ offset: WALL_THICKNESS - inset, width: 3 },
	];
	return (
		<group>
			{lines.map(({ offset, width }) => (
				<Line
					key={offset}
					points={[
						v3(wallPoint(solid, hole.start, offset), LINE_Y),
						v3(wallPoint(solid, hole.start + hole.width, offset), LINE_Y),
					]}
					color={WALL_COLOR}
					lineWidth={width}
					alphaToCoverage={false}
				/>
			))}
		</group>
	);
}

/** Door symbol: open leaf plus the dashed quarter-circle swing arc. */
function DoorSymbol({ solid, hole }: { solid: WallSolid; hole: WallHole }) {
	const swing = useMemo(() => doorSwing(solid, hole), [solid, hole]);
	const arcDashes = useMemo(
		() => dashedPolyline(swing.arc, 0.09, 0.06),
		[swing],
	);
	return (
		<group>
			<Line
				points={[v3(swing.hinge, LINE_Y), v3(swing.leafEnd, LINE_Y)]}
				color={SYMBOL_COLOR}
				lineWidth={3}
				alphaToCoverage={false}
			/>
			<Line
				segments
				points={arcDashes.map((p) => v3(p, LINE_Y))}
				color={DOOR_ARC_COLOR}
				lineWidth={2.5}
				alphaToCoverage={false}
			/>
		</group>
	);
}

/** One wall's openings: the white break in the navy fill, then the symbol. */
function WallOpenings({ solid }: { solid: WallSolid }) {
	const breakShapes = useMemo(
		() =>
			solid.holes.map((hole) =>
				shapeFromPoints(
					wallSpanRect(
						solid,
						{ start: hole.start, end: hole.start + hole.width },
						WALL_THICKNESS,
					),
				),
			),
		[solid],
	);
	if (solid.holes.length === 0) return null;
	return (
		<group>
			<FlatShape shapes={breakShapes} y={OPENING_Y} color={FLOOR_COLOR} />
			{solid.holes.map((hole) =>
				hole.kind === "window" ? (
					<WindowSymbol key={hole.start} solid={solid} hole={hole} />
				) : (
					<DoorSymbol key={hole.start} solid={solid} hole={hole} />
				),
			)}
		</group>
	);
}

/** True when the item's long axis runs vertically on the plan, so its label
 * should read top-to-bottom (mockup: CABINET, SHELF). */
function labelReadsVertically(item: FurnitureItem): boolean {
	const quarterTurned = Math.round(item.rotation / 90) % 2 !== 0;
	const { width, depth } = item.footprint;
	return quarterTurned ? width > depth : depth > width;
}

function PlantFootprint({ item }: { item: FurnitureItem }) {
	const radius = item.footprint.width / 2;
	const outline = useMemo(() => circlePoints(radius), [radius]);
	const shape = useMemo(() => shapeFromPoints(outline), [outline]);
	const cross = 0.66 * radius * Math.SQRT1_2;
	return (
		<group position={[item.position.x, 0, item.position.y]}>
			<FlatShape shapes={shape} y={FILL_Y} color={PLANT_FILL} opacity={0.16} />
			<Line
				points={[...outline, outline[0]].map((p) => v3(p, LINE_Y))}
				color={SYMBOL_COLOR}
				lineWidth={2}
				alphaToCoverage={false}
			/>
			{[1, -1].map((sign) => (
				<Line
					key={sign}
					points={[
						v3({ x: -cross, y: -sign * cross }, LINE_Y),
						v3({ x: cross, y: sign * cross }, LINE_Y),
					]}
					color={SYMBOL_COLOR}
					lineWidth={2}
					alphaToCoverage={false}
				/>
			))}
			<Html
				position={[0, LINE_Y, radius + 0.18]}
				center
				style={{ pointerEvents: "none" }}
			>
				<span className={FAINT_LABEL_CLASS}>PLANT</span>
			</Html>
		</group>
	);
}

function FurnitureFootprint({ item }: { item: FurnitureItem }) {
	const style = FOOTPRINT_STYLES[item.catalogId] ?? {
		...FOOTPRINT_FALLBACK,
		label: item.catalogId.toUpperCase(),
	};
	const { width, depth } = item.footprint;
	const outline = useMemo(
		() => roundedRectPoints(width, depth, style.radius),
		[width, depth, style.radius],
	);
	const shape = useMemo(() => shapeFromPoints(outline), [outline]);
	const isRug = style.dashed === true;
	const border = useMemo(() => {
		const loop = [...outline, outline[0]];
		return isRug ? dashedPolyline(loop, 0.07, 0.05) : loop;
	}, [outline, isRug]);
	const label = isRug ? (
		<Html
			position={[-width / 2 + 0.16, LINE_Y, depth / 2 - 0.14]}
			center
			style={{ pointerEvents: "none" }}
		>
			<span className={FAINT_LABEL_CLASS}>{style.label}</span>
		</Html>
	) : (
		<Html position={[0, LINE_Y, 0]} center style={{ pointerEvents: "none" }}>
			<span
				className={LABEL_CLASS}
				style={
					labelReadsVertically(item)
						? { writingMode: "vertical-rl" }
						: undefined
				}
			>
				{style.label}
			</span>
		</Html>
	);
	return (
		<group
			position={[item.position.x, 0, item.position.y]}
			rotation-y={MathUtils.degToRad(item.rotation)}
		>
			<FlatShape
				shapes={shape}
				y={isRug ? RUG_FILL_Y : FILL_Y}
				color={style.fill}
				opacity={style.fillOpacity}
			/>
			<Line
				segments={isRug}
				points={border.map((p) => v3(p, isRug ? RUG_LINE_Y : LINE_Y))}
				color={isRug ? "#9aa9c7" : SYMBOL_COLOR}
				lineWidth={2}
				alphaToCoverage={false}
			/>
			{label}
		</group>
	);
}

/** External dimension line with end ticks and a centered value pill. */
function DimensionLine({
	from,
	to,
	label,
}: {
	from: Point;
	to: Point;
	label: string;
}) {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length === 0) return null;
	const perp = {
		x: -(to.y - from.y) / length,
		y: (to.x - from.x) / length,
	};
	const tick = (p: Point): [number, number, number][] => [
		v3(
			{ x: p.x - perp.x * DIMENSION_TICK, y: p.y - perp.y * DIMENSION_TICK },
			LINE_Y,
		),
		v3(
			{ x: p.x + perp.x * DIMENSION_TICK, y: p.y + perp.y * DIMENSION_TICK },
			LINE_Y,
		),
	];
	return (
		<group>
			<Line
				points={[v3(from, LINE_Y), v3(to, LINE_Y)]}
				color={DIMENSION_COLOR}
				lineWidth={1.5}
				alphaToCoverage={false}
			/>
			<Line
				segments
				points={[...tick(from), ...tick(to)]}
				color={DIMENSION_COLOR}
				lineWidth={1.5}
				alphaToCoverage={false}
			/>
			<Html
				position={[(from.x + to.x) / 2, LINE_Y, (from.y + to.y) / 2]}
				center
				style={{ pointerEvents: "none" }}
			>
				<span className="whitespace-nowrap rounded-lg border border-[rgba(15,27,61,0.12)] bg-white px-[11px] py-[3px] font-mono text-[13px] text-[#33415C]">
					{label}
				</span>
			</Html>
		</group>
	);
}

export function PlanScene({ room }: { room: Room }) {
	const solids = useMemo(() => buildWallSolids(room), [room]);
	const bounds = useMemo(() => outlineBounds(room.outline), [room.outline]);
	const area = useMemo(() => floorArea(room.outline), [room.outline]);
	const floorShape = useMemo(
		() => (room.outline.length >= 3 ? shapeFromPoints(room.outline) : null),
		[room.outline],
	);
	const wallShapes = useMemo(() => {
		const shapes = solids.flatMap((solid) =>
			solidSpans(solid).map((span) =>
				shapeFromPoints(wallSpanRect(solid, span, WALL_THICKNESS)),
			),
		);
		const half = WALL_THICKNESS / 2;
		for (const post of cornerPosts(solids)) {
			shapes.push(
				shapeFromPoints([
					{ x: post.center.x - half, y: post.center.y - half },
					{ x: post.center.x + half, y: post.center.y - half },
					{ x: post.center.x + half, y: post.center.y + half },
					{ x: post.center.x - half, y: post.center.y + half },
				]),
			);
		}
		return shapes;
	}, [solids]);

	if (!bounds || !floorShape) return null;
	const dimensionOffset = WALL_THICKNESS + DIMENSION_GAP;
	return (
		<group>
			<PlanShadow outline={room.outline} min={bounds.min} max={bounds.max} />
			<mesh rotation-x={-Math.PI / 2} position-y={FLOOR_Y}>
				<shapeGeometry args={[floorShape]} />
				<meshBasicMaterial map={floorTexture()} />
			</mesh>
			{wallShapes.length > 0 && (
				<FlatShape shapes={wallShapes} y={WALL_Y} color={WALL_COLOR} />
			)}
			{solids.map((solid) => (
				<WallOpenings key={solid.index} solid={solid} />
			))}
			{room.furniture.map((item) =>
				item.catalogId === "plant" ? (
					<PlantFootprint key={item.id} item={item} />
				) : (
					<FurnitureFootprint key={item.id} item={item} />
				),
			)}
			<DimensionLine
				from={{ x: bounds.min.x, y: bounds.min.y - dimensionOffset }}
				to={{ x: bounds.max.x, y: bounds.min.y - dimensionOffset }}
				label={`${bounds.width.toFixed(2)} m`}
			/>
			<DimensionLine
				from={{ x: bounds.min.x - dimensionOffset, y: bounds.min.y }}
				to={{ x: bounds.min.x - dimensionOffset, y: bounds.max.y }}
				label={`${bounds.height.toFixed(2)} m`}
			/>
			<Html
				position={[
					(bounds.min.x + bounds.max.x) / 2,
					LINE_Y,
					(bounds.min.y + bounds.max.y) / 2,
				]}
				center
				style={{ pointerEvents: "none" }}
			>
				<div className="flex flex-col items-center gap-1 whitespace-nowrap rounded-[14px] border border-[rgba(15,27,61,0.08)] bg-white/85 px-[22px] py-3 shadow-[0_12px_30px_rgba(15,27,61,0.08)] backdrop-blur-[10px]">
					<span className="text-[15px] font-bold tracking-[0.14em] text-[#33415C]">
						{(room.name ?? "Room").toUpperCase()}
					</span>
					<span className="font-mono text-[12.5px] text-[#0F766E]">
						{area.toFixed(2)} m² floor area
					</span>
				</div>
			</Html>
		</group>
	);
}
