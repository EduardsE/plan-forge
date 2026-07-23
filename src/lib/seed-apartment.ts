import type { Building, Floor, Opening, WallEdge, WallNode } from "#/lib/model";
import { STORAGE_KEY, serializeSavedState } from "#/lib/persistence";

/**
 * Apartment 019, traced from its inventory plan: a console-callable seed
 * (`window.createHome()`) that replaces the autosave with the real two-storey
 * layout. Coordinates are meters, x right / y down, matching the plan sheet
 * rotated so the living room sits top-left.
 *
 * The two sheets register onto each other through the stairs: the lower
 * storey's 4.65 m dimension matches the living/bedroom dividing wall, so the
 * lower bedroom (019-6) sits directly under the upper bedroom (019-3) and the
 * 0.91 m stairwell strip (019-5) runs under the living room's south edge.
 */

/** Deep exterior walls — the plan's masonry shell, and the deep window reveals. */
const EXT = 0.5;

function n(id: string, x: number, y: number): WallNode {
  return { id, x, y };
}

function e(id: string, a: string, b: string, thickness?: number): WallEdge {
  return thickness === undefined ? { id, a, b } : { id, a, b, thickness };
}

function door(
  id: string,
  edgeId: string,
  offset: number,
  width: number,
  side: 1 | -1,
): Opening {
  return { id, kind: "door", edgeId, offset, width, side };
}

function win(
  id: string,
  edgeId: string,
  offset: number,
  width: number,
  side: 1 | -1,
  sill: number,
  head: number,
): Opening {
  return {
    id,
    kind: "window",
    edgeId,
    offset,
    width,
    side,
    sill,
    head,
    sillOverhang: 0.15,
    sillMaterial: "wood",
  };
}

/** Upper storey: living 019-4, bedroom 019-3, entry 019-1, bath 019-2. */
const mainFloor: Floor = {
  id: "floor-main",
  name: "Main floor",
  nodes: [
    n("n1", 0, 0),
    n("n2", 5.37, 0),
    n("n3", 5.37, 4.72),
    n("n4", 6.41, 4.72),
    n("n5", 6.41, 8.2),
    n("n6", 6.41, 11.21),
    n("n7", 4.62, 4.72),
    n("n8", 4.62, 8.2),
    n("n9", 4.62, 11.21),
    n("n10", 0, 8.2),
    n("n11", 0, 11.21),
  ],
  edges: [
    e("e1", "n1", "n2", EXT), // north facade
    e("e2", "n2", "n3", EXT), // east facade, living
    e("e3", "n3", "n4", EXT), // entry north wall (apartment entrance)
    e("e4", "n4", "n5", EXT), // east facade, entry
    e("e5", "n5", "n6", EXT), // east facade, bath
    e("e6", "n6", "n9", EXT), // south facade, bath
    e("e7", "n11", "n9", EXT), // south facade, bedroom
    e("e8", "n11", "n10", EXT), // west facade, lower
    e("e9", "n10", "n1", EXT), // west facade, upper (the window wall)
    e("e10", "n3", "n7"), // living step wall over the entry
    e("e11", "n7", "n8"), // living | entry
    e("e12", "n8", "n5"), // entry | bath
    e("e13", "n8", "n9"), // bedroom | bath
    e("e14", "n10", "n8"), // living | bedroom
  ],
  openings: [
    door("d-entrance", "e3", 0.07, 0.9, 1),
    door("d-living", "e11", 0.25, 0.9, -1),
    door("d-bath", "e12", 0.5, 0.7, 1),
    door("d-bedroom", "e14", 3.7, 0.8, 1),
    // West facade: the plan's 0.56 / 1.77 / 0.12 / 1.78 window pair.
    win("w-living-1", "e9", 3.97, 1.78, 1, 0.4, 2.15),
    win("w-living-2", "e9", 5.87, 1.77, 1, 0.4, 2.15),
    // The bedroom's 2.53 window on the south facade.
    win("w-bedroom", "e7", 0.55, 2.53, -1, 0.4, 2.15),
  ],
  furniture: [],
  rooms: [
    { id: "room-living", name: "Living room", anchor: { x: 2.5, y: 2.5 } },
    { id: "room-entry", name: "Entryway", anchor: { x: 5.5, y: 6.2 } },
    { id: "room-bath", name: "Bathroom", anchor: { x: 5.5, y: 9.8 } },
    { id: "room-bed", name: "Bedroom", anchor: { x: 2.3, y: 9.8 } },
  ],
  stairs: [],
};

/** Lower storey: bedroom 019-6 under the upper bedroom, stairwell 019-5 as
 * the 0.91 m strip under the living room's south edge. */
const lowerFloor: Floor = {
  id: "floor-lower",
  name: "Lower floor",
  nodes: [
    n("m1", 0, 7.29),
    n("m2", 4.62, 7.29),
    n("m3", 4.62, 8.2),
    n("m4", 4.62, 11.21),
    n("m5", 0, 11.21),
    n("m6", 0, 8.2),
  ],
  edges: [
    e("f1", "m1", "m2"), // stairwell north (thin: the stair sits flush)
    e("f2", "m2", "m3"), // stairwell east end
    e("f3", "m3", "m4"), // bedroom east
    e("f4", "m5", "m4", EXT), // bedroom window facade
    e("f5", "m6", "m5"), // west, bedroom
    e("f6", "m6", "m3"), // stairwell | bedroom
    e("f7", "m1", "m6"), // west, stairwell
  ],
  openings: [
    door("d-lower-bed", "f6", 3.6, 0.75, 1),
    win("w-lower-bed", "f4", 1.55, 1.5, -1, 0.5, 2.0),
  ],
  furniture: [],
  rooms: [
    {
      id: "room-lower-bed",
      name: "Bedroom",
      wallHeight: 2.2,
      anchor: { x: 2.3, y: 9.8 },
    },
    {
      id: "room-stairs",
      name: "Stairs",
      wallHeight: 2.2,
      anchor: { x: 4.35, y: 7.75 },
    },
  ],
  // Climbs toward -x: bottom step at the landing by the bedroom door,
  // arriving upstairs at the living room's west end. The 2.2 m storey keeps
  // the run at 13 risers (3.25 m), spanning x 0.35..3.60 inside the strip.
  stairs: [
    {
      id: "stair-1",
      position: { x: 1.975, y: 7.745 },
      rotation: 270,
      width: 0.81,
    },
  ],
};

/** The apartment as a fresh `Building` (lower storey first: floors stack
 * ground-up). A new object per call so callers can mutate freely. */
export function createApartmentBuilding(): Building {
  return structuredClone({ floors: [lowerFloor, mainFloor] });
}

declare global {
  interface Window {
    /** Console helper: replace the autosave with apartment 019 and reload. */
    createHome?: () => void;
  }
}

/** Expose `window.createHome()`. Safe to call repeatedly; no-op on the server. */
export function installCreateHome(): void {
  if (typeof window === "undefined") return;
  window.createHome = () => {
    const state = serializeSavedState({
      building: createApartmentBuilding(),
      unit: "m",
      savedAt: Date.now(),
    });
    window.localStorage.setItem(STORAGE_KEY, state);
    window.location.reload();
  };
}
