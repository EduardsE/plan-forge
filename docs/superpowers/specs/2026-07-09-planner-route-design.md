# Planner route — design

Phase 0 task from `PROGRESS.md`: "Planner route (decide: `/` or `/planner`) rendering an empty full-viewport workspace with the grid background."

## Decision

The planner workspace lives at the root route `/` (existing `src/routes/index.tsx`), not a separate `/planner` path. PlanForge is single-purpose — there's no dashboard/landing page competing for `/` yet, and the mockups treat the workspace as the whole app.

## Scope

Replace the TanStack Start boilerplate content in `src/routes/index.tsx` with a full-viewport workspace container showing the blueprint grid background from the mockups. No chrome (nav rail, toolbars, panels) — that's Phase 1+. No interactivity, no state — that's Phase 4+. This task is purely: route exists, renders one div, full viewport, correct background.

## Background spec

Pulled directly from `design/planforge-mockups.html` (screens 1a/1b/1d workspace layer — 1c's draw-mode grid is tighter/mode-specific and out of scope here):

- Base color: `--canvas` (`#f3f6fa`)
- Soft radial highlight: `radial-gradient(1000px 760px at 55% 46%, rgba(255,255,255,.9), rgba(255,255,255,0) 72%)`
- Major grid lines every 160px, both axes, at `--canvas-grid-major` (`rgba(48,106,190,.10)`)
- Minor grid lines every 32px, both axes, at `--canvas-grid-minor` (`rgba(48,106,190,.05)`)

These tokens already exist in `src/styles.css` (added when design tokens landed). This task only adds the composed background as a CSS class, since a 5-layer `background-image`/`background-size` combo isn't expressible as clean Tailwind utilities.

## Implementation sketch

- Add a `.workspace-canvas` class to `src/styles.css` (near the existing canvas tokens) with the background-image/background-size stack above.
- Rewrite `src/routes/index.tsx`: keep the `createFileRoute('/')` scaffold, render a single `<div className="workspace-canvas h-screen w-screen">` (or equivalent) with no other content.
- No new dependencies, no new files beyond the two edits above.

## Out of scope (future phases)

- Nav rail, header, toolbars, chips (Phase 1)
- Actual 2D/3D canvas rendering (Phase 2)
- Draw mode's tighter grid variant (Phase 3)
- View-mode state (Phase 0's other checklist item, separate task)

## Testing

Visual only — no logic to unit test. Verify via `pnpm dev` that the route renders full-viewport with the grid visible and matches the mockup workspace background.
