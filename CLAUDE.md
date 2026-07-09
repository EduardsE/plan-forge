# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
