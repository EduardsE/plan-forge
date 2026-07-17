/**
 * One recipe per real-mesh catalog item. The prep script
 * (scripts/prepare-model.mjs) turns each recipe's raw GLB into a normalized
 * public/models/<catalogId>.glb and regenerates the manifest module.
 *
 * - input: raw download under assets/raw-models/ (gitignored — source records
 *   where to re-download).
 * - realWidth: the model's real-world width in meters; stylized kits aren't
 *   authored in meters, so the script uniformly rescales to this before
 *   measuring. Keep it equal to the item's catalog width.
 * - rotateYDeg: correction so the model faces +z (the app's front).
 * - slots: every material name in the file → "body" (takes the item's
 *   colorway tint) | "accent" | "neutral" (keep their own color). The script
 *   errors with the material list if any name is missing — run it once with
 *   empty slots to discover the names.
 */
export const RECIPES = [
  {
    catalogId: "sofa-2",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/loungeSofa.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 1.68,
    rotateYDeg: 0,
    slots: {
      carpet: "body",
      wood: "neutral",
    },
  },
  {
    catalogId: "armchair",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/loungeChair.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 0.84,
    rotateYDeg: 0,
    slots: {
      carpet: "body",
      wood: "neutral",
    },
  },
  {
    catalogId: "bed-double",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/bedDouble.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 1.6,
    rotateYDeg: 0,
    slots: {
      carpet: "body",
      carpetWhite: "neutral",
      wood: "neutral",
      metal: "accent",
    },
  },
  {
    catalogId: "dining-table",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/table.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 1.6,
    rotateYDeg: 0,
    slots: {
      wood: "body",
    },
  },
  {
    // The kit has no wardrobe model per se, but bookcaseClosedDoors — a
    // tall, narrow, two-door cabinet — matches a wardrobe's silhouette and
    // proportions (scaled to the catalog width, its natural depth/height
    // land within a few cm of the old wardrobe placeholder footprint).
    catalogId: "wardrobe",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/bookcaseClosedDoors.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 1.0,
    rotateYDeg: 0,
    slots: {
      wood: "body",
      metal: "accent",
    },
  },
  {
    // A photogrammetry-scale credenza (295k tris, two 3072² textures ≈ 17 MB
    // raw). Its one material is unnamed in the source, so the slot key is "".
    // Simplify + texture downscale bring it in line with the kit pilots; the
    // medium-brown veneer stays "neutral" so its grain texture reads as-is
    // rather than taking the colorway tint.
    catalogId: "credenza",
    input: "assets/raw-models/credenza.glb",
    source: "supplied asset (assets/raw-models/credenza.glb)",
    realWidth: 1.8,
    rotateYDeg: 0,
    simplify: { ratio: 0.03, error: 0.01 },
    maxTexture: 1024,
    textureQuality: 85,
    // Source PBR is baked fully metallic (metalness ≈ 0.93) — wrong for wood,
    // renders near-black under the studio pool. Force matte non-metal; the
    // roughness map is near-uniform, so drop it and keep a flat factor.
    material: { metallic: 0, roughness: 1, dropMetallicRoughnessTexture: true },
    slots: {
      "": "neutral",
    },
  },
  {
    catalogId: "floor-lamp",
    input: "assets/raw-models/furniture-kit/Models/GLTF format/lampRoundFloor.glb",
    source: "https://kenney.nl/assets/furniture-kit (CC0)",
    realWidth: 0.38,
    rotateYDeg: 0,
    slots: {
      lamp: "body",
      metal: "neutral",
    },
  },
];
