import type { Building, Floor } from "./types";

/**
 * The app's default fixture: a two-storey family house expressed as one wall
 * graph per floor (`createSampleBuilding`). Both storeys share the same
 * 11.4 × 7.4 m perimeter (centerlines; interiors inset by half a wall
 * thickness, so the ground envelope runs 0.05…11.35 / 0.05…7.35).
 *
 * Ground floor — four rooms off a central hall:
 * - Living room (x 0…4.2, full depth), Kitchen & dining (x 7.4…11.4, full
 *   depth), Utility behind the hall (x 4.2…7.4, y 0…3.0), and the Hall
 *   itself (x 4.2…7.4, y 3.0…7.4) with the front door on the y = 7.4 wall.
 * - A straight stair stands free in the hall (center (5.8, 5.1), rotation
 *   180 → climbing toward −y). Its run is *derived*: the default 2.5 m
 *   ceiling + 0.18 m slab needs 15 risers → 3.75 m, spanning y 3.225…6.975
 *   with a walkway either side — `stairValid` clears it against the wall
 *   slabs of both storeys, and it cuts the landing's void by derivation.
 *
 * Upper floor — five rooms off the landing (which sits directly over the
 * hall so the stair arrives on it): Bedroom 2 and the Home office split the
 * left column at y = 4.6, the Bathroom stacks over the Utility (shared
 * plumbing wall), and the Master bedroom (right column, y 2.4…7.4) walks
 * through to a Dressing room over the kitchen's back half.
 *
 * Every value is in meters on the plan screen's coordinates: origin at the
 * top-left perimeter centerline corner, x to the right, y downward. Room
 * areas are whatever `floorArea()` yields for the derived outlines — never
 * hardcoded. Wall-mounted items store the position/rotation
 * `deriveMountTransform` yields for their mount; stacked items store the
 * position `deriveStackPosition` yields from their host.
 */
export function createSampleBuilding(): Building {
  return { floors: [createSampleGroundFloor(), createSampleUpperFloor()] };
}

/** The ground floor of `createSampleBuilding` as a *standalone* single-floor
 * sample (used by tests that only need one storey). Standalone, the floor is
 * the top of its stack, so the stair is stripped — a lone floor holding a
 * stair would violate the "top floor never holds stairs" invariant that
 * `removeFloor` and the persistence validator both enforce. */
export function createSampleFloor(): Floor {
  return { ...createSampleGroundFloor(), stairs: [] };
}

function createSampleGroundFloor(): Floor {
  return {
    id: crypto.randomUUID(),
    nodes: [
      // Perimeter, clockwise from the top-left corner.
      { id: "gn-A", x: 0, y: 0 },
      { id: "gn-B", x: 4.2, y: 0 },
      { id: "gn-C", x: 7.4, y: 0 },
      { id: "gn-D", x: 11.4, y: 0 },
      { id: "gn-E", x: 11.4, y: 7.4 },
      { id: "gn-F", x: 7.4, y: 7.4 },
      { id: "gn-G", x: 4.2, y: 7.4 },
      { id: "gn-H", x: 0, y: 7.4 },
      // T-junctions where the hall walls meet the utility wall.
      { id: "gn-I", x: 4.2, y: 3.0 },
      { id: "gn-J", x: 7.4, y: 3.0 },
    ],
    edges: [
      { id: "ge-AB", a: "gn-A", b: "gn-B" },
      { id: "ge-BC", a: "gn-B", b: "gn-C" },
      { id: "ge-CD", a: "gn-C", b: "gn-D" },
      { id: "ge-DE", a: "gn-D", b: "gn-E" },
      { id: "ge-EF", a: "gn-E", b: "gn-F" },
      { id: "ge-FG", a: "gn-F", b: "gn-G" },
      { id: "ge-GH", a: "gn-G", b: "gn-H" },
      { id: "ge-HA", a: "gn-H", b: "gn-A" },
      // Hall side walls (each split by the utility wall's T-junction).
      { id: "ge-BI", a: "gn-B", b: "gn-I" },
      { id: "ge-IG", a: "gn-I", b: "gn-G" },
      { id: "ge-CJ", a: "gn-C", b: "gn-J" },
      { id: "ge-JF", a: "gn-J", b: "gn-F" },
      // Utility / hall dividing wall.
      { id: "ge-IJ", a: "gn-I", b: "gn-J" },
    ],
    openings: [
      // Front door into the hall, tucked beside the kitchen wall so its
      // swing clears the stair (spans x 6.3…7.2, hinge at the x 7.2 edge).
      {
        id: "go-front-door",
        kind: "door",
        edgeId: "ge-FG",
        offset: 0.2,
        width: 0.9,
        side: 1,
        hinge: "start",
      },
      // Interior doors, one per room off the hall.
      {
        id: "go-living-door",
        kind: "door",
        edgeId: "ge-IG",
        offset: 3.2,
        width: 0.9,
        side: 1,
        hinge: "end",
      },
      {
        id: "go-kitchen-door",
        kind: "door",
        edgeId: "ge-JF",
        offset: 3.2,
        width: 0.9,
        side: -1,
        hinge: "end",
      },
      {
        id: "go-utility-door",
        kind: "door",
        edgeId: "ge-IJ",
        offset: 2.25,
        width: 0.75,
        side: -1,
        hinge: "end",
      },
      // Living room daylight: west wall over the seating, north over the
      // shelf wall.
      {
        id: "go-living-window-west",
        kind: "window",
        edgeId: "ge-HA",
        offset: 2.8,
        width: 1.8,
        side: 1,
      },
      {
        id: "go-living-window-north",
        kind: "window",
        edgeId: "ge-AB",
        offset: 1.3,
        width: 1.6,
        side: 1,
      },
      // Kitchen: a window over the counter run plus two on the east wall
      // (sink light and the dining table).
      {
        id: "go-kitchen-window-north",
        kind: "window",
        edgeId: "ge-CD",
        offset: 1.4,
        width: 1.2,
        side: 1,
      },
      {
        id: "go-kitchen-window-east-1",
        kind: "window",
        edgeId: "ge-DE",
        offset: 1.3,
        width: 1.4,
        side: 1,
      },
      {
        id: "go-kitchen-window-east-2",
        kind: "window",
        edgeId: "ge-DE",
        offset: 4.6,
        width: 1.6,
        side: 1,
      },
      // High privacy window in the utility room.
      {
        id: "go-utility-window",
        kind: "window",
        edgeId: "ge-BC",
        offset: 1.2,
        width: 0.8,
        sill: 1.3,
        side: 1,
      },
    ],
    furniture: [
      // — Living room —
      {
        id: "gf-sofa",
        catalogId: "sofa-2",
        position: { x: 0.42, y: 4.6 },
        rotation: 90,
        footprint: { width: 1.68, depth: 0.703, height: 0.789 },
      },
      {
        id: "gf-coffee-table",
        catalogId: "coffee-table",
        position: { x: 1.55, y: 4.6 },
        rotation: 90,
        footprint: { width: 0.9, depth: 0.55, height: 0.42 },
      },
      {
        id: "gf-armchair",
        catalogId: "armchair",
        position: { x: 1.7, y: 2.9 },
        rotation: 315,
        footprint: { width: 0.84, depth: 0.703, height: 0.789 },
      },
      {
        id: "gf-rug",
        catalogId: "rug",
        position: { x: 1.55, y: 4.6 },
        rotation: 90,
        footprint: { width: 2.8, depth: 2, height: 0.01 },
      },
      {
        id: "gf-shelf",
        catalogId: "shelf",
        position: { x: 2.6, y: 0.27 },
        rotation: 0,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "gf-credenza",
        catalogId: "credenza",
        position: { x: 3.87, y: 1.5 },
        rotation: 270,
        footprint: { width: 1.8, depth: 0.558, height: 0.6 },
      },
      // Table lamp standing on the credenza (position derived from the
      // host: rot 270 maps the width axis to +y, so dx 0.6 → y 2.1).
      {
        id: "gf-table-lamp",
        catalogId: "table-lamp",
        position: { x: 3.87, y: 2.1 },
        rotation: 0,
        footprint: { width: 0.22, depth: 0.22, height: 0.48 },
        stack: { hostId: "gf-credenza", dx: 0.6, dy: 0 },
      },
      {
        id: "gf-floor-lamp",
        catalogId: "floor-lamp",
        position: { x: 0.35, y: 6.9 },
        rotation: 0,
        footprint: { width: 0.38, depth: 0.439, height: 2.149 },
      },
      {
        id: "gf-plant-large",
        catalogId: "plant-large",
        position: { x: 0.4, y: 0.45 },
        rotation: 0,
        footprint: { width: 0.6, depth: 0.647, height: 1.379 },
      },
      {
        id: "gf-picture-frame",
        catalogId: "picture-frame",
        position: { x: 0.08, y: 1.8 },
        rotation: 90,
        footprint: { width: 0.9, depth: 0.06, height: 0.7 },
        mount: { edgeId: "ge-HA", offset: 5.15, side: 1, elevation: 1.45 },
      },
      // — Kitchen & dining —
      {
        id: "gf-counter-1",
        catalogId: "credenza",
        position: { x: 8.4, y: 0.33 },
        rotation: 0,
        footprint: { width: 1.8, depth: 0.558, height: 0.6 },
      },
      {
        id: "gf-counter-2",
        catalogId: "credenza",
        position: { x: 10.21, y: 0.33 },
        rotation: 0,
        footprint: { width: 1.8, depth: 0.558, height: 0.6 },
      },
      {
        id: "gf-dining-table",
        catalogId: "dining-table",
        position: { x: 9.4, y: 4.9 },
        rotation: 0,
        footprint: { width: 1.6, depth: 0.851, height: 0.621 },
      },
      {
        id: "gf-bench",
        catalogId: "bench",
        position: { x: 9.4, y: 5.62 },
        rotation: 180,
        footprint: { width: 1.2, depth: 0.44, height: 0.45 },
      },
      {
        id: "gf-stool-1",
        catalogId: "stool",
        position: { x: 8.9, y: 4.14 },
        rotation: 0,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
      {
        id: "gf-stool-2",
        catalogId: "stool",
        position: { x: 9.9, y: 4.14 },
        rotation: 0,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
      {
        id: "gf-kitchen-plant",
        catalogId: "plant",
        position: { x: 11.0, y: 7.0 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.422, height: 0.54 },
      },
      {
        id: "gf-wall-clock",
        catalogId: "wall-clock",
        position: { x: 7.48, y: 1.5 },
        rotation: 90,
        footprint: { width: 0.36, depth: 0.06, height: 0.36 },
        mount: { edgeId: "ge-CJ", offset: 1.32, side: -1, elevation: 1.7 },
      },
      // — Utility —
      {
        id: "gf-utility-shelf",
        catalogId: "shelf",
        position: { x: 7.11, y: 1.5 },
        rotation: 270,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "gf-utility-bench",
        catalogId: "bench",
        position: { x: 4.87, y: 0.28 },
        rotation: 0,
        footprint: { width: 1.2, depth: 0.44, height: 0.45 },
      },
      {
        id: "gf-utility-mirror",
        catalogId: "floor-mirror",
        position: { x: 4.65, y: 2.55 },
        rotation: 45,
        footprint: { width: 0.55, depth: 0.4, height: 1.65 },
      },
      // — Hall —
      {
        id: "gf-hall-table",
        catalogId: "side-table",
        position: { x: 4.5, y: 6.9 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 0.52 },
      },
      {
        id: "gf-hall-plant",
        catalogId: "plant",
        position: { x: 4.5, y: 3.35 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.422, height: 0.54 },
      },
    ],
    rooms: [
      { id: "living-room", name: "Living room", anchor: { x: 2.1, y: 3.7 } },
      { id: "kitchen", name: "Kitchen & dining", anchor: { x: 9.4, y: 3.7 } },
      { id: "utility", name: "Utility", anchor: { x: 5.8, y: 1.5 } },
      { id: "hall", name: "Hall", anchor: { x: 4.7, y: 6.9 } },
    ],
    stairs: [
      {
        id: "stair-1",
        position: { x: 5.8, y: 5.1 },
        rotation: 180,
        width: 0.9,
      },
    ],
  };
}

function createSampleUpperFloor(): Floor {
  return {
    id: crypto.randomUUID(),
    nodes: [
      // Perimeter (same envelope as the ground floor).
      { id: "un-A", x: 0, y: 0 },
      { id: "un-B", x: 4.2, y: 0 },
      { id: "un-C", x: 7.4, y: 0 },
      { id: "un-D", x: 11.4, y: 0 },
      { id: "un-E", x: 11.4, y: 2.4 },
      { id: "un-F", x: 11.4, y: 7.4 },
      { id: "un-G", x: 7.4, y: 7.4 },
      { id: "un-H", x: 4.2, y: 7.4 },
      { id: "un-I", x: 0, y: 7.4 },
      { id: "un-J", x: 0, y: 4.6 },
      // Interior T-junctions.
      { id: "un-K", x: 4.2, y: 3.0 },
      { id: "un-L", x: 7.4, y: 3.0 },
      { id: "un-M", x: 4.2, y: 4.6 },
      { id: "un-N", x: 7.4, y: 2.4 },
    ],
    edges: [
      { id: "ue-AB", a: "un-A", b: "un-B" },
      { id: "ue-BC", a: "un-B", b: "un-C" },
      { id: "ue-CD", a: "un-C", b: "un-D" },
      { id: "ue-DE", a: "un-D", b: "un-E" },
      { id: "ue-EF", a: "un-E", b: "un-F" },
      { id: "ue-FG", a: "un-F", b: "un-G" },
      { id: "ue-GH", a: "un-G", b: "un-H" },
      { id: "ue-HI", a: "un-H", b: "un-I" },
      { id: "ue-IJ", a: "un-I", b: "un-J" },
      { id: "ue-JA", a: "un-J", b: "un-A" },
      // Left landing wall, split by the bathroom and office T-junctions.
      { id: "ue-BK", a: "un-B", b: "un-K" },
      { id: "ue-KM", a: "un-K", b: "un-M" },
      { id: "ue-MH", a: "un-M", b: "un-H" },
      // Right landing wall, split by the dressing and bathroom junctions.
      { id: "ue-CN", a: "un-C", b: "un-N" },
      { id: "ue-NL", a: "un-N", b: "un-L" },
      { id: "ue-LG", a: "un-L", b: "un-G" },
      // Bathroom / landing wall (over the ground utility wall).
      { id: "ue-KL", a: "un-K", b: "un-L" },
      // Bedroom 2 / home office wall.
      { id: "ue-JM", a: "un-J", b: "un-M" },
      // Master bedroom / dressing room wall.
      { id: "ue-NE", a: "un-N", b: "un-E" },
    ],
    openings: [
      // Doors off the landing.
      {
        id: "uo-bedroom2-door",
        kind: "door",
        edgeId: "ue-KM",
        offset: 0.375,
        width: 0.85,
        side: 1,
        hinge: "start",
      },
      {
        id: "uo-office-door",
        kind: "door",
        edgeId: "ue-MH",
        offset: 0.4,
        width: 0.85,
        side: 1,
        hinge: "start",
      },
      {
        id: "uo-bathroom-door",
        kind: "door",
        edgeId: "ue-KL",
        offset: 2.25,
        width: 0.75,
        side: -1,
        hinge: "end",
      },
      {
        id: "uo-master-door",
        kind: "door",
        edgeId: "ue-LG",
        offset: 0.5,
        width: 0.9,
        side: -1,
        hinge: "start",
      },
      // The dressing room walks through from the master bedroom.
      {
        id: "uo-dressing-door",
        kind: "door",
        edgeId: "ue-NE",
        offset: 2.1,
        width: 0.8,
        side: -1,
        hinge: "start",
      },
      // Windows.
      {
        id: "uo-bedroom2-window-north",
        kind: "window",
        edgeId: "ue-AB",
        offset: 1.4,
        width: 1.4,
        side: 1,
      },
      {
        id: "uo-bedroom2-window-west",
        kind: "window",
        edgeId: "ue-JA",
        offset: 2.0,
        width: 1.2,
        side: 1,
      },
      {
        id: "uo-office-window",
        kind: "window",
        edgeId: "ue-HI",
        offset: 1.7,
        width: 1.6,
        side: 1,
      },
      {
        id: "uo-bathroom-window",
        kind: "window",
        edgeId: "ue-BC",
        offset: 1.2,
        width: 0.8,
        sill: 1.3,
        side: 1,
      },
      {
        id: "uo-master-window-east",
        kind: "window",
        edgeId: "ue-EF",
        offset: 1.7,
        width: 1.6,
        side: 1,
      },
      {
        id: "uo-master-window-south",
        kind: "window",
        edgeId: "ue-FG",
        offset: 1.3,
        width: 1.4,
        side: 1,
      },
      // Over the front door, lighting the stair.
      {
        id: "uo-landing-window",
        kind: "window",
        edgeId: "ue-GH",
        offset: 0.2,
        width: 0.9,
        side: 1,
      },
      {
        id: "uo-dressing-window",
        kind: "window",
        edgeId: "ue-CD",
        offset: 2.8,
        width: 0.8,
        side: 1,
      },
    ],
    furniture: [
      // — Bedroom 2 —
      {
        id: "uf-bed-single",
        catalogId: "bed-single",
        position: { x: 0.55, y: 1.05 },
        rotation: 0,
        footprint: { width: 0.9, depth: 2.0, height: 0.95 },
      },
      {
        id: "uf-bed2-table",
        catalogId: "side-table",
        position: { x: 1.35, y: 0.28 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 0.52 },
      },
      {
        id: "uf-bed2-wardrobe",
        catalogId: "wardrobe",
        position: { x: 1.0, y: 4.23 },
        rotation: 180,
        footprint: { width: 1.0, depth: 0.625, height: 2.125 },
      },
      {
        id: "uf-bed2-rug",
        catalogId: "rug",
        position: { x: 2.6, y: 2.5 },
        rotation: 0,
        footprint: { width: 2.8, depth: 2, height: 0.01 },
      },
      {
        id: "uf-bed2-plant",
        catalogId: "plant",
        position: { x: 3.8, y: 0.4 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.422, height: 0.54 },
      },
      // — Home office —
      {
        id: "uf-desk",
        catalogId: "desk",
        position: { x: 0.48, y: 6.0 },
        rotation: 90,
        footprint: { width: 2.2, depth: 0.85, height: 1.12 },
      },
      {
        id: "uf-desk-chair",
        catalogId: "desk-chair",
        position: { x: 1.35, y: 6.0 },
        rotation: 270,
        footprint: { width: 0.64, depth: 0.64, height: 1.04 },
      },
      {
        id: "uf-office-shelf",
        catalogId: "shelf",
        position: { x: 3.3, y: 7.11 },
        rotation: 180,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "uf-office-pouf",
        catalogId: "pouf",
        position: { x: 3.6, y: 6.5 },
        rotation: 0,
        footprint: { width: 0.55, depth: 0.55, height: 0.4 },
      },
      {
        id: "uf-office-lamp",
        catalogId: "floor-lamp",
        position: { x: 2.7, y: 4.9 },
        rotation: 0,
        footprint: { width: 0.38, depth: 0.439, height: 2.149 },
      },
      // — Bathroom —
      {
        id: "uf-bath-mirror",
        catalogId: "floor-mirror",
        position: { x: 7.05, y: 0.35 },
        rotation: 0,
        footprint: { width: 0.55, depth: 0.4, height: 1.65 },
      },
      {
        id: "uf-bath-bench",
        catalogId: "bench",
        position: { x: 4.87, y: 0.28 },
        rotation: 0,
        footprint: { width: 1.2, depth: 0.44, height: 0.45 },
      },
      {
        id: "uf-bath-shelf",
        catalogId: "shelf",
        position: { x: 4.48, y: 2.1 },
        rotation: 90,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "uf-bath-plant",
        catalogId: "plant",
        position: { x: 5.9, y: 2.6 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.422, height: 0.54 },
      },
      // — Landing (kept clear of the stair void x 5.35…6.25, y 3.225…6.975) —
      {
        id: "uf-landing-shelf",
        catalogId: "shelf",
        position: { x: 7.12, y: 5.3 },
        rotation: 270,
        footprint: { width: 1.4, depth: 0.44, height: 1.7 },
      },
      {
        id: "uf-landing-plant",
        catalogId: "plant",
        position: { x: 4.5, y: 6.9 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.422, height: 0.54 },
      },
      {
        id: "uf-landing-frame",
        catalogId: "picture-frame",
        position: { x: 4.8, y: 7.32 },
        rotation: 180,
        footprint: { width: 0.9, depth: 0.06, height: 0.7 },
        mount: { edgeId: "ue-GH", offset: 2.15, side: 1, elevation: 1.5 },
      },
      // — Master bedroom —
      {
        id: "uf-bed-double",
        catalogId: "bed-double",
        position: { x: 9.4, y: 3.4 },
        rotation: 0,
        footprint: { width: 1.6, depth: 1.883, height: 0.628 },
      },
      {
        id: "uf-master-table-1",
        catalogId: "side-table",
        position: { x: 8.32, y: 2.68 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 0.52 },
      },
      {
        id: "uf-master-table-2",
        catalogId: "side-table",
        position: { x: 10.48, y: 2.68 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 0.52 },
      },
      {
        id: "uf-master-lamp",
        catalogId: "table-lamp",
        position: { x: 10.48, y: 2.68 },
        rotation: 0,
        footprint: { width: 0.22, depth: 0.22, height: 0.48 },
        stack: { hostId: "uf-master-table-2", dx: 0, dy: 0 },
      },
      {
        id: "uf-master-bench",
        catalogId: "bench",
        position: { x: 9.4, y: 4.65 },
        rotation: 0,
        footprint: { width: 1.2, depth: 0.44, height: 0.45 },
      },
      {
        id: "uf-master-rug",
        catalogId: "rug",
        position: { x: 9.4, y: 4.5 },
        rotation: 0,
        footprint: { width: 2.8, depth: 2, height: 0.01 },
      },
      {
        id: "uf-master-armchair",
        catalogId: "armchair",
        position: { x: 8.05, y: 6.6 },
        rotation: 135,
        footprint: { width: 0.84, depth: 0.703, height: 0.789 },
      },
      {
        id: "uf-master-floor-lamp",
        catalogId: "floor-lamp",
        position: { x: 7.85, y: 5.5 },
        rotation: 0,
        footprint: { width: 0.38, depth: 0.439, height: 2.149 },
      },
      {
        id: "uf-master-plant",
        catalogId: "plant-large",
        position: { x: 10.95, y: 6.9 },
        rotation: 0,
        footprint: { width: 0.6, depth: 0.647, height: 1.379 },
      },
      // — Dressing room —
      {
        id: "uf-wardrobe-a",
        catalogId: "wardrobe",
        position: { x: 8.0, y: 0.3625 },
        rotation: 0,
        footprint: { width: 1.0, depth: 0.625, height: 2.125 },
      },
      {
        id: "uf-wardrobe-b",
        catalogId: "wardrobe",
        position: { x: 9.01, y: 0.3625 },
        rotation: 0,
        footprint: { width: 1.0, depth: 0.625, height: 2.125 },
      },
      {
        id: "uf-wardrobe-c",
        catalogId: "wardrobe",
        position: { x: 11.03, y: 1.5 },
        rotation: 270,
        footprint: { width: 1.0, depth: 0.625, height: 2.125 },
      },
      {
        id: "uf-dressing-mirror",
        catalogId: "floor-mirror",
        position: { x: 7.85, y: 1.9 },
        rotation: 135,
        footprint: { width: 0.55, depth: 0.4, height: 1.65 },
      },
      {
        id: "uf-dressing-pouf",
        catalogId: "pouf",
        position: { x: 9.0, y: 1.5 },
        rotation: 0,
        footprint: { width: 0.55, depth: 0.55, height: 0.4 },
      },
    ],
    rooms: [
      { id: "bedroom-2", name: "Bedroom 2", anchor: { x: 2.1, y: 2.2 } },
      { id: "home-office", name: "Home office", anchor: { x: 2.1, y: 6.0 } },
      { id: "bathroom", name: "Bathroom", anchor: { x: 5.8, y: 1.5 } },
      { id: "landing", name: "Landing", anchor: { x: 6.9, y: 6.9 } },
      {
        id: "master-bedroom",
        name: "Master bedroom",
        anchor: { x: 9.4, y: 5.0 },
      },
      {
        id: "dressing-room",
        name: "Dressing room",
        anchor: { x: 9.4, y: 1.2 },
      },
    ],
    // Top floor: never holds stairs (nothing above to climb to).
    stairs: [],
  };
}
