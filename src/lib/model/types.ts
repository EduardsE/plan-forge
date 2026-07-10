/**
 * Plain-data room model. Rendering-agnostic: no three.js, no React, no DOM.
 *
 * Conventions:
 * - All lengths are in meters (the cm/m units toggle is a display concern).
 * - Points are 2D plan coordinates; heights are separate scalars.
 * - The room outline is a closed polygon given as an ordered corner list —
 *   the wall from the last corner back to the first is implied, never stored.
 */

export interface Point {
	x: number;
	y: number;
}

/**
 * A wall segment derived from the outline: from `corners[index]` to
 * `corners[(index + 1) % corners.length]`. Walls are never stored on the
 * room; derive them with `wallsOf`.
 */
export interface Wall {
	index: number;
	start: Point;
	end: Point;
}

export type OpeningKind = "door" | "window";

/** A door or window cut into a wall, located along that wall's direction. */
export interface Opening {
	id: string;
	kind: OpeningKind;
	/** Index of the host wall (see `Wall.index`). */
	wallIndex: number;
	/** Distance from the host wall's start corner to the opening's near edge. */
	offset: number;
	width: number;
	/**
	 * Doors only: which edge of the opening carries the hinge — the near edge
	 * (`"start"`, the default) or the far edge. Doors always swing into the
	 * room.
	 */
	hinge?: "start" | "end";
}

/** Axis-aligned size of a furniture item before rotation. */
export interface Footprint {
	width: number;
	depth: number;
	height: number;
}

export interface FurnitureItem {
	id: string;
	/** Reference into the furniture catalog (name, thumbnail, etc. live there). */
	catalogId: string;
	/** Center of the footprint on the floor plane. */
	position: Point;
	/** Rotation about the footprint center, in degrees counter-clockwise. */
	rotation: number;
	footprint: Footprint;
}

export interface Room {
	/** Display name, e.g. "Living room". */
	name?: string;
	/** Ordered corners of the closed room outline. */
	outline: Point[];
	openings: Opening[];
	furniture: FurnitureItem[];
}

/** Axis-aligned bounding box of an outline. */
export interface Bounds {
	min: Point;
	max: Point;
	width: number;
	height: number;
}
