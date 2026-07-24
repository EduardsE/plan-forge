# Window pane grid — design

Date: 2026-07-24
Status: approved

## Goal

Let the user set how many panes a window's frame divides into — independent
columns × rows per window — from the inspector. Today every window renders a
hard-coded 2×2 (one vertical + one horizontal muntin). Width, height, and
elevation are already editable and stay as they are; this feature adds only
the pane grid.

Decided in brainstorming:

- Independent columns × rows (e.g. 3×2, 1×3, 4×4), not square-only presets.
- Explicit per-window setting stored on the opening; the grid does not
  recompute when the window is resized.
- Default stays 2×2; absent fields mean the current look, so existing saves
  and the seed apartment render unchanged.

## Data model

`Opening` (`src/lib/model/types.ts`) gains two optional fields:

```ts
paneCols?: number; // windows only; absent = 2
paneRows?: number; // windows only; absent = 2
```

New constants in `src/lib/model/openings.ts`:

- `DEFAULT_PANE_COLS = 2`
- `DEFAULT_PANE_ROWS = 2`
- `MAX_PANE_DIVISIONS = 8` (min is 1)

A resolver `openingPaneGrid(opening): { cols: number; rows: number }`
mirrors `openingVerticals()`: returns stored values or defaults. The fields
are only meaningful for `kind === "window"`; doors never set them and
rendering ignores them for doors.

## Setter and wiring

`setOpeningPaneGrid(floor, openingId, grid: { cols?: number; rows?: number })`
in `src/lib/model/openings.ts`, modeled on `setOpeningSillOverhang`:

- Round each provided value to an integer, clamp to 1..8.
- Store `undefined` when a value equals its default (non-defaults-only
  storage convention).
- Return the same floor reference when nothing changes (no-op contract).
- Finish through `reconcileFloor`.

Wire in `src/routes/index.tsx` alongside the other opening setters via
`commitActiveFloor`, so each change is a single undo step. No changes to
history (`src/lib/history.ts`) — snapshots are whole plain-data buildings.

## 3D rendering

- `WallHole` (`src/lib/room-scene.ts`) carries `paneCols`/`paneRows`;
  `cutHole()` resolves them via `openingPaneGrid` for windows.
- `windowBars()` (`src/components/room-scene.tsx`) replaces its two
  hard-coded `muntin-v`/`muntin-h` bars with loops: `cols − 1` vertical bars
  evenly spaced across the inner width (inside the 0.09 m border frame) and
  `rows − 1` horizontal bars across the inner height. Bar thickness stays
  0.06 m; depths stay as today (`windowUnitDepth`, frame depth + 0.02).
- 1×1 produces a clean undivided frame (no muntins).
- The glass remains a single quad with the existing pane shader; muntins are
  opaque bars in front of it, as now.
- The shadow-proxy bars in `WallMesh` consume the same `windowBars()`
  output, so sun shadows match the visible frame automatically.
- Tall and stacked seed windows keep their current look (absent fields
  resolve to 2×2).

## 2D

No changes. The plan symbol is a schematic top-down cut where muntins are
not meaningful; the 2D chip keeps its existing width field only.

## Inspector UI

In `OpeningSection` (`src/components/inspector.tsx`), windows only, a new
**PANES** section between TRANSFORM and SILL: two fields, `COLS` and `ROWS`,
using the existing `Field` component (commit on blur/Enter, Esc reverts) but
parsing plain integers instead of lengths. Invalid input reverts; values
clamp to 1..8. Doors show no PANES section.

## Persistence

`areOpenings()` in `src/lib/persistence.ts` accepts optional `paneCols` /
`paneRows`: integers in 1..8, valid only when `kind === "window"` — the
same kind cross-check the existing `sillOverhang`/`sillMaterial`
validation performs. No `STORAGE_VERSION` bump — absent fields mean 2×2, so all
existing saves in versions {6, 7} load unchanged.

## Testing and verification

- Vitest: `setOpeningPaneGrid` — clamping (0 → 1, 12 → 8, fractions round),
  default-elision (setting 2 stores `undefined`), no-op returns the same
  floor reference, undefined inputs leave the other axis untouched.
- Vitest: `openingPaneGrid` resolver defaults; `areOpenings` accepts valid
  pane fields and rejects out-of-range or non-integer values.
- Headless Playwright (project verify setup): select a window, set 4×4 via
  the inspector, screenshot the 3D view; also confirm a 1×1 window shows no
  muntins.

## Accepted edge case

A minimum-width (0.3 m) window at 8 columns yields panes narrower than the
0.06 m bars, which visually merge into a slab. Geometrically harmless; no
width-dependent clamp.
