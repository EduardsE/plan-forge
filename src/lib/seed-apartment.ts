import type {
  Building,
  Floor,
  FurnitureItem,
  Opening,
  WallEdge,
  WallNode,
} from "#/lib/model";
import { catalogItemById } from "#/lib/model";
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
  sillOverhang = 0.15,
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
    sillOverhang,
    sillMaterial: "wood",
  };
}

/** A furniture item at its catalog footprint. Rotation faces the front
 * (+depth axis) per the footprint convention: 0 → +y, 90 → +x, 270 → -x. */
function f(
  id: string,
  catalogId: string,
  x: number,
  y: number,
  rotation = 0,
): FurnitureItem {
  const entry = catalogItemById(catalogId);
  if (!entry) throw new Error(`unknown catalog id: ${catalogId}`);
  return {
    id,
    catalogId,
    position: { x, y },
    rotation,
    footprint: entry.footprint,
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
    // West facade: the plan's 0.56 / 1.77 / 0.12 / 1.78 window pair. The
    // tall rooms carry stacked double windows — an upper light over each
    // lower window, split by a 0.3 m transom bar, flush (no sill board).
    win("w-living-1", "e9", 3.97, 1.78, 1, 0.4, 2.15),
    win("w-living-1-upper", "e9", 3.97, 1.78, 1, 2.45, 3.7, 0),
    win("w-living-2", "e9", 5.87, 1.77, 1, 0.4, 2.15),
    win("w-living-2-upper", "e9", 5.87, 1.77, 1, 2.45, 3.7, 0),
    // The bedroom's 2.53 window on the south facade.
    win("w-bedroom", "e7", 0.55, 2.53, -1, 0.4, 2.15),
    // The bath's window on its 1.74 south wall segment; privacy-high sill,
    // with its own upper light under the 3.7 m ceiling.
    win("w-bath", "e6", 0.45, 0.9, 1, 0.9, 2.15),
    win("w-bath-upper", "e6", 0.45, 0.9, 1, 2.45, 3.3, 0),
  ],
  furniture: [
    // Living: sofa against the east wall facing the big west windows,
    // dining set in the lower half, clear of the stair void (x 0.30..3.80,
    // y 7.34..8.15) and the entry door (y 4.97..5.87 on the east divider).
    f("lv-sofa", "sofa-2", 4.77, 2.4, 270),
    f("lv-coffee", "coffee-table", 3.6, 2.4, 270),
    f("lv-rug", "rug", 3.7, 2.4),
    f("lv-armchair", "armchair", 2.75, 1.15, 45),
    f("lv-floor-lamp", "floor-lamp", 4.8, 3.6),
    f("lv-monstera", "monstera", 0.7, 4.7),
    f("lv-plant-tall", "plant-large", 4.75, 0.65),
    f("lv-dining", "dining-table", 2.3, 5.9),
    f("lv-bench", "bench", 2.3, 6.6, 180),
    f("lv-stool-1", "stool", 1.8, 5.2),
    f("lv-stool-2", "stool", 2.8, 5.2),
    f("lv-credenza", "credenza", 4.29, 6.6, 270),
    {
      ...f("lv-table-lamp", "table-lamp", 4.29, 7.2),
      stack: { hostId: "lv-credenza", dx: 0.6, dy: 0 },
    },
    {
      ...f("lv-frame", "picture-frame", 2.45, 0.28, 180),
      mount: { edgeId: "e1", offset: 2.0, side: 1, elevation: 1.45 },
    },
    // Bedroom: double bed headboard on the west wall, wardrobe clear of the
    // door swing (x 3.7..4.5 on the north divider).
    f("bd-bed", "bed-double", 1.19, 9.55, 90),
    f("bd-side-1", "side-table", 0.5, 8.5),
    {
      ...f("bd-lamp", "table-lamp", 0.5, 8.5),
      stack: { hostId: "bd-side-1", dx: 0, dy: 0 },
    },
    f("bd-wardrobe", "wardrobe", 2.9, 8.56),
    f("bd-plant", "plant", 4.3, 10.6),
    {
      ...f("bd-frame", "picture-frame", 0.28, 9.55, 90),
      mount: { edgeId: "e8", offset: 1.21, side: 1, elevation: 1.5 },
    },
    // Entry: bench under the coat wall, mirror in the far corner, both clear
    // of the entrance and living door swings.
    f("en-bench", "bench", 4.89, 6.8, 90),
    f("en-mirror", "floor-mirror", 5.82, 7.75, 315),
    {
      ...f("en-clock", "wall-clock", 6.13, 6.9, 270),
      mount: { edgeId: "e4", offset: 2.0, side: 1, elevation: 1.6 },
    },
    // Bath: no fixtures in the catalog, so storage and a stool.
    f("ba-shelf", "shelf", 5.94, 9.8, 270),
    f("ba-stool", "stool", 4.8, 10.5),
    {
      ...f("ba-succulent", "succulent", 5.94, 9.8),
      stack: { hostId: "ba-shelf", dx: 0.3, dy: 0 },
    },
  ],
  // The real ceilings: a 4.3 m living room, 3.7 m entry/bath, 2.3 m bedroom.
  rooms: [
    {
      id: "room-living",
      name: "Living room",
      wallHeight: 4.3,
      anchor: { x: 2.5, y: 2.5 },
    },
    {
      id: "room-entry",
      name: "Entryway",
      wallHeight: 3.7,
      anchor: { x: 5.5, y: 6.2 },
    },
    {
      id: "room-bath",
      name: "Bathroom",
      wallHeight: 3.7,
      anchor: { x: 5.5, y: 9.8 },
    },
    {
      id: "room-bed",
      name: "Bedroom",
      wallHeight: 2.3,
      anchor: { x: 2.3, y: 9.8 },
    },
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
    door("d-lower-bed", "f6", 3.85, 0.7, 1),
    win("w-lower-bed", "f4", 1.55, 1.5, -1, 0.5, 2.0),
  ],
  furniture: [
    // Single bed on the west wall, desk under the window, wardrobe past the
    // door swing (x 3.85..4.55 on the north divider).
    f("lb-bed", "bed-single", 1.05, 8.75, 90),
    // The desk stops short of the window's protruding sill board.
    f("lb-desk", "desk", 2.6, 10.38, 180),
    f("lb-chair", "desk-chair", 2.6, 9.6),
    f("lb-wardrobe", "wardrobe", 4.26, 9.6, 270),
    f("lb-rug", "rug", 2.3, 9.9),
    {
      ...f("lb-lamp", "table-lamp", 3.5, 10.5),
      stack: { hostId: "lb-desk", dx: 0.9, dy: 0 },
    },
    f("lb-plant", "plant", 0.4, 10.5),
  ],
  // The real ceilings: 2.3 m downstairs (the stairwell matches, keeping the
  // storey — and with it the stair run — as short as the truth allows).
  rooms: [
    {
      id: "room-lower-bed",
      name: "Bedroom",
      wallHeight: 2.3,
      anchor: { x: 2.3, y: 9.8 },
    },
    {
      id: "room-stairs",
      name: "Stairs",
      wallHeight: 2.3,
      anchor: { x: 4.35, y: 7.75 },
    },
  ],
  // Climbs toward -x: bottom step at the landing by the bedroom door,
  // arriving upstairs at the living room's west end. The 2.3 m storey needs
  // 14 risers (3.5 m run), spanning x 0.30..3.80 inside the strip.
  stairs: [
    {
      id: "stair-1",
      position: { x: 2.05, y: 7.745 },
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
