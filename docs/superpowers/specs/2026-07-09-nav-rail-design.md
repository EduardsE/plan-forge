# Nav rail — design spec

Phase 1 task from `PROGRESS.md`: "Nav rail: logo tile, nav items with active state (glow border + teal tint), settings + avatar pinned bottom." Source of truth for visuals: the rail markup repeated across all 4 screens in `design/planforge-mockups.html` (lines ~29–59, ~220–250, ~345–373, ~483–511).

## Component

New `src/components/nav-rail.tsx` exporting `NavRail`:

```ts
interface NavRailProps {
  activeMode: ViewMode;
  onSelectMode: (mode: ViewMode) => void;
}
```

Rendered from `src/routes/index.tsx` next to the existing `.workspace-canvas` div, both inside a new `flex h-screen w-screen overflow-hidden` wrapper. `.workspace-canvas` changes from fixed `100vw`/`100vh` to `flex-1` (its CSS rule in `styles.css` switches to `height:100%;width:100%`).

## Shared `ViewMode` type

Currently declared inline in `src/routes/index.tsx`. Moves to `src/lib/view-mode.ts`:

```ts
export type ViewMode = "3d" | "2d" | "draw" | "objects";
```

Both `index.tsx` and `nav-rail.tsx` import it from there. `index.tsx` keeps the `useState<ViewMode>("3d")` but now also passes the setter down to `NavRail`.

## Rail contents (top → bottom)

1. **Logo tile** — 44×44px, `background: linear-gradient(135deg, var(--accent-from), var(--accent-to))`, `shadow-glow-accent`, `radius-md`ish (13px in mockup — use `--radius` or closest Tailwind radius). Icon: the cube/hexagon SVG path hand-copied verbatim from the mockup (`M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2L10 2.5z M3.5 6.2L10 10l6.5-3.8M10 10v7.5`, stroke `--accent-ink`). This is the brand mark — kept pixel-exact rather than swapped for a lucide icon.
2. **Six nav item buttons**, each a `<button type="button">`, 78px wide, icon (22×22, lucide, `stroke-width={1.5}`) + 10px label below:

   | Label | lucide icon | Maps to `ViewMode` |
   |---|---|---|
   | Dashboard | `LayoutGrid` | none (inert) |
   | Draw | `Pencil` | `"draw"` |
   | Furnish | `Sofa` | `"3d"` |
   | Objects | `Box` | `"objects"` |
   | Views | `Eye` | `"2d"` |
   | Settings | `SlidersHorizontal` | none (inert) |

   Mapping derived by inspecting which item carries the active-glow styling on each of the 4 mockup screens (1a 3D hero → Furnish active; 1b 2D plan → Views active; 1c Draw mode → Draw active; 1d Objects panel → Objects active).

   Buttons with a mapped mode: `onClick={() => onSelectMode(mode)}`, and get `aria-current="page"` plus active styling when `activeMode === mode`. Buttons with no mapping (Dashboard, Settings) render with no `onClick` and are never active — inert placeholders until a later phase gives them a real destination.

   Inactive style: `text-sidebar-foreground` (`--navy-200` equivalent, i.e. the mockup's `#7E93BE`).
   Active style: `text-sidebar-accent-foreground`, `bg-sidebar-accent`, plus a new glow-ring shadow (see Tokens below).

   Settings gets `mt-auto` (per mockup `margin-top:auto`), pinning it and everything after it to the bottom.
3. **Avatar** — 38×38 circle, decorative gradient placeholder (`linear-gradient(135deg, #e8b48a, #b4633e)` — a one-off value, not promoted to a shared token since nothing else reuses it yet), `box-shadow: 0 0 0 2px rgba(126,147,190,.35)`. No click behavior.

## New CSS token

`styles.css` already has every other rail-related value tokenized (`--shadow-rail`, `--shadow-glow-accent`, `--sidebar-accent`, `--accent-bright`, etc.) except the active-nav-item glow ring. Adding, next to the other shadow tokens:

```css
--shadow-glow-nav-active: 0 0 0 1px rgba(75, 227, 220, 0.28), 0 0 20px rgba(75, 227, 220, 0.18);
```

No other new tokens needed — logo tile, rail background/shadow, and active tint all already map to existing `--sidebar-*`/`--accent-*`/`--shadow-*` vars via the `@theme inline` block.

## Out of scope

- Dashboard/Settings/Views not having real pages/routes yet — they're chrome only until later phases.
- Any hover/focus-visible states beyond what Tailwind's defaults give buttons for free (mockup is a static render, doesn't show hover).
- Header block, floating toolbar, bottom-left/right controls, units toggle — separate Phase 1 checklist items.

## Testing

No automated test added — this is static chrome with one small piece of interactive state (click → `onSelectMode`). Verification is manual: run `pnpm dev`, confirm all 4 `activeMode` values highlight the correct nav item, and confirm clicking Draw/Furnish/Objects/Views updates the highlight live while Dashboard/Settings remain inert.
