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
];
