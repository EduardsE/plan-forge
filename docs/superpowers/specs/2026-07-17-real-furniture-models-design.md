# Real furniture models in the 3D lens — design

*2026-07-17. Brainstormed from: "Is there any way to get real furniture 3D objects for free that we could use in our app?" Scope decided during the session: hobby project (any free license qualifies), hybrid coverage with the existing primitives as fallback, uniform mesh scaling (no distortion), offline asset preparation (approach A).*

## Goal

Give catalog items real 3D furniture meshes in the dollhouse lens, sourced from free CC0 low-poly kits, without touching the 2D lens, snapping, persistence, or the composed-primitives system — which remains the universal fallback so partial coverage is always shippable.

## Asset source

Primary: **Kenney Furniture Kit** (https://kenney.nl/assets/furniture-kit) — 100+ furniture GLBs, CC0, flat-shaded low-poly, untextured (material colors), a few KB each. Supplementary one-offs from poly.pizza (CC0 filter) or Quaternius packs where Kenney lacks a match. CC0 means no attribution or license bookkeeping; each recipe still records the source URL for provenance.

Low-poly untextured models were chosen deliberately over photoreal ones: they match the warm dollhouse aesthetic, stay re-tintable through the existing colorway system, and keep the bundled payload small (all pilot models together well under 1 MB).

## Architecture: offline prep, dumb runtime

Raw downloads are messy (arbitrary origin, facing, size, colors). All fixing happens **once, offline**, in a helper script; the app only ever loads files guaranteed to be normalized.

### Offline pipeline

- `assets/raw-models/` — gitignored landing area for downloaded GLBs.
- `scripts/prepare-model.ts` — run manually per model (never part of the build), using `@gltf-transform/core`. Per model it:
  1. Reads the raw GLB and the model's **recipe** (checked in next to the script): target `catalogId`, optional rotation correction so the model faces **+z** (the app's front convention), and a **material-slot mapping** — every material in the file is assigned `body` (tinted at runtime), `accent`, or `neutral` (keeps its own color).
  2. Normalizes automatically: bounding-box re-origin (y-min → 0, x/z centered — floor-center origin, matching the parts system's local space), applies the recipe rotation, prunes unused nodes, measures natural width/depth/height in meters. Stylized kits are not guaranteed to use real-world meters, so each recipe states one real-world dimension (e.g. `realWidth: 1.68`); the script uniformly rescales the model to match it before measuring, keeping the recorded natural size — and therefore the item's default footprint — physically plausible.
  3. Writes `public/models/<catalogId>.glb` (optimized, committed) and regenerates `src/lib/model/model-manifest.ts` (generated-but-committed, like `routeTree.gen.ts`): `catalogId → { file, natural: { width, depth, height }, slots }`.

### Runtime

One decision point where `room-scene.tsx` currently builds bodies from `furnitureParts`:

- **Resolver**: manifest has the item's `catalogId` → render new `ModelBody`; otherwise the existing primitives path, byte-for-byte untouched.
- **Scaling** (uniform, no distortion): `scale = min(fp.width / nat.width, fp.depth / nat.depth, fp.height / nat.height)`, mesh centered within the footprint, resting on y = 0. Pure function, unit-tested. The footprint stays the single source of truth for snapping, flush-to-wall, and the 2D lens; the mesh may underfill the footprint after a user changes the aspect ratio.
- **No underfill at default**: each mapped item's default catalog footprint is updated to the mesh's natural dimensions, so a freshly placed item fills its footprint exactly in all three axes. Underfill appears only after a user edits width/depth/height into a different aspect.
- **Tinting**: at load, `body`-slot materials get the item's `furnitureBaseColor` / active colorway — the inspector's MATERIAL row keeps working unchanged. `accent`/`neutral` materials keep the model's own colors; recipes choose slots so everything sits inside the warm beige/wood/terracotta palette.
- **Selection hull**: a scaled clone of the loaded scene rendered with the existing inverted-hull material — same visual contract as the primitives' inflated copies.
- **Loading & failure**: pilot models are preloaded on app mount (`useGLTF.preload`). While a model is loading, or if its fetch fails, the item renders its primitives body — a real fallback, never a blank, so a broken or missing file cannot empty the room.

### Untouched by design

2D plan rendering (footprints), draw mode, ghost placement, snap guides, catalog thumbnails (CSS glyphs), undo/history, persistence (rooms store `catalogId` + footprint + colorway only — no mesh data, so saved rooms are forward/backward compatible with coverage changes).

## Pilot scope

Six items, then extend model-by-model (each addition = one recipe + one script run):

`sofa-2`, `armchair`, `bed-double`, `dining-table`, `wardrobe`, `floor-lamp`.

**First implementation task is a spike**: run one Kenney GLB (the sofa) through the script and confirm its materials split cleanly into tint slots and the normalized mesh lands correctly in the scene. If Kenney's material structure fights the slot model, revisit the recipe format before building the rest.

## Error handling

- Script: refuses to write if the recipe's `catalogId` isn't in the catalog, if the measured natural size is degenerate (any axis ≤ 0), or if a material in the file has no slot assignment — loud failures at prep time, none at runtime.
- Runtime: fetch/parse failure → primitives fallback (per-item, isolated); manifest entry without a file present behaves the same.

## Testing

- Unit: scale/centering math (including degenerate footprints), manifest schema shape, resolver fallback selection, tint-slot application (pure color mapping).
- Headless Playwright (project verify convention): pilot items render as mesh bodies in 3D, plain footprints in 2D; resize in the inspector keeps the mesh inside the footprint; a deliberately broken manifest entry falls back to primitives.

## Out of scope

Photoreal/textured models, runtime model marketplace or user uploads, retiring the primitives system, attribution UI (all pilot assets are CC0), Draco/meshopt compression (files are already tiny).
