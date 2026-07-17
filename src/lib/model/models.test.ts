import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogItemById } from "./catalog";
import { MODEL_MANIFEST, modelForCatalogId } from "./models";

describe("model manifest", () => {
  const entries = Object.entries(MODEL_MANIFEST);

  it("covers exactly the six pilot items", () => {
    expect(Object.keys(MODEL_MANIFEST).sort()).toEqual([
      "armchair",
      "bed-double",
      "dining-table",
      "floor-lamp",
      "sofa-2",
      "wardrobe",
    ]);
  });

  it("misses for unmapped items (primitives fallback)", () => {
    expect(modelForCatalogId("desk")).toBeUndefined();
  });

  it.each(
    entries,
  )("%s: committed asset, sane naturals, a body slot", (id, entry) => {
    expect(entry.file).toBe(`/models/${id}.glb`);
    expect(existsSync(`public${entry.file}`)).toBe(true);
    expect(entry.natural.width).toBeGreaterThan(0);
    expect(entry.natural.depth).toBeGreaterThan(0);
    expect(entry.natural.height).toBeGreaterThan(0);
    expect(Object.values(entry.slots)).toContain("body");
  });

  // Spec: a mapped item's default footprint equals the mesh's natural size,
  // so a fresh drop fills its footprint exactly — underfill only ever comes
  // from a user aspect-edit.
  it.each(
    entries,
  )("%s: catalog default footprint matches the mesh", (id, entry) => {
    const item = catalogItemById(id);
    expect(item).toBeDefined();
    expect(item?.footprint).toEqual(entry.natural);
  });
});
