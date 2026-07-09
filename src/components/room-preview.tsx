import type { ReactNode } from "react";
import type { FurnitureItem, Opening, Point, Room } from "#/lib/model";
import { floorArea, outlineBounds, wallLength, wallsOf } from "#/lib/model";

/**
 * Interim SVG plan preview so the workspace isn't empty before the real
 * lenses land. Everything drawn here is computed from the Room — outline,
 * openings, footprints, floor area. Once the R3F canvas renders both lenses
 * (Phase 2), delete this component.
 */

const SCALE = 100; // px per meter
const WALL_PX = 16;
const PAD = WALL_PX;

/** +1 when the outline winds clockwise in plan (y-down) coordinates. */
function windingSign(outline: Point[]): number {
	let twiceSigned = 0;
	for (let i = 0; i < outline.length; i++) {
		const a = outline[i];
		const b = outline[(i + 1) % outline.length];
		twiceSigned += a.x * b.y - b.x * a.y;
	}
	return twiceSigned >= 0 ? 1 : -1;
}

interface OpeningSpan {
	/** Near edge of the opening, in px. */
	a: Point;
	/** Far edge of the opening, in px. */
	b: Point;
	/** Unit normal pointing into the room. */
	n: Point;
}

function openingSpan(room: Room, opening: Opening): OpeningSpan | null {
	const wall = wallsOf(room.outline)[opening.wallIndex];
	if (!wall) return null;
	const length = wallLength(wall);
	const ux = (wall.end.x - wall.start.x) / length;
	const uy = (wall.end.y - wall.start.y) / length;
	const sign = windingSign(room.outline);
	const a = {
		x: (wall.start.x + ux * opening.offset) * SCALE,
		y: (wall.start.y + uy * opening.offset) * SCALE,
	};
	return {
		a,
		b: {
			x: a.x + ux * opening.width * SCALE,
			y: a.y + uy * opening.width * SCALE,
		},
		n: { x: -uy * sign, y: ux * sign },
	};
}

function WindowSymbol({ span }: { span: OpeningSpan }) {
	const edge = WALL_PX / 2 - 1.5;
	const lines = [
		{ offset: -edge, width: 3 },
		{ offset: 0, width: 2 },
		{ offset: edge, width: 3 },
	];
	return (
		<g>
			<line
				x1={span.a.x}
				y1={span.a.y}
				x2={span.b.x}
				y2={span.b.y}
				stroke="#FCFDFF"
				strokeWidth={WALL_PX + 2}
			/>
			{lines.map(({ offset, width }) => (
				<line
					key={offset}
					x1={span.a.x + span.n.x * offset}
					y1={span.a.y + span.n.y * offset}
					x2={span.b.x + span.n.x * offset}
					y2={span.b.y + span.n.y * offset}
					stroke="#16213E"
					strokeWidth={width}
				/>
			))}
		</g>
	);
}

function DoorSymbol({ span }: { span: OpeningSpan }) {
	const radius = Math.hypot(span.b.x - span.a.x, span.b.y - span.a.y);
	// Leaf hinged at the near edge, open 90° into the room.
	const tip = {
		x: span.a.x + span.n.x * radius,
		y: span.a.y + span.n.y * radius,
	};
	// Sweep so the arc bows through the room interior (positive cross product
	// = clockwise on screen in y-down coordinates).
	const cross =
		(span.b.x - span.a.x) * (tip.y - span.a.y) -
		(span.b.y - span.a.y) * (tip.x - span.a.x);
	const sweep = cross > 0 ? 1 : 0;
	return (
		<g>
			<line
				x1={span.a.x}
				y1={span.a.y}
				x2={span.b.x}
				y2={span.b.y}
				stroke="#FCFDFF"
				strokeWidth={WALL_PX + 2}
			/>
			<path
				d={`M ${span.b.x} ${span.b.y} A ${radius} ${radius} 0 0 ${sweep} ${tip.x} ${tip.y}`}
				fill="none"
				stroke="#8FA3C8"
				strokeWidth={2.5}
				strokeDasharray="6 5"
			/>
			<line
				x1={span.a.x}
				y1={span.a.y}
				x2={tip.x}
				y2={tip.y}
				stroke="#33415C"
				strokeWidth={3}
			/>
		</g>
	);
}

function furnitureLabel(item: FurnitureItem): string {
	return item.catalogId.replaceAll("-", " ").toUpperCase();
}

function FurnitureSymbol({ item }: { item: FurnitureItem }) {
	const w = item.footprint.width * SCALE;
	const d = item.footprint.depth * SCALE;
	const label = (
		<text
			textAnchor="middle"
			dominantBaseline="central"
			className="font-mono"
			fontSize={10}
			letterSpacing=".1em"
			fill="#475569"
		>
			{furnitureLabel(item)}
		</text>
	);
	let shape: ReactNode;
	if (item.catalogId === "plant") {
		const r = w / 2;
		const k = r * 0.37;
		shape = (
			<>
				<circle
					r={r}
					fill="rgba(79,125,70,.16)"
					stroke="#33415C"
					strokeWidth={2}
				/>
				<line x1={-k} y1={-k} x2={k} y2={k} stroke="#33415C" strokeWidth={2} />
				<line x1={-k} y1={k} x2={k} y2={-k} stroke="#33415C" strokeWidth={2} />
				<text
					y={r + 14}
					textAnchor="middle"
					className="font-mono"
					fontSize={10}
					letterSpacing=".1em"
					fill="#8A97B1"
				>
					{furnitureLabel(item)}
				</text>
			</>
		);
	} else if (item.catalogId === "rug") {
		shape = (
			<>
				<rect
					x={-w / 2}
					y={-d / 2}
					width={w}
					height={d}
					rx={10}
					fill="rgba(201,128,95,.08)"
					stroke="#9AA9C7"
					strokeWidth={2}
					strokeDasharray="7 6"
				/>
				<text
					x={-w / 2 + 12}
					y={d / 2 - 10}
					className="font-mono"
					fontSize={10}
					letterSpacing=".1em"
					fill="#8A97B1"
				>
					{furnitureLabel(item)}
				</text>
			</>
		);
	} else {
		shape = (
			<>
				<rect
					x={-w / 2}
					y={-d / 2}
					width={w}
					height={d}
					rx={6}
					fill="rgba(185,138,95,.16)"
					stroke="#33415C"
					strokeWidth={2}
				/>
				{label}
			</>
		);
	}
	return (
		<g
			transform={`translate(${item.position.x * SCALE} ${item.position.y * SCALE}) rotate(${-item.rotation})`}
		>
			{shape}
		</g>
	);
}

export function RoomPreview({ room }: { room: Room }) {
	const bounds = outlineBounds(room.outline);
	if (!bounds) return null;

	const width = bounds.width * SCALE + PAD * 2;
	const height = bounds.height * SCALE + PAD * 2;
	const viewBox = `${bounds.min.x * SCALE - PAD} ${bounds.min.y * SCALE - PAD} ${width} ${height}`;
	const outlinePoints = room.outline
		.map((p) => `${p.x * SCALE},${p.y * SCALE}`)
		.join(" ");
	const area = floorArea(room.outline);

	return (
		<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div className="relative">
				<svg
					width={width}
					height={height}
					viewBox={viewBox}
					role="img"
					aria-label="Room plan preview"
					style={{ filter: "drop-shadow(0 26px 54px rgba(15,27,61,.16))" }}
				>
					<polygon
						points={outlinePoints}
						fill="#FCFDFF"
						stroke="#16213E"
						strokeWidth={WALL_PX}
					/>
					{room.furniture.map((item) => (
						<FurnitureSymbol key={item.id} item={item} />
					))}
					{room.openings.map((opening) => {
						const span = openingSpan(room, opening);
						if (!span) return null;
						return opening.kind === "window" ? (
							<WindowSymbol key={opening.id} span={span} />
						) : (
							<DoorSymbol key={opening.id} span={span} />
						);
					})}
				</svg>
				<div
					className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[14px] border px-5 py-2.5"
					style={{
						background: "rgba(255,255,255,.85)",
						borderColor: "rgba(15,27,61,.08)",
						backdropFilter: "blur(10px)",
						boxShadow: "0 12px 30px rgba(15,27,61,.08)",
					}}
				>
					<span
						className="font-mono text-[12.5px]"
						style={{ color: "#0F766E" }}
					>
						{area.toFixed(2)} m² floor area
					</span>
				</div>
			</div>
		</div>
	);
}
