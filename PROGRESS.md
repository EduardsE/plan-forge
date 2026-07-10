# PlanForge — implementation progress

Implementation of PlanForge from the design mockups (product context: see "What we're building" in `CLAUDE.md`) (`design/planforge-mockups.html` — open it in a browser to see all 4 screens side by side; screenshots in `design/screen-*.png`).

**How to use this file:** work on ONE task at a time, in order. Check off items as they land. Each task is sized to fit comfortably in a single Claude session. The mockups define the *look*, not the implementation — their specific numbers and furniture are sample data, never hardcoded artwork.

## The design at a glance

A room/floor-plan editor. One full-screen workspace with four states shown in the mockups:

| Screen | What it shows |
|--------|---------------|
| 1a | 3D isometric "dollhouse" view, an object selected (context toolbar: rotate/duplicate/delete + dimensions) |
| 1b | Top-down 2D floor plan: walls, door arc, window, furniture footprints, dimension lines, room-area tooltip |
| 1c | Draw mode: wall-drawing tool stack, placed corners, segment length labels, inline length input, snap guides, cm/m units toggle |
| 1d | Objects panel: searchable furniture catalog with category chips, drag-out card, ghost placement footprint in 3D |

Shared chrome on every screen: dark navy left nav rail (Dashboard / Draw / Furnish / Objects / Views / Settings / avatar), project title + contextual status line top-left, floating undo/zoom toolbar, bottom-left 2D↔3D + grid/snap/fullscreen controls, bottom-right contextual readout chip (orbit/zoom, scale/grid, or snap mode).

**Visual language:** Space Grotesk (UI) + IBM Plex Mono (numeric readouts/chips), navy `#0F1B3D` / `#0C1430`, teal-cyan accent `#5EEAD4`→`#0EA5E9`, light blue-grey canvas `#F3F6FA` with grid lines, warm beige/terracotta room rendering, pill-shaped chips, big soft shadows.

## Done: Phases 0–3 (verified headless end-to-end 2026-07-10 — all four lenses match the mockups, 121 unit tests + Biome clean)

- **Phase 0 — Foundation:** design tokens in `src/styles.css`, planner route at `/`, view-mode state (`ViewMode` in `src/lib/view-mode.ts`: `"3d" | "2d" | "draw" | "objects"`, named after screens 1a–1d).
- **Phase 1 — App shell & chrome:** nav rail, header + contextual status line, floating undo/zoom toolbar, 2D|3D pill + grid/snap/fullscreen group, bottom-right readout chip, cm/m units toggle. On screen 1d the left chrome shifts to `left:404px` to clear the objects panel.
- **Phase 2 — Room model & both lenses:** rendering-agnostic geometry model (`src/lib/model/`), sample living-room fixture measured from the mockups (6.40 × 5.20 m → computed 33.28 m²), one R3F canvas with an animated dolly-zoom 2D↔3D camera handoff, warm 3D dollhouse with camera-facing wall cutaway, architectural 2D plan (door arc, window symbol, dimension lines, area card), 3D selection with rotate/duplicate/delete chip.
- **Phase 3 — Editing flows:** draw mode (corner placement, 90°/axis snapping with guides + chips, per-segment length pills, inline length input, ⏎-close into the model, cm/m everywhere) and the objects panel (24-item catalog, search + category chips, pointer-drag onto the floor with ghost + wall-snap guides, drop inserts real furniture).

Per-task implementation notes live in the git history (one commit per task).

## Phase 4 — Editing depth & persistence

Ordered by value; re-order freely if a dependency argues for it.

- [x] **Drag-to-move placed furniture** (3D lens first, like selection was): pointer-drag a selected item across the floor reusing `snapPlacement`'s quantize / outline clamp / wall-flush snap + guide pills; selection chip follows live; esc during the drag restores the original position. Watch the R3F drag-vs-orbit guard (`event.delta`).
- [x] **Selection & manipulation in the 2D lens:** picking on plan footprints, hover/selected styling that suits the plan look, the same chip (rotate/duplicate/delete + dimensions) — selection id already survives lens switches, so lift it out of `PlannerCanvas` only if this task needs it elsewhere. Landed with drag-to-move too, via the move-drag session extracted from the 3D lens (`src/components/move-drag.tsx`).
- [ ] **Undo/redo history:** wire the toolbar buttons + ⌘Z/⇧⌘Z to a bounded snapshot stack over the room model (plain data — snapshot per mutation: add/move/rotate/duplicate/delete, outline close). Redo stays dimmed until an undo happens (mockup 1a shows it dimmed).
- [x] **Persistence:** the model is already plain JSON — autosave to localStorage on mutation, hydrate on load, and make the header's "saved just now" real (it's fake copy today). Include unit + room name; a "new room" escape hatch clears it. Landed as `src/lib/persistence.ts` (versioned payload, paranoid deserialize — malformed saves hydrate as "no save"); the route hydrates post-mount (SSR has no localStorage) and skips re-saving what it just loaded so reloads keep the honest saved-at time; "New room" (header status row) confirms, clears to an empty outline, and drops into draw mode.
- [ ] **Door & window placement tools:** add/move openings — click a wall to insert, drag along it with offset snapping + distance-to-corner readouts, flip a door's hinge, delete. Opening heights stay `room-scene.ts` constants until a properties panel exists.
- [ ] **Edit an existing outline:** reopen the current room in draw mode with draggable corners (same quantize/guides), *without* the current close-behavior of clearing openings/furniture — re-anchor openings to their walls and keep furniture that still fits.
- [ ] **Draw tool stack, rest of it:** rect tool (two clicks → rectangular outline); then implement or delete the polygon/split stubs — inert buttons shouldn't survive the phase.
- [ ] **Grid / snap / fullscreen buttons do something:** grid toggles the in-scene drei `<Grid>`, snap disables draw quantize/axis-lock and placement wall-snap, fullscreen requests browser fullscreen on the workspace; toggles live in view state (they're hardcoded-lit today).
- [ ] **Object-to-object snapping:** the objects-panel footer already promises "snaps to walls and other objects" — flush/edge-align guides between the ghost (and later, dragged furniture) and placed items, same pill style as the wall guides.
- [ ] **Wall-mounted items:** picture frame / wall clock currently drop as thin standing boxes — model a wall-mount placement (host wall + offset + height), snap to walls during drag, render on the wall in both lenses.
- [ ] **Collision awareness:** placement clamps to the outline but rotate/duplicate bypass it (rotating the 2.2 m desk near a wall pokes through). Keep footprints inside the outline on every mutation; tint overlapping footprints as a warning rather than hard-blocking.
- [ ] **Richer furniture meshes:** replace the box placeholders with simple composed primitives per catalog category (sofa back/arms, table legs, bed headboard, shelf boards…), colors/footprints still model-driven.

**Deliberately not planned:** Dashboard/Settings destinations, multi-room floors, material/texture pickers, export (PNG/PDF), mobile layout. Revisit after Phase 4.

## Conventions (everything builds on these)

- **All model lengths are meters**; cm/m is display-only (`src/lib/units.ts`). Furniture `rotation` is degrees CCW about the footprint center. Points are 2D plan coords — origin at the sample room's top-left, x right, y down — with heights as separate scalars; outlines wound clockwise (helpers tolerate either winding).
- **Walls are derived, never stored** (`wallsOf(outline)`); `Opening.wallIndex` indexes that derivation, plus `offset` along the wall, `width`, and optional `hinge` for the door swing. Wall/opening heights aren't modeled — they're mockup-measured constants in `src/lib/room-scene.ts` (wall 2.5 m × 0.1 thick, door head 2.05, window sill 0.36 / head 1.94).
- **Lib/component split everywhere:** pure math in `src/lib/*` with vitest coverage; rendering/interaction in `src/components/*`. The model stays renderer-agnostic (an SVG fallback for the 2D lens remains possible).
- **One R3F canvas** (`src/components/planner-canvas.tsx`), lazy-loaded client-only so three never runs during SSR. Both cameras stay mounted; drei `makeDefault` flips ortho↔perspective on the planView split (`"2d"`/`"draw"` ↔ `"3d"`/`"objects"`). The 2D↔3D switch is a ~600 ms dolly-zoom to a matched top-down endpoint before swapping to true ortho; scene presentation (`PlanScene` / `RoomScene` / `DrawScene`) switches on the same lagged `renderPlan` state, so the warm room stays up mid-flight.
- **Mockup numbers are sample data, never artwork:** 33.28 m² comes from `floorArea()`, the search placeholder counts real catalog items, selection readouts compute from footprints. The sample fixture was measured off the mockup canvases (110 px/m on 1b, 100 px/m on 1a). Known mockup inconsistencies deliberately not honored: 1a's chip text for the desk chair, 1d's guides-to-far-walls (we guide to nearest), decorative wall-art ticks.

## Gotchas (each cost real debugging time)

- drei `<Line>`: default alpha-to-coverage makes stroke quads resolve as opaque rectangles on this GPU stack — every plan stroke sets `alphaToCoverage={false}`, and dashes are pre-chopped into segments (`dashedPolyline`) because the dashed material misrenders the same way.
- drei `<Outlines>` renders nothing under drei 10 / three r185 (its `screenspace` mode explodes into a screen-filling hull) — the selection highlight is a hand-rolled inverted hull (same geometry +2 cm rim, cyan `meshBasicMaterial`, `side={BackSide}`).
- R3F pointer guards: only events whose DOM target is the actual `<canvas>` may deselect or place (drei `<Html>` clicks arrive as "pointer missed" / raycast through to the plane), and clicks that travelled > 4 px are orbit drags or pans, not clicks.
- The plan camera's straight-down pose reads as polar 90° in OrbitControls' up-relative frame — don't clamp `maxPolarAngle` in plan view; and exactly-0 polar degenerates `lookAt`, use 0.01.
- The objects drag never enters R3F's event system (pointer went down on DOM) — the ghost raycasts window pointermoves onto the y=0 plane manually. Wall-snap tolerance there is world-space (0.3 m): screen-px tolerance is depth-dependent under a perspective camera (draw mode's ortho snapping *is* screen-px based).
- Only furniture raycasts in the 3D scene (walls/platform/dressing set `raycast={() => null}`) — that's what makes furniture clickable behind visible walls.
- OrbitControls' `enabled` prop flushes too late to stop a gesture that begins on the same pointerdown (it eats the first pointermoves as orbit — the camera visibly drifts ~2°). The furniture move drag disables the controls *instance* synchronously in its pointerdown handler (`makeDefault` publishes it as `state.controls`); the prop only holds the steady state.
- Textures are module-cached CanvasTextures — safe only because the canvas module is lazy-loaded client-only.
- Browser verification: headless script with real `page.mouse` input (per CLAUDE.md — the MCP browser hangs on inactive macOS sessions, and synthetic PointerEvents make OrbitControls throw `NotFoundError`). Benign console noise: a `THREE.Clock` deprecation warning (drei 10 + r185), and `data-tsd-source` errors after HMR updates only — fresh loads are clean.

## History

- 2026-07-09: Mockups imported from claude.ai/design project `20be5088-…` into `design/`; upstream rename to PlanForge, AI command-bar dropped from scope; `design/planforge-mockups.html` is self-contained (canvases fixed 1920×1080 — the real app is responsive-ish, min desktop).
- 2026-07-09: Phases 2–4 replanned from "static canvas mimics" to a real geometry model rendered by react-three-fiber in both lenses — one scene graph, one raycaster, one coordinate space; the 2D plan is the same scene under a top-down ortho camera. This directly serves the product hinge: one model, instant lens switch.
- 2026-07-10: Phases 0–3 complete and verified end-to-end; Phase 4 planned (this task list), per-task notes compacted into the sections above (full detail in git history).
