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
- [x] Client-side view state stub (which panel/mode is active) — plain React state, just enough to switch chrome between the 4 screen states

## Phase 1 — App shell & shared chrome

- [x] Nav rail: logo tile, nav items with active state (glow border + teal tint), settings + avatar pinned bottom
- [x] Header block: project title + status dot/line (contextual text per mode)
- [x] Floating toolbar: undo/redo, zoom in/out, fit-to-view
- [x] Bottom-left controls: 2D/3D segmented toggle + grid/snap/fullscreen button group
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
- 2026-07-09: View state stub added in `src/routes/index.tsx`: a `ViewMode` union (`"3d" | "2d" | "draw" | "objects"`, named after the mockup screens 1a–1d) held in local `useState`, defaulting to `"3d"` (the mockup labels 1a as "Main planner"). No setter wired up yet — Phase 1 chrome (nav rail, 2D/3D pill) will consume and mutate it when it lands. Deliberately plain `useState`, not context/store, since it's a single-component stub for now.
- 2026-07-09: Header block landed (`src/components/workspace-header.tsx`), rendered inside the now-`relative` `.workspace-canvas` (absolute `left-10 top-8`, matching the mockup's `left:40px;top:32px`). "PlanForge" title + a status line whose dot color/glow and text switch on `ViewMode`, keyed from the four mockup screens: 3d/2d → green `#34d399` "Loft apartment — draft · saved just now"; draw → amber `#f59e0b` "Drawing room outline — 4 corners placed"; objects → cyan `#22d3ee` "Placing "Sofa · 2-seat" — drop to confirm". Dot colors kept as inline hex (only cyan exists as a token, `--accent-cyan`); green/amber aren't in the palette and reading as one-off chrome, they weren't promoted to tokens. Consumes the same `viewMode` state the nav rail mutates — no new wiring. Static-only, no test added (nav-rail's test covers the interactive-state pattern; this is a pure data→markup map).
- 2026-07-09: Nav rail landed (`src/components/nav-rail.tsx`). `ViewMode` moved out of `src/routes/index.tsx` into `src/lib/view-mode.ts` so the rail could import it. Active-item mapping (derived from which item is glowing on each of the 4 mockup screens): Draw→`"draw"`, Furnish→`"3d"`, Objects→`"objects"`, Views→`"2d"`; Dashboard/Settings are inert until later phases give them real destinations. First component test in the repo — added `vitest.config.ts` (jsdom) since `@testing-library/react`/`jsdom` were devDependencies but unwired. Design spec: `docs/superpowers/specs/2026-07-09-nav-rail-design.md`; plan: `docs/superpowers/plans/2026-07-09-nav-rail.md`.
- 2026-07-09: Bottom-left view controls landed (`src/components/view-controls.tsx`), rendered inside `.workspace-canvas` at `left-10 bottom-10` (mockup `left:40px;bottom:40px`). Two frosted-glass pills: a segmented 2D|3D toggle and a grid/snap/fullscreen button group. Unlike the floating toolbar, these appear on all four mockup screens (1a–1d), so the route renders them unconditionally — this is also why 3D can read active in objects mode. Active-segment decision (from which segment glows per mockup screen): 2D is active for `"2d"` and `"draw"` (draw is the top-down 2D lens, screen 1c); 3D is active for `"3d"` and `"objects"` (screen 1d shows furniture placed onto the 3D dollhouse) — verbatim from the mockups, not inferred. The 2D|3D pill is the only interactive Phase 1 chrome: it reads/mutates the shared `viewMode` via `viewMode`/`onSelectMode` props (same wiring pattern as NavRail); clicking 2D→`"2d"`, 3D→`"3d"`, with `aria-pressed` reflecting the active segment. Grid (`Grid2x2`) and snap/magnet (`Magnet`) are rendered persistently toggled-on (teal-deep on `rgba(45,212,207,.14)` tint) because the mockup shows them lit on every screen; fullscreen (`Maximize`) is a plain action button — all three are no-op stubs until Phase 4. lucide icons mapped from the mockup's inline SVG paths (2×2-quadrant grid → `Grid2x2`, vertical horseshoe → `Magnet`, four corner brackets → `Maximize`). Glass surface reuses `--surface-glass`/`--border-subtle`/`--shadow-md`; the active-segment gradient (`--accent-cyan`→`--accent-teal`) and its glow / the grid-snap tint are one-off inline values (not in the token set). Not matched: the mockup shifts the whole group to `left:404px` on 1d to clear the objects panel — deferred to Phase 3 when that panel exists. Component test (`view-controls.test.tsx`) asserts the per-mode active segment across all four modes and that clicking each segment calls the setter with the right mode.
- 2026-07-09: Floating toolbar landed (`src/components/floating-toolbar.tsx`), rendered inside `.workspace-canvas` at `left-10 top-[116px]`, matching the mockup's `left:40px;top:116px` position directly under the header. Grepped `design/planforge-mockups.html` for the toolbar markup (present, byte-identical, on screens 1a/1b/1c; absent on 1d where the objects panel occupies that spot) — so the route only renders it when `viewMode !== "objects"`. Six buttons: Undo, Redo (disabled, matching the mockup's dimmed `#B6C2D9` state), a divider, then Zoom in / Zoom out / Fit-to-view. Icon choices mapped from the mockup's inline SVG paths to the closest lucide-react equivalents: `Undo2`/`Redo2` for the curved arrows, `ZoomIn`/`ZoomOut` for the magnifying-glass +/− glyphs, and `Crosshair` for the fit-to-view target icon (circle + 4 gapped tick marks — matches the mockup path exactly, closer than `Maximize`/`Scan`). Frosted background, border, and shadow reuse existing tokens (`--surface-glass`, `--border-subtle`, `--shadow-md`) rather than new ones — all three already matched the mockup's inline values exactly. Phase 1 scope: every button has a no-op `onClick`; Redo is the only one disabled (per mockup), the rest have no logic gating them yet — real undo/redo history and viewport zoom land in Phase 4. No test added (no interactive state to assert — same reasoning as `workspace-header.tsx`).
