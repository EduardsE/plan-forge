# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What we're building: PlanForge

A web-based room planner with a split personality by design: cool, futuristic chrome around a warm, cozy room. The UI shell is dark navy + near-white with a cyan/teal accent, frosted-glass floating panels, thin line icons, and a faint blueprint grid on the workspace. The room itself is deliberately the opposite — beige plank floor, warm-white walls, wood/terracotta furniture, soft window light — so the user's content always feels inviting against the precise tooling.

It's one room, three lenses, all inside the same shell (navy icon rail, floating undo/zoom toolbar, 2D|3D pill, status chips). Mockup screen numbers in parentheses:

- **Draw (1c)** is where a room is born — you click corners on the grid, walls get live editable length labels, snapping keeps everything at 90°. Output: a dimensioned outline.
- **2D plan (1b)** is the analytical lens on that outline — architectural wall strokes, labeled furniture footprints, dimension lines, floor area. Best for precise arranging.
- **3D dollhouse (1a)** is the experiential lens — same room, orbitable, furnished, with in-scene selection (chip with rotate/duplicate/delete + size readout).
- **Objects (1d)** is the furnishing flow that works over either lens — catalog panel slides out from the rail, cards drag onto the floor, ghost footprint + alignment guides show snap distances to walls before you drop.

The 2D|3D pill is the hinge of the whole product: one model, instant lens switch, identical chrome so nothing about the tooling changes when the view does.

**Before starting any implementation work, read `PROGRESS.md`** — it holds the task breakdown and what's done so far. Work on one task at a time and check it off there. The source mockups live at `design/planforge-mockups.html` (screenshots: `design/screen-*.png`).

## Commands

Use pnpm (a pnpm-lock.yaml is committed).

- `pnpm dev` — start dev server on port 3000
- `pnpm build` — production build
- `pnpm test` — run tests with Vitest (`pnpm vitest run <file>` for a single file)
- `pnpm check` — Biome lint + format check (also `pnpm lint`, `pnpm format`)
- `pnpm generate-routes` — regenerate the route tree (`tsr generate`); the dev server also does this automatically

Add shadcn/ui components with the latest shadcn CLI:

```bash
pnpm dlx shadcn@latest add button
```

## Architecture

TanStack Start app (full-stack React with SSR) built on Vite, React 19, TanStack Router, and Tailwind CSS v4.

- **File-based routing**: routes live in `src/routes/`. Adding a file there creates a route; TanStack scaffolds the file content automatically. `src/routeTree.gen.ts` is generated — never edit it (Biome ignores it too).
- **Root layout**: `src/routes/__root.tsx` defines the HTML shell (`shellComponent`), head metadata, and global devtools. Content shared across all routes goes here.
- **Router setup**: `src/router.tsx` creates the router and registers its type with `@tanstack/react-router`.
- **Server code**: use `createServerFn` from `@tanstack/react-start` for server functions, or the `server.handlers` property on a route for API routes. Route `loader`s handle pre-render data fetching.
- **Path alias**: import from `#/*` which maps to `./src/*` (e.g. `#/lib/utils`). `@/*` also resolves but shadcn config uses `#/`.
- **Styling**: Tailwind v4 via the Vite plugin — no tailwind.config file; theme/config lives in `src/styles.css`. shadcn/ui uses the new-york style, zinc base color, CSS variables, and lucide-react icons; the `cn()` helper is in `src/lib/utils.ts`.

## Code style

Biome enforces formatting: tab indentation, double quotes. Run `pnpm check` before committing. Biome only covers `src/`, `vite.config.ts`, `index.html`, and `.vscode/` — and skips `src/routeTree.gen.ts` and `src/styles.css`.


## Instructions
- Do not invoke superpowers skills automatically. Only use superpowers:* skills when I explicitly ask for them by name.
- After completing a task, commit the changes with a descriptive message. Always commit, regardless of whether the current branch is `main` or another branch, and do not branch first. Stage and commit only the files changed for the task at hand — never sweep in pre-existing or unrelated changes. Commit locally only; do not push unless asked.