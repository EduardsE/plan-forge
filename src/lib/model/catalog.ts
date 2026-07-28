import type { Footprint } from "./types";

/**
 * The furniture catalog behind the objects panel (mockup screen 1d). Plain
 * data like the rest of the model — thumbnails are a rendering concern and
 * live with the panel component, keyed by catalog id.
 *
 * The seating rows are lifted from the mockup's panel cards (names and
 * W × D centimetres verbatim; the mockup shows no heights, so those are
 * reasonable real-furniture values). The ids already referenced by the
 * sample room (desk, desk-chair, credenza, shelf, rug, plant) reuse the
 * sample fixture's measured footprints so a fresh drop matches what's
 * already standing in the room. Everything else fills out the mockup's
 * category chips so no chip filters to an empty grid.
 */

export type CatalogCategory =
  | "seating"
  | "tables"
  | "storage"
  | "beds"
  | "lighting"
  | "decor"
  | "wall-items"
  | "plants"
  | "openings"
  | "stairs";

export const CATALOG_CATEGORY_LABELS: Record<CatalogCategory, string> = {
  seating: "Seating",
  tables: "Tables",
  storage: "Storage",
  beds: "Beds",
  lighting: "Lighting",
  decor: "Decor",
  "wall-items": "Wall items",
  plants: "Plants",
  openings: "Doors & windows",
  stairs: "Stairs",
};

export interface CatalogItem {
  /** The `FurnitureItem.catalogId` this entry is referenced by. */
  id: string;
  name: string;
  category: CatalogCategory;
  footprint: Footprint;
}

const item = (
  id: string,
  name: string,
  category: CatalogCategory,
  width: number,
  depth: number,
  height: number,
): CatalogItem => ({ id, name, category, footprint: { width, depth, height } });

export const CATALOG: CatalogItem[] = [
  // Seating, in the mockup's card order.
  item("lounge-chair", "Lounge Chair", "seating", 0.74, 0.8, 0.75),
  // Real-mesh pilot items: footprints mirror the prepared model's natural
  // size (model-manifest.gen.ts) so a fresh drop fills its footprint exactly
  // — locked by models.test.ts.
  item("sofa-2", "Sofa · 2-seat", "seating", 1.68, 0.703, 0.789),
  item("armchair", "Armchair", "seating", 0.84, 0.703, 0.789),
  item("stool", "Stool", "seating", 0.42, 0.42, 0.45),
  item("bench", "Bench", "seating", 1.2, 0.44, 0.45),
  item("pouf", "Pouf", "seating", 0.55, 0.55, 0.4),
  item("desk-chair", "Desk Chair", "seating", 0.64, 0.64, 1.04),
  item("desk", "Desk", "tables", 2.2, 0.85, 1.12),
  item("coffee-table", "Coffee Table", "tables", 0.9, 0.55, 0.42),
  item("side-table", "Side Table", "tables", 0.45, 0.45, 0.52),
  item("dining-table", "Dining Table", "tables", 1.6, 0.851, 0.621),
  item("spider-table", "Spider Table", "tables", 2.4, 1.1, 0.75),
  item("credenza", "Credenza", "storage", 1.8, 0.558, 0.6),
  item("shelf", "Shelf", "storage", 1.4, 0.44, 1.7),
  item("wardrobe", "Wardrobe", "storage", 1.0, 0.625, 2.125),
  item("bed-double", "Double Bed", "beds", 1.6, 1.883, 0.628),
  item("bed-single", "Single Bed", "beds", 0.9, 2.0, 0.95),
  item("floor-lamp", "Floor Lamp", "lighting", 0.38, 0.439, 2.149),
  item("table-lamp", "Table Lamp", "lighting", 0.22, 0.22, 0.48),
  item("rug", "Rug", "decor", 2.8, 2.0, 0.01),
  item("floor-mirror", "Floor Mirror", "decor", 0.55, 0.4, 1.65),
  item("picture-frame", "Picture Frame", "wall-items", 0.9, 0.06, 0.7),
  item("wall-clock", "Wall Clock", "wall-items", 0.36, 0.06, 0.36),
  // Real-mesh wall item: footprint mirrors the prepared model's natural size
  // (model-manifest.gen.ts) — locked by models.test.ts.
  item("tv", "TV", "wall-items", 1.24, 0.057, 0.72),
  item("plant", "Potted Plant", "plants", 0.45, 0.422, 0.54),
  item("succulent", "Succulent", "plants", 0.17, 0.187, 0.271),
  item("plant-large", "Tall Plant", "plants", 0.6, 0.647, 1.379),
  item("monstera", "Monstera", "plants", 0.8, 0.728, 1.252),
  // Openings: cards that insert a door/window into the wall they're dropped
  // on instead of adding furniture. Width/depth/height mirror the opening
  // constants (DOOR_WIDTH/WINDOW_WIDTH in opening-place.ts, WALL_THICKNESS
  // and DOOR_HEIGHT/WINDOW_SILL→HEAD in room-scene.ts) — duplicated here
  // because the model layer stays import-free of the scene helpers.
  item("door", "Door", "openings", 0.9, 0.1, 2.05),
  item("window", "Window", "openings", 1.2, 0.1, 1.58),
  item("passage", "Doorless entry", "openings", 1.2, 0.1, 2.05),
  // Stairs: a card that inserts a `Stair` (model/stairs.ts) rather than
  // furniture — width/depth/height here are nominal card dims only, never
  // the real run (derived per-floor from `stairRun(storeyHeightOf(floor))`,
  // lib/stairs.ts).
  item("stairs", "Straight stair", "stairs", 0.9, 3.0, 2.6),
];

/** Catalog entries that insert an `Opening` rather than a furniture item. */
export function isOpeningItem(id: string): boolean {
  return id === "door" || id === "window" || id === "passage";
}

/** The catalog entry that inserts a `Stair` rather than furniture. */
export function isStairItem(id: string): boolean {
  return id === "stairs";
}

const byId = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function catalogItemById(id: string): CatalogItem | undefined {
  return byId.get(id);
}

/**
 * The panel's live filter: case-insensitive name search combined with an
 * optional category chip. Preserves catalog order.
 */
export function filterCatalog(
  query: string,
  category: CatalogCategory | null,
): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  return CATALOG.filter(
    (entry) =>
      (category === null || entry.category === category) &&
      (needle === "" || entry.name.toLowerCase().includes(needle)),
  );
}

/** Card dimension line, mockup format: "168 × 88 cm" (width × depth). */
export function formatSizeCm({ width, depth }: Footprint): string {
  const cm = (meters: number) => Math.round(meters * 100).toString();
  return `${cm(width)} × ${cm(depth)} cm`;
}
