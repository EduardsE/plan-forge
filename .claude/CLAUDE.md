# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What we're building: PlanForge

A web-based room planner in the **"Paper" design language** (2026-07-11 redesign, mockups 2b/2d + ground treatment 3d): a light, Stripe/Apple-style shell — white and warm-off-white surfaces (`#FFFFFF`/`#FBFBFA`), hairline borders (`#ECECE8`/`#E7E7E2`), warm-grey ink text (`#1A1A17`→`#9A9A92`), one restrained blue accent `#3A5BF0`, 8-pt spacing, refined small shadows. **No gradients, glows, or frosted glass** (the only gradient allowed is the logo tile). The room being planned stays deliberately warm — beige plank floor, warm-white walls, wood/terracotta furniture, soft window light — so the user's content feels inviting against the precise tooling.

The shell is a fixed three-zone grid, not floating panels: 64px icon rail (left) · 56px header (breadcrumb + saved chip, centered 2D|3D flat segmented switch, undo/redo, Present) · 320px inspector (right; selection transform/material/arrange at high density, room stats footer) · 38px status bar (area, snap/grid state, camera readout). One room, three lenses inside that shell:

- **Draw (1c)** is where a room is born — you click corners on the grid, walls get live editable length labels, snapping keeps everything at 90°. Output: a dimensioned outline.
- **2D plan (1b)** is the analytical lens on that outline — architectural wall strokes, labeled furniture footprints, dimension lines, floor area. Best for precise arranging.
- **3D dollhouse (1a)** is the experiential lens — same room, orbitable, furnished. The canvas under it is a **studio spotlight pool** (mockup 3d): plain `#EDEDEA`, a soft radial light pool behind the model, a dark contact shadow grounding the room — no grid. The 2D/draw canvas is paper `#F1F1ED` with a faint dot grid instead.
- **Objects (2d)** is the furnishing flow — a 306px library column docks between rail and canvas (inspector yields), cards drag onto the floor, blue dashed ghost footprint + guide lines with distance pills show snaps before you drop.

The 2D|3D switch is the hinge of the whole product: one model, instant lens switch, identical chrome so nothing about the tooling changes when the view does.

**Before starting any implementation work, read `PROGRESS.md`** — it holds the task breakdown and what's done so far. Work on one task at a time and check it off there. The source mockups live at `design/planforge-mockups.html` (redesign references: `design/screen-2b-paper-light.png`, `design/screen-2d-paper-objects.png`, `design/screen-3d-studio-pool.png`; the older screen-1* shots still define the *flows*, not the look).

## Commands

Use pnpm (a pnpm-lock.yaml is committed).

- `pnpm dev` — start dev server on port 3005
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
- Run Playwright browser verification headless: write a script that launches its own browser (`chromium.launch({ headless: true, channel: "chrome" })`, e.g. importing playwright-core from the Playwright MCP's npx cache) and drives the flow with real `page.mouse` input. The Playwright MCP browser is headed — its screenshots hang whenever the macOS user session is inactive — so don't rely on it for verification. If the MCP browser does get used, close it (`browser_close`) before finishing the session — a leftover Chrome holds the profile lock and blocks the next session's browser tools.