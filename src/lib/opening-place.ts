import { type OpeningKind, type Point, type Room, wallsOf } from "#/lib/model";
import type { PlacementGuide } from "#/lib/place";
import { PLACEMENT_GRID } from "#/lib/place";
import { wallPoint } from "#/lib/plan-scene";
import type { WallSolid } from "#/lib/room-scene";

/**
 * Pure placement math for the door/window tools: where a click or drag along
 * a wall actually lands an opening, and the distance-to-corner guides drawn
 * while it moves. Everything is in wall-local offsets (meters from the wall's
 * start corner), so it works for walls at any angle — rendering and pointer
 * projection live in `plan-openings.tsx`.
 */

/** Default leaf/frame widths for a freshly inserted opening, meters. */
export const DOOR_WIDTH = 0.9;
export const WINDOW_WIDTH = 1.2;

export function defaultOpeningWidth(kind: OpeningKind): number {
	return kind === "door" ? DOOR_WIDTH : WINDOW_WIDTH;
}

/** Offsets quantize to the same grid furniture placement uses. */
export const OPENING_GRID = PLACEMENT_GRID;

/** How far inside the interior wall face the corner guides draw, meters. */
export const OPENING_GUIDE_INSET = 0.18;

/** Gaps below this read as flush to the corner — the guide disappears. */
const FLUSH_EPSILON = 0.005;
const EPS = 1e-6;

/** An occupied stretch of a wall (an existing opening), wall-local. */
export interface WallSpan {
	start: number;
	width: number;
}

/**
 * Signed distance of a plan point along the wall's direction — the wall-local
 * offset a pointer position corresponds to.
 */
export function offsetAlongWall(solid: WallSolid, point: Point): number {
	return (
		(point.x - solid.start.x) * solid.dir.x +
		(point.y - solid.start.y) * solid.dir.y
	);
}

/**
 * Where an opening of `width` dragged (or clicked) to `rawOffset` actually
 * lands on a wall of `wallLength`: the offset quantizes to the grid, then
 * clamps into the nearest stretch of wall not already occupied by `others`.
 * Returns null when no free stretch fits the width — the opening can't land
 * on this wall at all.
 */
export function slideOpening(
	wallLength: number,
	width: number,
	others: WallSpan[],
	rawOffset: number,
	grid: number = OPENING_GRID,
): number | null {
	if (width > wallLength + EPS) return null;
	const blocked = others
		.map((span) => ({
			start: Math.max(0, span.start),
			end: Math.min(wallLength, span.start + span.width),
		}))
		.filter((span) => span.end - span.start > EPS)
		.sort((a, b) => a.start - b.start);

	const gaps: Array<{ start: number; end: number }> = [];
	let cursor = 0;
	for (const span of blocked) {
		if (span.start - cursor > EPS)
			gaps.push({ start: cursor, end: span.start });
		cursor = Math.max(cursor, span.end);
	}
	if (wallLength - cursor > EPS) gaps.push({ start: cursor, end: wallLength });

	const quantized = Math.round(rawOffset / grid) * grid;
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const gap of gaps) {
		if (gap.end - gap.start < width - EPS) continue;
		// Clamping may leave the grid at a gap edge — flush beats the grid.
		const clamped = Math.min(Math.max(quantized, gap.start), gap.end - width);
		const distance = Math.abs(clamped - rawOffset);
		if (distance < bestDistance - EPS) {
			best = clamped;
			bestDistance = distance;
		}
	}
	return best;
}

/** Narrowest width the chip's field accepts for a door or window, meters. */
export const MIN_OPENING_WIDTH = 0.3;

/**
 * Set an opening's width from the chip's field, keeping its center where it
 * is as far as the wall allows. The width clamps into the free stretch the
 * opening currently occupies (its wall minus the other openings there), and
 * the near-edge offset re-clamps so nothing overlaps. Unknown ids and
 * non-finite widths return the room unchanged.
 */
export function resizeOpening(room: Room, id: string, width: number): Room {
	const opening = room.openings.find((entry) => entry.id === id);
	if (!opening || !Number.isFinite(width)) return room;
	const wall = wallsOf(room.outline).find((w) => w.index === opening.wallIndex);
	if (!wall) return room;
	const wallLength = Math.hypot(
		wall.end.x - wall.start.x,
		wall.end.y - wall.start.y,
	);
	// The free gap around the opening: from the nearest neighbor edge (or wall
	// corner) on each side.
	let gapStart = 0;
	let gapEnd = wallLength;
	for (const other of room.openings) {
		if (other.id === id || other.wallIndex !== opening.wallIndex) continue;
		const end = other.offset + other.width;
		if (end <= opening.offset + EPS) gapStart = Math.max(gapStart, end);
		if (other.offset + EPS >= opening.offset + opening.width) {
			gapEnd = Math.min(gapEnd, other.offset);
		}
	}
	const clampedWidth = Math.min(
		Math.max(width, MIN_OPENING_WIDTH),
		gapEnd - gapStart,
	);
	const center = opening.offset + opening.width / 2;
	const offset = Math.min(
		Math.max(center - clampedWidth / 2, gapStart),
		gapEnd - clampedWidth,
	);
	if (clampedWidth === opening.width && offset === opening.offset) return room;
	return {
		...room,
		openings: room.openings.map((entry) =>
			entry.id === id ? { ...entry, offset, width: clampedWidth } : entry,
		),
	};
}

/**
 * The distance-to-corner readouts for an opening at `offset`: one guide from
 * each wall corner to the opening's near edge, drawn `inset` meters inside
 * the room. Flush edges produce no guide. The `axis` field only feeds the
 * guide renderer's orientation-agnostic bits; both guides share the wall's
 * dominant axis.
 */
export function openingCornerGuides(
	solid: WallSolid,
	offset: number,
	width: number,
	inset: number = OPENING_GUIDE_INSET,
): PlacementGuide[] {
	const axis: "x" | "y" =
		Math.abs(solid.dir.x) >= Math.abs(solid.dir.y) ? "x" : "y";
	const guides: PlacementGuide[] = [];
	if (offset > FLUSH_EPSILON) {
		guides.push({
			axis,
			id: "near",
			from: wallPoint(solid, 0, -inset),
			to: wallPoint(solid, offset, -inset),
			distance: offset,
		});
	}
	const farGap = solid.length - offset - width;
	if (farGap > FLUSH_EPSILON) {
		guides.push({
			axis,
			id: "far",
			from: wallPoint(solid, offset + width, -inset),
			to: wallPoint(solid, solid.length, -inset),
			distance: farGap,
		});
	}
	return guides;
}
