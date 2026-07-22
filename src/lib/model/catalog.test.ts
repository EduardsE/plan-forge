import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_CATEGORY_LABELS,
  catalogItemById,
  filterCatalog,
  formatSizeCm,
  isStairItem,
} from "./catalog";
import { createSampleRoom } from "./test-fixtures";

describe("CATALOG", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every category chip with at least one item", () => {
    for (const category of Object.keys(CATALOG_CATEGORY_LABELS)) {
      expect(
        CATALOG.some((entry) => entry.category === category),
        `no items in category "${category}"`,
      ).toBe(true);
    }
  });

  it("resolves every catalog id referenced by the sample room", () => {
    for (const item of createSampleRoom().furniture) {
      expect(
        catalogItemById(item.catalogId),
        `sample item "${item.catalogId}" missing from catalog`,
      ).toBeDefined();
    }
  });

  it("matches the sample room's measured footprints for shared ids", () => {
    for (const item of createSampleRoom().furniture) {
      expect(catalogItemById(item.catalogId)?.footprint).toEqual(
        item.footprint,
      );
    }
  });
});

describe("filterCatalog", () => {
  it("returns the full catalog for an empty query and no category", () => {
    expect(filterCatalog("", null)).toHaveLength(CATALOG.length);
  });

  it("filters by category", () => {
    const seating = filterCatalog("", "seating");
    expect(seating.length).toBeGreaterThan(0);
    expect(seating.every((entry) => entry.category === "seating")).toBe(true);
  });

  it("keeps the mockup's card order within seating", () => {
    expect(
      filterCatalog("", "seating")
        .slice(0, 6)
        .map((entry) => entry.name),
    ).toEqual([
      "Lounge Chair",
      "Sofa · 2-seat",
      "Armchair",
      "Stool",
      "Bench",
      "Pouf",
    ]);
  });

  it("searches names case-insensitively and combines with the category", () => {
    expect(filterCatalog("SOFA", null).map((entry) => entry.id)).toEqual([
      "sofa-2",
    ]);
    expect(filterCatalog("table", "tables").length).toBeGreaterThan(0);
    expect(filterCatalog("sofa", "plants")).toEqual([]);
  });
});

describe("formatSizeCm", () => {
  it("renders width × depth in whole centimeters", () => {
    expect(formatSizeCm({ width: 1.68, depth: 0.88, height: 0.82 })).toBe(
      "168 × 88 cm",
    );
  });
});

describe("stairs catalog entry", () => {
  it("has a stairs category with a labeled chip", () => {
    expect(CATALOG_CATEGORY_LABELS.stairs).toBe("Stairs");
  });

  it("isStairItem recognizes only the stairs id", () => {
    expect(isStairItem("stairs")).toBe(true);
    expect(isStairItem("door")).toBe(false);
    expect(isStairItem("desk")).toBe(false);
  });

  it("filterCatalog('', 'stairs') returns the stair entry", () => {
    const results = filterCatalog("", "stairs");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("stairs");
    expect(results[0].name).toBe("Straight stair");
  });
});
