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
	| "plants";

export const CATALOG_CATEGORY_LABELS: Record<CatalogCategory, string> = {
	seating: "Seating",
	tables: "Tables",
	storage: "Storage",
	beds: "Beds",
	lighting: "Lighting",
	decor: "Decor",
	"wall-items": "Wall items",
	plants: "Plants",
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
	item("sofa-2", "Sofa · 2-seat", "seating", 1.68, 0.88, 0.82),
	item("armchair", "Armchair", "seating", 0.84, 0.86, 0.78),
	item("stool", "Stool", "seating", 0.42, 0.42, 0.45),
	item("bench", "Bench", "seating", 1.2, 0.44, 0.45),
	item("pouf", "Pouf", "seating", 0.55, 0.55, 0.4),
	item("desk-chair", "Desk Chair", "seating", 0.64, 0.64, 1.04),
	item("desk", "Desk", "tables", 2.2, 0.85, 1.12),
	item("coffee-table", "Coffee Table", "tables", 0.9, 0.55, 0.42),
	item("side-table", "Side Table", "tables", 0.45, 0.45, 0.52),
	item("dining-table", "Dining Table", "tables", 1.6, 0.9, 0.75),
	item("credenza", "Credenza", "storage", 1.5, 0.65, 0.78),
	item("shelf", "Shelf", "storage", 1.4, 0.44, 1.7),
	item("wardrobe", "Wardrobe", "storage", 1.0, 0.6, 2.0),
	item("bed-double", "Double Bed", "beds", 1.6, 2.0, 0.95),
	item("bed-single", "Single Bed", "beds", 0.9, 2.0, 0.95),
	item("floor-lamp", "Floor Lamp", "lighting", 0.38, 0.38, 1.55),
	item("table-lamp", "Table Lamp", "lighting", 0.22, 0.22, 0.48),
	item("rug", "Rug", "decor", 2.8, 2.0, 0.01),
	item("floor-mirror", "Floor Mirror", "decor", 0.55, 0.4, 1.65),
	item("picture-frame", "Picture Frame", "wall-items", 0.9, 0.06, 0.7),
	item("wall-clock", "Wall Clock", "wall-items", 0.36, 0.06, 0.36),
	item("plant", "Potted Plant", "plants", 0.45, 0.45, 1.2),
	item("plant-large", "Monstera", "plants", 0.6, 0.6, 1.6),
];

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
