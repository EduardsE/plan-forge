# Authoring furniture in Blender → PlanForge asset

Learnings from the first Blender-authored catalog item (`spider-table`,
2026-07-22). The general prep pipeline is documented in
`scripts/model-recipes.mjs` + `scripts/prepare-model.mjs`; this file covers
the Blender side and the gotchas that cost time.

## The path

1. Model in Blender, **in meters**, floor at z = 0, width along X. Front
   (+z in the app) is whatever faces Blender −Y after export — the exporter
   converts Z-up→Y-up automatically; use the recipe's `rotateYDeg` for
   corrections rather than rotating the scene.
2. Export a GLB of *just the asset*: select the parts, then
   `bpy.ops.export_scene.gltf(filepath=..., use_selection=True,
   export_apply=True)`. `export_apply` bakes modifiers (bevels, booleans) —
   without it they're silently dropped.
3. Drop the raw GLB in `assets/raw-models/<id>.glb` (gitignored — keep the
   `.blend` next to it so the asset can be re-authored; the recipe's
   `source` field should say where it came from).
4. Add the recipe (`scripts/model-recipes.mjs`), then `pnpm prepare-models`.
   It prints the **natural size** — copy those exact numbers into the
   catalog entry (locked by `models.test.ts`: default footprint must equal
   the mesh's natural size).
5. Wire the app side: `catalog.ts` item, `FURNITURE_COLORS` entry
   (tints the 2D footprint + primitives fallback), a thumbnail glyph in
   `catalog-thumbnails.tsx`, and the expected-id list in `models.test.ts`.

## Materials: only glTF-expressible graphs survive export

The exporter doesn't bake arbitrary node trees — it pattern-matches a small
set of Principled BSDF wirings. Anything else exports as a flat material
with no warning you'd notice from the MCP side.

- **Object-coordinate / box-projection mappings do not export.** glTF
  textures need real UVs. For a box-mapped look, write UVs per polygon by
  dominant normal axis (project the two other coords, scaled to taste).
  On a cuboid slab that's ~10 lines of Python over `mesh.polygons`; bevel
  modifiers interpolate the base-mesh UVs fine.
- **Hue/Saturation, Color Ramp, procedural textures: not exportable.**
  The one tint that survives: `Image Texture → Mix (Multiply, factor 1,
  constant B color) → Base Color` exports as `baseColorFactor × texture`.
  Use that for tone adjustments, or pre-bake.
- Roughness/normal maps export via the standard wirings (image
  set to Non-Color; normal through a Normal Map node).
- **Name materials = recipe slot keys** (`wood`, `metal`, …). Every
  material must be slotted `body`/`accent`/`neutral`; only `body` takes the
  colorway tint at runtime, so textured veneers should be `neutral`
  (credenza precedent). Note the inspector still offers MATERIAL swatches
  for categories with colorways — on an all-neutral mesh they only affect
  the 2D footprint tint. Accepted quirk.
- Big textures: don't resize in Blender — set `maxTexture`/
  `textureQuality` in the recipe (2K sources → 1K brought the spider table
  8.3 MB → 1.9 MB).

## Blender MCP gotchas

- `primitive_cube_add(size=1)` has **half-extent 0.5** — setting
  `obj.scale` to half-extents silently builds everything at half size. Use
  `size=2` so scale == half-extent, and `transform_apply` before booleans.
- Verify geometry numerically (`matrix_world @ v.co` bounds), not just from
  a perspective render: the hub-below-the-leg-crossing bug was invisible in
  ¾ perspective shots and obvious in front orthographic. Check at least one
  ortho elevation before exporting.
- Poly Haven via the addon needs "Use assets from Poly Haven" ticked in the
  BlenderMCP N-panel; restarting the connection kills the socket — the user
  must click Connect again. `set_texture` builds a complex AO/ARM graph;
  rebuild a minimal clean material for export instead of reusing it.
- Boolean-trim angled parts against big cutter cubes to get flat
  floor/ceiling contact (legs overshoot both ends, then difference against
  z<0 and z>underside).

## Verifying in the app

Follow `.claude/skills/verify` (production build + headless Playwright),
with one correction as of this writing: the seed payload is **v6
wall-graph**, not the skill's v4 example — `{ version: 6, unit, savedAt:
<epoch ms>, floor: { nodes, edges, openings, furniture, rooms } }`, room =
`{ id, name?, anchor }`. Deserialization is strict; one malformed field
drops the whole save silently (you'll see the sample floor instead of your
seed).

The objects-panel search ANDs with the active category chip — "spider"
under an active *Seating* chip legitimately shows "No items match".

## Toolchain

pnpm 11 ignores `package.json`'s `pnpm.onlyBuiltDependencies`; build-script
approvals live in `pnpm-workspace.yaml` (`allowBuilds:`). `prepare-models`
needs `sharp: true` there or the auto-install loop fails before the script
even runs.
