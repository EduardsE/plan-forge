import type { Floor, Room } from "./types";

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
    id: "living-room",
    name: "Living room",
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
      // standard 0.95 m leaf. The 2D plan draws the leaf hinged at the
      // opening's near (offset) edge, swinging into the room.
      {
        id: "door-1",
        kind: "door",
        wallIndex: 1,
        offset: 3.6,
        width: 0.95,
        hinge: "start",
      },
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
        // Facing became visible with composed meshes (+z local front):
        // 180° turns the chair toward the desk above it, like screen 1a.
        rotation: 180,
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
      // A wall-mounted picture frame on the left wall (index 3, running
      // (0,5.2) → (0,0)): its center sits 1.6 m along that wall and 1.5 m
      // up, flush against the interior face. position/rotation are the
      // values `deriveMountTransform` yields for this mount (kept in sync).
      {
        id: "picture-frame-1",
        catalogId: "picture-frame",
        position: { x: 0.03, y: 1.6 },
        rotation: 90,
        footprint: { width: 0.9, depth: 0.06, height: 0.7 },
        mount: {
          roomId: "living-room",
          wallIndex: 3,
          offset: 3.15,
          elevation: 1.5,
        },
      },
    ],
  };
}

/**
 * The kitchen abutting the living room's right wall (M6's shipping flat).
 * Its left wall runs exactly along x = 6.4 over the living room's full
 * right wall, so the whole party wall is a derived seam — and the living
 * room's existing door on that wall becomes the connecting portal between
 * the two rooms. Nothing about the connection is stored; it all falls out
 * of `floorSeams`/`floorPortals` recomputing from the outlines.
 *
 * Furniture reuses catalog footprints (`catalog.ts`), placed clear of the
 * walls and of each other (the overlap warning must be quiet on a fresh
 * load). Derived wall indices: 0 = top, 1 = right, 2 = bottom, 3 = left
 * (the party wall).
 */
export function createSampleKitchen(): Room {
  return {
    id: "kitchen",
    name: "Kitchen",
    outline: [
      { x: 6.4, y: 0 },
      { x: 9.4, y: 0 },
      { x: 9.4, y: 5.2 },
      { x: 6.4, y: 5.2 },
    ],
    openings: [
      // Daylight over the dining table, on the exterior right wall.
      {
        id: "kitchen-window-1",
        kind: "window",
        wallIndex: 1,
        offset: 1.7,
        width: 1.4,
      },
    ],
    furniture: [
      // A counter run along the top wall (the credenza stands in for it).
      {
        id: "kitchen-counter-1",
        catalogId: "credenza",
        position: { x: 7.45, y: 0.33 },
        rotation: 0,
        footprint: { width: 1.5, depth: 0.65, height: 0.78 },
      },
      {
        id: "dining-table-1",
        catalogId: "dining-table",
        position: { x: 8.35, y: 3.0 },
        rotation: 90,
        footprint: { width: 1.6, depth: 0.9, height: 0.75 },
      },
      {
        id: "stool-1",
        catalogId: "stool",
        position: { x: 7.35, y: 2.55 },
        rotation: 90,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
      {
        id: "stool-2",
        catalogId: "stool",
        position: { x: 7.35, y: 3.45 },
        rotation: 90,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
      {
        id: "kitchen-shelf-1",
        catalogId: "shelf",
        position: { x: 7.4, y: 4.97 },
        rotation: 180,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "kitchen-plant-1",
        catalogId: "plant",
        position: { x: 9.05, y: 4.85 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 1.2 },
      },
    ],
  };
}

/**
 * The app's default fixture: a small two-room flat — the mockup's living
 * room plus a kitchen sharing its right wall, connected through the living
 * room's door (a derived portal, see `createSampleKitchen`).
 */
export function createSampleFloor(): Floor {
  return { rooms: [createSampleRoom(), createSampleKitchen()] };
}
