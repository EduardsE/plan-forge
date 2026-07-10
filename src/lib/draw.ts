import type { Point } from "#/lib/model";

/**
 * Pure geometry for the draw-mode flow (mockup screen 1c): snapping the
 * cursor while placing outline corners, and re-lengthening a drafted wall
 * segment from its inline input. No three.js, no React (same pattern as
 * `plan-scene.ts` / `camera.ts`).
 *
 * All values are meters in plan coordinates (x right, y down). Tolerances
 * are passed in by the caller, which derives them from screen pixels at the
 * current camera zoom so snapping feels the same at any zoom level.
 */

/**
 * Quantization step for un-snapped cursor coordinates. Fine enough (5 cm)
 * that drawing feels free while every label still lands on a clean value;
 * the inline length input is the way to exact dimensions. (The visual grid
 * is 0.5 m — snapping hard to it couldn't produce the mockup's own 6.40 m /
 * 3.20 m walls.)
 */
export const DRAW_GRID_STEP = 0.05;

/** An axis alignment between the cursor and an earlier corner. */
export interface AlignmentSnap {
	cornerIndex: number;
	/** Matched coordinate: "x" draws a vertical guide, "y" a horizontal one. */
	axis: "x" | "y";
}

export interface DraftSnap {
	point: Point;
	/** True when the preview segment locked horizontal/vertical from the last corner. */
	axisSnapped: boolean;
	/**
	 * Turn angle between the previous segment and the preview segment
	 * (degrees, 0 = straight on, 90 = right angle). Only reported while
	 * axis-snapped with at least two corners placed.
	 */
	turnAngleDeg: number | null;
	/** Guide-line alignment with an earlier corner, if any. */
	alignment: AlignmentSnap | null;
}

function quantize(value: number, step: number): number {
	// Re-round to sub-millimeter precision: 0.05 isn't exact in binary, so the
	// raw product leaks float junk (4.800000000000001) straight into labels.
	return Math.round(Math.round(value / step) * step * 1e4) / 1e4;
}

/**
 * Snap the cursor while placing the next corner. Snaps compose in priority
 * order: first the segment from the last corner locks to an axis (within
 * `tolerance` meters), then the still-free coordinate may align with an
 * earlier corner, and whatever remains free quantizes to `DRAW_GRID_STEP`.
 */
export function snapDraftPoint(
	corners: Point[],
	cursor: Point,
	tolerance: number,
): DraftSnap {
	let x = cursor.x;
	let y = cursor.y;
	let axisSnapped = false;
	/** Which coordinates are already exact and must not be re-quantized. */
	let xLocked = false;
	let yLocked = false;

	const last = corners.at(-1);
	if (last) {
		const dx = Math.abs(x - last.x);
		const dy = Math.abs(y - last.y);
		if (dy <= dx && dy < tolerance) {
			y = last.y;
			axisSnapped = true;
			yLocked = true;
		} else if (dx < tolerance) {
			x = last.x;
			axisSnapped = true;
			xLocked = true;
		}
	}

	// Alignment with earlier corners (the last corner's alignments are the
	// axis snap above). One guide at most: the closest match on a free axis.
	let alignment: AlignmentSnap | null = null;
	let bestDistance = tolerance;
	for (let i = 0; i < corners.length - 1; i++) {
		const corner = corners[i];
		if (!xLocked) {
			const d = Math.abs(x - corner.x);
			if (d < bestDistance) {
				bestDistance = d;
				alignment = { cornerIndex: i, axis: "x" };
			}
		}
		if (!yLocked) {
			const d = Math.abs(y - corner.y);
			if (d < bestDistance) {
				bestDistance = d;
				alignment = { cornerIndex: i, axis: "y" };
			}
		}
	}
	if (alignment) {
		const corner = corners[alignment.cornerIndex];
		if (alignment.axis === "x") {
			x = corner.x;
			xLocked = true;
		} else {
			y = corner.y;
			yLocked = true;
		}
	}

	if (!xLocked) x = quantize(x, DRAW_GRID_STEP);
	if (!yLocked) y = quantize(y, DRAW_GRID_STEP);

	let turnAngleDeg: number | null = null;
	if (axisSnapped && corners.length >= 2 && last) {
		const prev = corners[corners.length - 2];
		const previous = Math.atan2(last.y - prev.y, last.x - prev.x);
		const next = Math.atan2(y - last.y, x - last.x);
		if (x !== last.x || y !== last.y) {
			let delta = Math.abs(next - previous);
			if (delta > Math.PI) delta = 2 * Math.PI - delta;
			turnAngleDeg = Math.round((delta * 180) / Math.PI);
		}
	}

	return { point: { x, y }, axisSnapped, turnAngleDeg, alignment };
}

/**
 * Set the true length of the drafted segment from corner `segmentIndex` to
 * the next corner, keeping its direction. The segment's end corner moves,
 * and every corner placed after it shifts by the same delta so the rest of
 * the draft stays rigid. Returns the input unchanged for invalid indices,
 * non-positive lengths, or a degenerate (zero-length) segment.
 */
export function setSegmentLength(
	corners: Point[],
	segmentIndex: number,
	length: number,
): Point[] {
	if (segmentIndex < 0 || segmentIndex >= corners.length - 1) return corners;
	if (!Number.isFinite(length) || length <= 0) return corners;
	const start = corners[segmentIndex];
	const end = corners[segmentIndex + 1];
	const current = Math.hypot(end.x - start.x, end.y - start.y);
	if (current === 0) return corners;
	const scale = length / current;
	const delta = {
		x: start.x + (end.x - start.x) * scale - end.x,
		y: start.y + (end.y - start.y) * scale - end.y,
	};
	return corners.map((corner, i) =>
		i <= segmentIndex
			? corner
			: { x: corner.x + delta.x, y: corner.y + delta.y },
	);
}
