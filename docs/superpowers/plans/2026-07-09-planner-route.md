# Planner Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` render an empty, full-viewport workspace showing the mockups' blueprint grid background, with no chrome or logic yet.

**Architecture:** One CSS class (`.workspace-canvas`) added to `src/styles.css` carrying the mockup's exact layered background (base color + radial highlight + major/minor grid line layers), applied to a single full-viewport `<div>` in `src/routes/index.tsx`, replacing the TanStack Start boilerplate currently there.

**Tech Stack:** TanStack Start / React 19 route file, plain CSS (Tailwind v4 can't express a 5-layer `background-image`/`background-size` combo as utilities).

## Global Constraints

- Route path is `/` (existing `src/routes/index.tsx`), not `/planner` — decided in the spec.
- Background values must match `design/planforge-mockups.html` exactly: base `--canvas` (`#f3f6fa`), radial highlight `radial-gradient(1000px 760px at 55% 46%, rgba(255,255,255,.9), rgba(255,255,255,0) 72%)`, major grid every 160px at `--canvas-grid-major`, minor grid every 32px at `--canvas-grid-minor`.
- No chrome (nav rail, toolbars, panels) — Phase 1+. No interactivity or state — Phase 4+.
- `src/styles.css` is Biome-excluded (per `CLAUDE.md`) — match its existing 2-space-indent style, don't run Biome format on it.
- This is a purely visual/static change — no business logic exists to unit test (`pnpm test` has no spec files today and none are needed here). Verification is visual, via `pnpm dev`.

---

### Task 1: Workspace background class + route

**Files:**
- Modify: `src/styles.css:156` (insert new rule directly after the `body { ... }` block, before `@layer base`)
- Modify: `src/routes/index.tsx` (replace entire file contents)

**Interfaces:**
- Produces: CSS class `.workspace-canvas` — applied via `className` on a `div`, no props/JS API. Later phases (chrome, canvas rendering) will nest content inside this div; nothing about its internals needs to be consumed programmatically.

- [ ] **Step 1: Add the `.workspace-canvas` rule to `src/styles.css`**

Insert this immediately after the existing `body { ... }` rule (currently ending at line 156) and before `@layer base {`:

```css
.workspace-canvas {
  height: 100vh;
  width: 100vw;
  background-color: var(--canvas);
  background-image:
    radial-gradient(1000px 760px at 55% 46%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 72%),
    linear-gradient(var(--canvas-grid-major) 1px, transparent 1px),
    linear-gradient(90deg, var(--canvas-grid-major) 1px, transparent 1px),
    linear-gradient(var(--canvas-grid-minor) 1px, transparent 1px),
    linear-gradient(90deg, var(--canvas-grid-minor) 1px, transparent 1px);
  background-size:
    100% 100%,
    160px 160px,
    160px 160px,
    32px 32px,
    32px 32px;
}
```

- [ ] **Step 2: Replace `src/routes/index.tsx` with the workspace route**

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Planner })

function Planner() {
  return <div className="workspace-canvas" />
}
```

- [ ] **Step 3: Start the dev server and visually verify**

Run: `pnpm dev`

Open `http://localhost:3000/` in a browser. Expected: a full-viewport page (no scrollbars, no leftover boilerplate text) in the light blue-grey canvas color, with a visible two-tier grid (faint 32px minor lines, slightly stronger 160px major lines) and a soft brightness falloff toward the edges — matching the workspace background in `design/screen-1a-3d-hero.png` / `design/screen-1b-2d-floor-plan.png` (ignore the room/furniture content in those screenshots — only the empty grid backdrop is in scope here).

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Run lint/format check**

Run: `pnpm check`
Expected: passes with no errors (this only checks `src/`, `vite.config.ts`, `index.html`, `.vscode/`, and skips `styles.css`/`routeTree.gen.ts` per `CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/routes/index.tsx
git commit -m "$(cat <<'EOF'
Add full-viewport planner workspace route with blueprint grid background

Phase 0 foundation task: / now renders the empty workspace canvas
matching the mockups' grid background, ahead of chrome/canvas work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Check off the task in `PROGRESS.md`**

In `PROGRESS.md`, change:

```markdown
- [ ] Planner route (decide: `/` or `/planner`) rendering an empty full-viewport workspace with the grid background
```

to:

```markdown
- [x] Planner route (decide: `/` or `/planner`) rendering an empty full-viewport workspace with the grid background
```

Then commit:

```bash
git add PROGRESS.md
git commit -m "$(cat <<'EOF'
Check off planner route task in PROGRESS.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
