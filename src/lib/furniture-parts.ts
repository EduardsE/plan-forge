import type { Footprint } from "#/lib/model";
import { catalogItemById } from "#/lib/model";

/**
 * Composed-primitive furniture bodies: each catalog item resolves to a list
 * of simple parts (boxes, cylinders, spheres) sized *proportionally* from the
 * item's footprint — no absolute artwork, so a resized or future catalog
 * entry composes the same silhouette at its own scale. Pure data; the 3D
 * lens renders each part as one mesh (and an inflated copy for the selection
 * hull), the 2D lens keeps drawing plain footprints.
 *
 * Local part space matches the item group the renderer already uses:
 * x along the footprint width (centered), z along the depth (centered),
 * y up from the item's bottom (0 = resting plane). **+z is the item's
 * front**: `deriveMountTransform` pushes a wall item's back to −z, and the
 * sample room's credenza/shelf at rotation 90 then face into the room.
 */

export type PartShape =
	| { kind: "box"; size: [number, number, number] }
	| {
			kind: "cylinder";
			radiusTop: number;
			radiusBottom: number;
			height: number;
	  }
	| { kind: "sphere"; radius: number; squash: number };

export interface FurniturePart {
	shape: PartShape;
	/** Part center: x along width, y up from the bottom, z along depth. */
	position: [number, number, number];
	/** Optional local euler rotation, radians (leaning mirror, clock face). */
	rotation?: [number, number, number];
	color: string;
}

/** Base furniture tones, lifted from the mockup's 3D scene (screen 1a). */
export const FURNITURE_COLORS: Record<string, string> = {
	desk: "#c8996b",
	"desk-chair": "#ce7b52",
	credenza: "#b4824e",
	shelf: "#b98a5f",
	rug: "#c9805f",
	"lounge-chair": "#ce7b52",
	"sofa-2": "#ce7b52",
	armchair: "#a87848",
	stool: "#b98a5f",
	bench: "#b98a5f",
	pouf: "#c9805f",
	"coffee-table": "#b98a5f",
	"side-table": "#b98a5f",
	"dining-table": "#c8996b",
	wardrobe: "#b4824e",
	"bed-double": "#c9805f",
	"bed-single": "#c9805f",
	"floor-lamp": "#d8a46b",
	"table-lamp": "#d8a46b",
	"floor-mirror": "#8c6b48",
	"wall-clock": "#f7f0e2",
	"picture-frame": "#d8845c",
};
export const FURNITURE_FALLBACK_COLOR = "#b98a5f";
const PLANT_POT_COLOR = "#b4633e";
const PLANT_FOLIAGE_COLOR = "#669758";
const FABRIC_LIGHT = "#f6ead8";
const WOOD_DARK = "#3a2a18";
const LINEN_COLOR = "#f4ead9";
const SCREEN_COLOR = "#233047";
const GLASS_COLOR = "#dfe9f2";

/** Rim the selection hull adds around a part's silhouette, meters. */
export const HULL_RIM = 0.02;

/** Linear blend of two #rrggbb colors (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
	const parse = (hex: string) => [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
	const [ar, ag, ab] = parse(a);
	const [br, bg, bb] = parse(b);
	const mix = (x: number, y: number) =>
		Math.round(x + (y - x) * t)
			.toString(16)
			.padStart(2, "0");
	return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

const darker = (color: string, t = 0.22) => mixHex(color, WOOD_DARK, t);
const lighter = (color: string, t = 0.3) => mixHex(color, FABRIC_LIGHT, t);

const box = (
	color: string,
	size: [number, number, number],
	position: [number, number, number],
	rotation?: [number, number, number],
): FurniturePart => ({
	shape: { kind: "box", size },
	position,
	rotation,
	color,
});

const cylinder = (
	color: string,
	radiusTop: number,
	radiusBottom: number,
	height: number,
	position: [number, number, number],
	rotation?: [number, number, number],
): FurniturePart => ({
	shape: { kind: "cylinder", radiusTop, radiusBottom, height },
	position,
	rotation,
	color,
});

/** The plain footprint box the placeholder era drew — the final fallback. */
function fallbackBox({ width, depth, height }: Footprint, color: string) {
	return [box(color, [width, height, depth], [0, height / 2, 0])];
}

/** Sofa family: back slab, two arms, darker base, lighter seat cushion. */
function sofaParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const arm = Math.min(0.14, w * 0.16);
	const backD = Math.min(0.18, d * 0.22);
	const seatW = w - 2 * arm;
	const seatD = d - backD;
	return [
		box(color, [w, h, backD], [0, h / 2, -(d - backD) / 2]),
		box(color, [arm, h * 0.75, seatD], [-(w - arm) / 2, h * 0.375, backD / 2]),
		box(color, [arm, h * 0.75, seatD], [(w - arm) / 2, h * 0.375, backD / 2]),
		box(darker(color), [seatW, h * 0.3, seatD], [0, h * 0.15, backD / 2]),
		box(
			lighter(color),
			[seatW, h * 0.24, seatD - 0.02],
			[0, h * 0.42, backD / 2 + 0.01],
		),
	];
}

/** Round seat on four thin cylinder legs. */
function stoolParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const seatH = h * 0.2;
	const legR = Math.min(0.02, w * 0.06);
	const inset = legR + 0.04;
	const legH = h - seatH;
	const parts = [
		cylinder(color, w / 2, w * 0.46, seatH, [0, h - seatH / 2, 0]),
	];
	for (const sx of [-1, 1])
		for (const sz of [-1, 1])
			parts.push(
				cylinder(darker(color), legR, legR, legH, [
					sx * (w / 2 - inset),
					legH / 2,
					sz * (d / 2 - inset),
				]),
			);
	return parts;
}

/** Slab top on four box legs (bench and the generic table). */
function slabAndLegsParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
	topT: number,
	legW: number,
) {
	const legH = h - topT;
	const inset = legW / 2 + 0.02;
	const parts = [box(color, [w, topT, d], [0, h - topT / 2, 0])];
	for (const sx of [-1, 1])
		for (const sz of [-1, 1])
			parts.push(
				box(
					darker(color, 0.16),
					[legW, legH, legW],
					[sx * (w / 2 - inset), legH / 2, sz * (d / 2 - inset)],
				),
			);
	return parts;
}

function tableParts(fp: Footprint, color: string) {
	const topT = Math.max(0.04, fp.height * 0.08);
	const legW = Math.min(0.08, Math.min(fp.width, fp.depth) * 0.16);
	return slabAndLegsParts(fp, color, topT, legW);
}

/** Drum body with a lighter squashed cap. */
function poufParts({ width: w, height: h }: Footprint, color: string) {
	return [
		cylinder(color, w * 0.47, w * 0.5, h * 0.85, [0, h * 0.425, 0]),
		cylinder(lighter(color), w * 0.44, w * 0.47, h * 0.15, [0, h * 0.925, 0]),
	];
}

/** Office chair: castor disc, gas column, seat pad, tall back. */
function deskChairParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const seatY = h * 0.45;
	const seatT = 0.09;
	const baseH = 0.05;
	const columnH = seatY - seatT / 2 - baseH;
	const backH = h - (seatY + seatT / 2);
	return [
		cylinder(darker(color, 0.45), w * 0.5, w * 0.42, baseH, [0, baseH / 2, 0]),
		cylinder(darker(color, 0.45), 0.03, 0.03, columnH, [
			0,
			baseH + columnH / 2,
			0,
		]),
		box(color, [w * 0.9, seatT, d * 0.9], [0, seatY, 0]),
		box(color, [w * 0.85, backH, 0.06], [0, h - backH / 2, -(d * 0.45 - 0.03)]),
	];
}

/** Desk: side panels, work top at 0.66h, modesty panel, monitor block. */
function deskParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const topSurface = h * 0.66;
	const topT = 0.048;
	const monitorW = Math.min(0.75, w * 0.4);
	const monitorH = h * 0.28;
	return [
		box(
			color,
			[0.05, topSurface - topT, d * 0.92],
			[-(w / 2 - 0.05), (topSurface - topT) / 2, 0],
		),
		box(
			color,
			[0.05, topSurface - topT, d * 0.92],
			[w / 2 - 0.05, (topSurface - topT) / 2, 0],
		),
		box(color, [w, topT, d], [0, topSurface - topT / 2, 0]),
		box(
			darker(color, 0.14),
			[w - 0.3, h * 0.24, 0.03],
			[0, topSurface - topT - h * 0.13, -(d / 2 - 0.05)],
		),
		box(
			SCREEN_COLOR,
			[0.14, 0.06, 0.05],
			[0, topSurface + 0.03, -(d / 2 - 0.15)],
		),
		box(
			SCREEN_COLOR,
			[monitorW, monitorH, 0.04],
			[0, topSurface + 0.06 + monitorH / 2, -(d / 2 - 0.15)],
		),
	];
}

/** Credenza: short legs, body, lighter top slab, two door fronts. */
function credenzaParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const legH = h * 0.12;
	const topT = h * 0.05;
	const bodyH = h - legH - topT;
	const doorW = (w - 0.1) / 2;
	const parts = [
		box(color, [w, bodyH, d], [0, legH + bodyH / 2, 0]),
		box(lighter(color, 0.18), [w, topT, d], [0, h - topT / 2, 0]),
	];
	for (const sx of [-1, 1]) {
		parts.push(
			box(
				darker(color),
				[0.05, legH, 0.05],
				[sx * (w / 2 - 0.06), legH / 2, d / 2 - 0.06],
			),
			box(
				darker(color),
				[0.05, legH, 0.05],
				[sx * (w / 2 - 0.06), legH / 2, -(d / 2 - 0.06)],
			),
			box(
				lighter(color, 0.12),
				[doorW, bodyH * 0.8, 0.018],
				[sx * (doorW / 2 + 0.01), legH + bodyH / 2, d / 2 - 0.01],
			),
		);
	}
	return parts;
}

/** Open shelf: two side panels with evenly spaced boards between them. */
function shelfParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const parts = [
		box(color, [0.04, h, d], [-(w - 0.04) / 2, h / 2, 0]),
		box(color, [0.04, h, d], [(w - 0.04) / 2, h / 2, 0]),
	];
	for (const y of [0.04, h * 0.33, h * 0.66, h - 0.02])
		parts.push(
			box(lighter(color, 0.14), [w - 0.08, 0.035, d - 0.02], [0, y, 0]),
		);
	return parts;
}

/** Wardrobe: full body with two lighter door fronts. */
function wardrobeParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const doorW = (w - 0.08) / 2;
	const doorH = h - 0.16;
	const parts = [box(color, [w, h, d], [0, h / 2, 0])];
	for (const sx of [-1, 1])
		parts.push(
			box(
				lighter(color, 0.12),
				[doorW, doorH, 0.015],
				[sx * (doorW / 2 + 0.015), 0.1 + doorH / 2, d / 2 - 0.008],
			),
		);
	return parts;
}

/** Bed: headboard at the back (−z), darker platform, mattress, pillows. */
function bedParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
	pillows: number,
) {
	const headT = 0.07;
	const bodyD = d - headT;
	const platformH = h * 0.3;
	const mattressH = h * 0.26;
	const mattressTop = platformH + mattressH;
	const pillowW = Math.min(0.62, w * 0.42);
	const parts = [
		box(color, [w, h, headT], [0, h / 2, -(d - headT) / 2]),
		box(
			darker(color, 0.15),
			[w, platformH, bodyD],
			[0, platformH / 2, headT / 2],
		),
		box(
			lighter(color, 0.3),
			[w - 0.08, mattressH, bodyD - 0.06],
			[0, platformH + mattressH / 2, headT / 2],
		),
	];
	const pillowXs =
		pillows === 1 ? [0] : [-(pillowW / 2 + 0.04), pillowW / 2 + 0.04];
	for (const x of pillowXs)
		parts.push(
			box(
				LINEN_COLOR,
				[pillowW, 0.11, d * 0.17],
				[x, mattressTop + 0.055, -(d / 2) + headT + d * 0.12],
			),
		);
	return parts;
}

/** Lamp: base disc, pole, tapered shade hung from the top. */
function lampParts(
	{ width: w, height: h }: Footprint,
	color: string,
	shadeFraction: number,
) {
	const baseH = Math.min(0.035, h * 0.06);
	const shadeH = h * shadeFraction;
	const poleR = Math.max(0.01, w * 0.045);
	const poleH = h - shadeH - baseH;
	return [
		cylinder(darker(color, 0.35), w * 0.4, w * 0.42, baseH, [0, baseH / 2, 0]),
		cylinder(darker(color, 0.35), poleR, poleR, poleH, [
			0,
			baseH + poleH / 2,
			0,
		]),
		cylinder(lighter(color, 0.35), w * 0.34, w * 0.5, shadeH, [
			0,
			h - shadeH / 2,
			0,
		]),
	];
}

/** Mirror leaning back against its footprint: tilted frame + glass. */
function mirrorParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const lean = d - 0.08;
	const angle = Math.atan2(lean, h - 0.04);
	const frameL = Math.hypot(h - 0.04, lean);
	const sin = Math.sin(angle);
	const cos = Math.cos(angle);
	const center: [number, number, number] = [
		0,
		(frameL / 2) * cos + 0.01,
		d / 2 - 0.04 - (frameL / 2) * sin,
	];
	// The glass floats a hair off the frame along the tilted face normal.
	const normal = { y: sin, z: cos };
	return [
		box(color, [w, frameL, 0.04], center, [-angle, 0, 0]),
		box(
			GLASS_COLOR,
			[w * 0.8, frameL * 0.86, 0.02],
			[0, center[1] + 0.018 * normal.y, center[2] + 0.018 * normal.z],
			[-angle, 0, 0],
		),
	];
}

/** Picture frame: back-flush frame box with a proud artwork panel. */
function pictureFrameParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	return [
		box(darker(color, 0.55), [w, h, d * 0.5], [0, h / 2, -d * 0.25]),
		box(color, [w * 0.82, h * 0.78, d * 0.35], [0, h / 2, d * 0.325 - 0.003]),
		box(
			lighter(color, 0.4),
			[w * 0.82, h * 0.3, d * 0.35],
			[0, h * 0.62, d * 0.325],
		),
	];
}

/** Wall clock: rim + face cylinders lying along z, two hands on the face. */
function clockParts(
	{ width: w, depth: d, height: h }: Footprint,
	color: string,
) {
	const flat: [number, number, number] = [Math.PI / 2, 0, 0];
	const cy = h / 2;
	const faceZ = d / 2 - 0.004;
	const hand = (length: number, angleDeg: number): FurniturePart => {
		const a = (angleDeg * Math.PI) / 180;
		return box(
			darker(color, 0.8),
			[0.012, length, 0.008],
			[-Math.sin(a) * (length / 2), cy + Math.cos(a) * (length / 2), faceZ],
			[0, 0, a],
		);
	};
	return [
		cylinder(
			darker(color, 0.5),
			w * 0.5,
			w * 0.5,
			d * 0.6,
			[0, cy, -d * 0.2],
			flat,
		),
		cylinder(
			color,
			w * 0.42,
			w * 0.42,
			d * 0.25,
			[0, cy, d * 0.375 - 0.002],
			flat,
		),
		hand(w * 0.26, -55),
		hand(w * 0.36, 15),
	];
}

/** Potted plant: tapered pot + squashed foliage sphere (the mockup's bushy
 * overhang — the foliage deliberately spills past the footprint). */
function plantParts({ width: w, height: h }: Footprint) {
	const potH = h * 0.38;
	const foliageR = w * 1.05;
	return [
		cylinder(PLANT_POT_COLOR, w * 0.5, w * 0.38, potH, [0, potH / 2, 0]),
		{
			shape: { kind: "sphere", radius: foliageR, squash: 0.92 } as const,
			position: [0, h - foliageR / 2, 0] as [number, number, number],
			color: PLANT_FOLIAGE_COLOR,
		},
	];
}

/**
 * The composed body for a catalog item. Specific ids get tailored builds;
 * unknown ids fall back to their category's representative silhouette, then
 * to the plain footprint box.
 */
export function furnitureParts(
	catalogId: string,
	footprint: Footprint,
): FurniturePart[] {
	const color = FURNITURE_COLORS[catalogId] ?? FURNITURE_FALLBACK_COLOR;
	switch (catalogId) {
		case "stool":
			return stoolParts(footprint, color);
		case "bench":
			return slabAndLegsParts(footprint, color, 0.09, 0.06);
		case "pouf":
			return poufParts(footprint, color);
		case "desk-chair":
			return deskChairParts(footprint, color);
		case "desk":
			return deskParts(footprint, color);
		case "credenza":
			return credenzaParts(footprint, color);
		case "shelf":
			return shelfParts(footprint, color);
		case "wardrobe":
			return wardrobeParts(footprint, color);
		case "bed-double":
			return bedParts(footprint, color, 2);
		case "bed-single":
			return bedParts(footprint, color, 1);
		case "floor-lamp":
			return lampParts(footprint, color, 0.24);
		case "table-lamp":
			return lampParts(footprint, color, 0.4);
		case "rug":
			return fallbackBox(footprint, color);
		case "floor-mirror":
			return mirrorParts(footprint, color);
		case "picture-frame":
			return pictureFrameParts(footprint, color);
		case "wall-clock":
			return clockParts(footprint, color);
	}
	switch (catalogItemById(catalogId)?.category) {
		case "seating":
			return sofaParts(footprint, color);
		case "tables":
			return tableParts(footprint, color);
		case "storage":
			return credenzaParts(footprint, color);
		case "beds":
			return bedParts(footprint, color, 2);
		case "lighting":
			return lampParts(footprint, color, 0.3);
		case "plants":
			return plantParts(footprint);
		default:
			return fallbackBox(footprint, color);
	}
}

/** Mesh scale a part's body renders at (spheres squash vertically). */
export function partScale(shape: PartShape): [number, number, number] {
	if (shape.kind === "sphere") return [1, shape.squash, 1];
	return [1, 1, 1];
}

/**
 * Mesh scale for a part's selection-hull copy: the body scale inflated by
 * `HULL_RIM` on every side (in the part's local axes, so rotated parts keep
 * a uniform rim).
 */
export function partHullScale(shape: PartShape): [number, number, number] {
	switch (shape.kind) {
		case "box": {
			const [x, y, z] = shape.size;
			return [
				(x + 2 * HULL_RIM) / x,
				(y + 2 * HULL_RIM) / y,
				(z + 2 * HULL_RIM) / z,
			];
		}
		case "cylinder": {
			const r = Math.max(shape.radiusTop, shape.radiusBottom);
			const k = (r + HULL_RIM) / r;
			return [k, (shape.height + 2 * HULL_RIM) / shape.height, k];
		}
		case "sphere": {
			const k = (shape.radius + HULL_RIM) / shape.radius;
			return [k, k * shape.squash, k];
		}
	}
}
