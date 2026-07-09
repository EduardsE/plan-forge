import type { Room } from "./types";

/**
 * The mockup's living room (screens 1a/1b of `design/planforge-mockups.html`)
 * as model data, so both lenses render something real from day one.
 *
 * Every value is measured from the mockup, not invented: the 2D plan interior
 * is 704 × 572 px for 6.40 × 5.20 m (exactly 110 px/m) and the 3D floor is
 * 640 × 520 px (exactly 100 px/m); the two screens agree on every shared
 * position. Footprints and positions come from the 2D plan (rounded to cm),
 * heights from the 3D scene. The room label's "33.28 m²" is what
 * `floorArea()` yields for this outline — never hardcode it.
 *
 * Coordinates follow the plan screen: origin at the interior's top-left
 * corner, x to the right, y downward, outline wound clockwise. Derived wall
 * indices: 0 = top, 1 = right, 2 = bottom, 3 = left.
 */
export function createSampleRoom(): Room {
	return {
		outline: [
			{ x: 0, y: 0 },
			{ x: 6.4, y: 0 },
			{ x: 6.4, y: 5.2 },
			{ x: 0, y: 5.2 },
		],
		openings: [
			// Top wall, 385 px in, 231 px wide.
			{ id: "window-1", kind: "window", wallIndex: 0, offset: 3.5, width: 2.1 },
			// Right wall, 396 px down; drawn 104 px (0.945 m), rounded to a
			// standard 0.95 m leaf.
			{ id: "door-1", kind: "door", wallIndex: 1, offset: 3.6, width: 0.95 },
		],
		furniture: [
			{
				id: "desk-1",
				catalogId: "desk",
				position: { x: 4.7, y: 0.73 },
				rotation: 0,
				footprint: { width: 2.2, depth: 0.85, height: 1.12 },
			},
			{
				id: "desk-chair-1",
				catalogId: "desk-chair",
				position: { x: 4.52, y: 2.22 },
				rotation: 0,
				footprint: { width: 0.64, depth: 0.64, height: 1.04 },
			},
			{
				id: "credenza-1",
				catalogId: "credenza",
				position: { x: 0.38, y: 1.85 },
				rotation: 90,
				footprint: { width: 1.5, depth: 0.65, height: 0.78 },
			},
			{
				id: "shelf-1",
				catalogId: "shelf",
				position: { x: 0.27, y: 3.8 },
				rotation: 90,
				footprint: { width: 1.4, depth: 0.44, height: 1.7 },
			},
			{
				id: "rug-1",
				catalogId: "rug",
				position: { x: 3.4, y: 3.3 },
				rotation: 0,
				footprint: { width: 2.8, depth: 2, height: 0.01 },
			},
			{
				id: "plant-1",
				catalogId: "plant",
				position: { x: 5.68, y: 3.23 },
				rotation: 0,
				footprint: { width: 0.45, depth: 0.45, height: 1.2 },
			},
		],
	};
}
