# PlanForge — implementation progress

Implementation of PlanForge from the design mockups (product context: see "What we're building" in `CLAUDE.md`) (`design/planforge-mockups.html` — open it in a browser to see all 4 screens side by side; screenshots in `design/screen-*.png`).

**How to use this file:** work on ONE task at a time, in order. Check off items as they land. Each task is sized to fit comfortably in a single Claude session. Static UI first — no editor logic (state machines, hit-testing, real geometry) until Phase 4.

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

## Phase 0 — Foundation

- [x] Design tokens in `src/styles.css`: color palette, fonts (Space Grotesk, IBM Plex Mono via fontsource or Google Fonts link in `__root.tsx`), radii, shadows
- [x] Planner route (decide: `/` or `/planner`) rendering an empty full-viewport workspace with the grid background
- [ ] Client-side view state stub (which panel/mode is active) — plain React state, just enough to switch chrome between the 4 screen states

## Phase 1 — App shell & shared chrome

- [ ] Nav rail: logo tile, nav items with active state (glow border + teal tint), settings + avatar pinned bottom
- [ ] Header block: project title + status dot/line (contextual text per mode)
- [ ] Floating toolbar: undo/redo, zoom in/out, fit-to-view
- [ ] Bottom-left controls: 2D/3D segmented toggle + grid/snap/fullscreen button group
- [ ] Bottom-right readout chip (mono font, contextual text)
- [ ] Units toggle (cm/m pill, top-right — shown in draw mode)

## Phase 2 — Canvas views (static renders matching the mockups)

- [ ] 2D floor plan (screen 1b): wall outlines, door swing arc, window, furniture footprint rectangles with labels, external dimension lines (6.40 m / 5.20 m), room label card ("Living room · 33.28 m²") — SVG
- [ ] 3D dollhouse view (screen 1a): isometric floor slab, two walls, window/door/wall-art, furniture blocks, plant, rug — the mockup does this with CSS transforms/SVG; decide SVG vs CSS-3D vs a real canvas lib **before** starting (this choice shapes Phase 4)
- [ ] Selection UI on 3D view: selected-object highlight, name chip, floating context toolbar (rotate / duplicate / delete / dimensions readout)

## Phase 3 — Mode-specific UI

- [ ] Draw mode (screen 1c): left tool stack (select/wall/rect/polygon/split), corner dots, drawn segments, per-segment length labels, active inline length input, dashed snap guide + "snap · aligned with start" chip, 90° angle badge, bottom helper hint bar ("Click to place corner · ⏎ close room · esc cancel")
- [ ] Objects panel (screen 1d): floating card panel with search field, category chips, 2-col item grid (thumbnail, name, dimensions), "placing…" placeholder card state, footer hint; plus drag-ghost card and green footprint ghost on canvas

## Phase 4 — Behavior (scope later, task by task)

Not planned in detail yet — break down when we get here. Candidates: view-mode state machine, pan/zoom, real room geometry model, wall drawing with snapping, object placement/selection/manipulation, undo/redo, persistence.

## Notes / decisions

- 2026-07-09: Mockups imported from claude.ai/design project `20be5088-…` into `design/`. The two pasted reference PNGs in the design project were truncated by the API download cap and were discarded; the HTML mockup is self-contained.
- 2026-07-09: Designs updated upstream: renamed to PlanForge, AI assistant command bar removed (out of scope — not doing it). Re-downloaded as `design/planforge-mockups.html` and regenerated all screenshots.
- Mockup canvases are 1920×1080 fixed; the real app should be responsive-ish (min desktop) — fixed sizes only inside the canvas scene.
- 2026-07-09: Design tokens landed in `src/styles.css`, values pulled from `design/planforge-mockups.html` (hex frequency scan, not guessed). Two token families: `--navy-*`/`--accent-*` (cool chrome) and `--room-*` (warm room base — Phase 2 3D rendering will likely need more one-off shading values beyond these). Fonts loaded via Google Fonts `<link>` in `__root.tsx` (no fontsource dep added). shadcn's `--background`/`--primary`/etc. vars are mapped onto the PlanForge palette so default shadcn components pick up the branding automatically. `styles.css` is Biome-excluded per CLAUDE.md, so it isn't tab/double-quote formatted.
- 2026-07-09: Planner route landed at `/` (not `/planner`) — PlanForge is single-purpose, no dashboard competing for the root path yet. The mockup workspace background (base `--canvas` color + radial highlight + 160px/32px major/minor grid layers) is a `.workspace-canvas` class in `src/styles.css` rather than Tailwind utilities, since the 5-layer `background-image`/`background-size` combo isn't expressible cleanly as utility classes. Design spec: `docs/superpowers/specs/2026-07-09-planner-route-design.md`; plan: `docs/superpowers/plans/2026-07-09-planner-route.md`.
