/**
 * Offline model prep (spec: docs/superpowers/specs/2026-07-17-real-furniture-
 * models-design.md). Run manually via `pnpm prepare-models` — never part of
 * the build. Processes every recipe: normalizes the raw GLB (floor-center
 * origin, +z front, real-world rescale), writes public/models/<id>.glb, and
 * regenerates src/lib/model/model-manifest.gen.ts. All failures are loud and
 * happen here, at prep time — never at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NodeIO, getBounds } from "@gltf-transform/core";
import {
  dedup,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { RECIPES } from "./model-recipes.mjs";

const catalogSource = readFileSync("src/lib/model/catalog.ts", "utf8");
const knownIds = new Set(
  [...catalogSource.matchAll(/item\(\s*\n?\s*"([a-z0-9-]+)"/g)].map((m) => m[1]),
);

const io = new NodeIO();
const round3 = (n) => Math.round(n * 1000) / 1000;

async function processRecipe(recipe) {
  const { catalogId, input, realWidth, rotateYDeg = 0, slots } = recipe;
  if (!knownIds.has(catalogId)) {
    throw new Error(`${catalogId}: not a catalog item (src/lib/model/catalog.ts)`);
  }
  if (!existsSync(input)) {
    throw new Error(`${catalogId}: missing raw model ${input} — re-download from ${recipe.source}`);
  }

  const doc = await io.read(input);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  const names = root.listMaterials().map((m) => m.getName());
  const unslotted = names.filter((n) => !(n in slots));
  if (unslotted.length > 0) {
    throw new Error(
      `${catalogId}: unslotted materials [${unslotted.join(", ")}] — assign each to body/accent/neutral in scripts/model-recipes.mjs`,
    );
  }

  // One wrapper node carries the whole normalization transform (TRS applies
  // scale, then rotation, then translation — so uniform scale composes fine).
  const wrap = doc.createNode("planforge-root");
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrap.addChild(child);
  }
  scene.addChild(wrap);

  const rad = (rotateYDeg * Math.PI) / 180;
  wrap.setRotation([0, Math.sin(rad / 2), 0, Math.cos(rad / 2)]);
  let b = getBounds(scene);
  const scale = realWidth / (b.max[0] - b.min[0]);
  wrap.setScale([scale, scale, scale]);
  b = getBounds(scene);
  // Floor-center origin: x/z centered, y-min -> 0 (the parts-space convention).
  wrap.setTranslation([
    -(b.min[0] + b.max[0]) / 2,
    -b.min[1],
    -(b.min[2] + b.max[2]) / 2,
  ]);
  b = getBounds(scene);
  const natural = {
    width: round3(b.max[0] - b.min[0]),
    depth: round3(b.max[2] - b.min[2]),
    height: round3(b.max[1] - b.min[1]),
  };
  for (const [axis, value] of Object.entries(natural)) {
    if (!(value > 0.001)) throw new Error(`${catalogId}: degenerate ${axis} (${value})`);
  }

  // Material fix-ups for mis-authored source PBR (e.g. a wood asset baked as
  // fully metallic renders near-black under studio lighting). Applied before
  // prune so a dropped map is garbage-collected.
  if (recipe.material) {
    for (const mat of root.listMaterials()) {
      if (recipe.material.metallic !== undefined)
        mat.setMetallicFactor(recipe.material.metallic);
      if (recipe.material.roughness !== undefined)
        mat.setRoughnessFactor(recipe.material.roughness);
      if (recipe.material.dropMetallicRoughnessTexture)
        mat.setMetallicRoughnessTexture(null);
    }
  }

  // Heavyweight source assets (photogrammetry-scale meshes, oversized
  // textures) opt into decimation and texture downscaling — the stylized kit
  // pilots stay untouched. Simplify runs after normalization so the error
  // tolerance is measured against real-world (metre) proportions.
  const steps = [prune(), dedup()];
  if (recipe.simplify) {
    await MeshoptSimplifier.ready;
    steps.unshift(
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: recipe.simplify.ratio,
        error: recipe.simplify.error ?? 0.01,
      }),
    );
  }
  if (recipe.maxTexture) {
    const resize = [recipe.maxTexture, recipe.maxTexture];
    // Photographic base-colour maps go to JPEG (core glTF, no extension) —
    // far smaller than PNG for wood grain. Data maps (metallic-roughness,
    // normal, occlusion) stay PNG so channel values aren't lossily distorted;
    // uniform ones compress to almost nothing anyway. Base colours on
    // non-opaque materials (alpha-cutout foliage) carry their cutout in the
    // alpha channel, which JPEG has no room for — they stay PNG and get
    // palette quantization instead. The pattern regexes must never match the
    // empty string: textureCompress applies a pattern to the texture URI too,
    // and GLB-embedded textures have an empty URI.
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alphaNames = [
      ...new Set(
        root
          .listMaterials()
          .filter((m) => m.getAlphaMode() !== "OPAQUE")
          .map((m) => m.getBaseColorTexture()?.getName())
          .filter(Boolean),
      ),
    ].map(escapeRe);
    const alt = alphaNames.join("|");
    steps.push(
      textureCompress({ encoder: sharp, targetFormat: "png", resize }),
      textureCompress({
        encoder: sharp,
        targetFormat: "jpeg",
        quality: recipe.textureQuality ?? 85,
        slots: /baseColor/,
        ...(alphaNames.length
          ? { pattern: new RegExp(`^(?!(?:${alt})$).+$`) }
          : {}),
      }),
    );
    if (alphaNames.length) {
      steps.push(
        textureCompress({
          encoder: sharp,
          targetFormat: "png",
          quality: recipe.textureQuality ?? 85,
          slots: /baseColor/,
          pattern: new RegExp(`^(?:${alt})$`),
        }),
      );
    }
  }
  await doc.transform(...steps);

  let triangles = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles += idx ? idx.getCount() / 3 : 0;
    }

  mkdirSync("public/models", { recursive: true });
  await io.write(`public/models/${catalogId}.glb`, doc);
  console.log(
    `${catalogId}: materials [${names.join(", ")}], natural ${natural.width} × ${natural.depth} × ${natural.height} m, ${Math.round(triangles)} tris`,
  );
  return { catalogId, natural, slots };
}

function writeManifest(entries) {
  const rows = entries
    .map(
      (e) => `  "${e.catalogId}": {
    file: "/models/${e.catalogId}.glb",
    natural: { width: ${e.natural.width}, depth: ${e.natural.depth}, height: ${e.natural.height} },
    slots: ${JSON.stringify(e.slots)},
  },`,
    )
    .join("\n");
  writeFileSync(
    "src/lib/model/model-manifest.gen.ts",
    `// Generated by scripts/prepare-model.mjs — do not edit by hand.
// Edit scripts/model-recipes.mjs and re-run \`pnpm prepare-models\`.

export const MODEL_MANIFEST = {
${rows}
} as const;
`,
  );
}

const entries = [];
for (const recipe of RECIPES) {
  entries.push(await processRecipe(recipe));
}
writeManifest(entries);
console.log(`wrote ${entries.length} model(s) + src/lib/model/model-manifest.gen.ts`);
