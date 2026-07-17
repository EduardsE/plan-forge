import type { Floor } from "./types";

/**
 * The app's default fixture: a small two-room flat — the mockup's living room
 * (screens 1a/1b of `design/planforge-mockups.html`) plus a kitchen sharing
 * its right wall — expressed as a **wall graph** (`createSampleFloor`).
 *
 * The graph's six nodes are the wall *centerlines*: the living room's interior
 * runs 0…6.35 / 0…5.2 and the kitchen's 6.45…9.4 / 0…5.2 once `deriveFloor`
 * insets each face by half a wall thickness, so the two rooms sit back-to-back
 * across the shared edge `BE` (which `buildEdgeSolids` in `room-scene.ts`
 * renders as one solid wall). The living room's door on `BE` becomes the
 * connecting portal purely by derivation. Every furniture value is measured
 * from the mockup (110 px/m on
 * the 2D plan, 100 px/m on the 3D scene); the room label's area is what
 * `floorArea()` yields for the derived outline — never hardcoded.
 *
 * Coordinates follow the plan screen: origin near the interior's top-left, x
 * to the right, y downward, faces wound with a positive shoelace sign.
 */
export function createSampleFloor(): Floor {
  return {
    nodes: [
      { id: "n-A", x: -0.05, y: -0.05 },
      { id: "n-B", x: 6.4, y: -0.05 },
      { id: "n-C", x: 9.45, y: -0.05 },
      { id: "n-D", x: 9.45, y: 5.25 },
      { id: "n-E", x: 6.4, y: 5.25 },
      { id: "n-F", x: -0.05, y: 5.25 },
    ],
    edges: [
      { id: "e-AB", a: "n-A", b: "n-B" },
      { id: "e-BC", a: "n-B", b: "n-C" },
      { id: "e-CD", a: "n-C", b: "n-D" },
      { id: "e-DE", a: "n-D", b: "n-E" },
      { id: "e-EF", a: "n-E", b: "n-F" },
      { id: "e-FA", a: "n-F", b: "n-A" },
      { id: "e-BE", a: "n-B", b: "n-E" },
    ],
    openings: [
      // Living-room window on the exterior top wall (AB), toward the interior.
      {
        id: "window-1",
        kind: "window",
        edgeId: "e-AB",
        offset: 3.55,
        width: 2.1,
        side: 1,
      },
      // The connecting door on the shared wall (BE), swinging into the living
      // room (side 1). A portal by derivation.
      {
        id: "door-1",
        kind: "door",
        edgeId: "e-BE",
        offset: 3.65,
        width: 0.95,
        side: 1,
        hinge: "start",
      },
      // Kitchen daylight over the dining table, on the exterior right wall (CD).
      {
        id: "kitchen-window-1",
        kind: "window",
        edgeId: "e-CD",
        offset: 1.75,
        width: 1.4,
        side: 1,
      },
    ],
    furniture: [
      // — Living room —
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
        rotation: 180,
        footprint: { width: 0.64, depth: 0.64, height: 1.04 },
      },
      {
        id: "credenza-1",
        catalogId: "credenza",
        position: { x: 0.38, y: 1.85 },
        rotation: 90,
        footprint: { width: 1.8, depth: 0.558, height: 0.6 },
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
      // A wall-mounted picture frame on the left wall (edge FA), hung on the
      // interior side (1). position/rotation are what `deriveMountTransform`
      // yields for this mount — `deriveFloor` keeps them in sync.
      {
        id: "picture-frame-1",
        catalogId: "picture-frame",
        position: { x: 0.03, y: 1.6 },
        rotation: 90,
        footprint: { width: 0.9, depth: 0.06, height: 0.7 },
        mount: { edgeId: "e-FA", offset: 3.2, side: 1, elevation: 1.5 },
      },
      // — Kitchen —
      {
        id: "kitchen-counter-1",
        catalogId: "credenza",
        position: { x: 7.45, y: 0.33 },
        rotation: 0,
        footprint: { width: 1.8, depth: 0.558, height: 0.6 },
      },
      {
        id: "dining-table-1",
        catalogId: "dining-table",
        position: { x: 8.35, y: 3.0 },
        rotation: 90,
        footprint: { width: 1.6, depth: 0.851, height: 0.621 },
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
    rooms: [
      { id: "living-room", name: "Living room", anchor: { x: 3, y: 2.5 } },
      { id: "kitchen", name: "Kitchen", anchor: { x: 8, y: 2.5 } },
    ],
  };
}
