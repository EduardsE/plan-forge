# PlanForge

PlanForge is a browser-based room planner. You draw a room by clicking its corners on a grid — walls snap to 90°, every segment carries a live editable length label — then furnish it and study it through two lenses on the same model: an architectural **2D plan** (wall strokes, door arcs and window symbols, dimension lines, floor area) and an orbitable **3D dollhouse**. Switching lenses is one flat 2D|3D toggle; nothing about the tooling changes when the view does.

Furniture is dragged out of a docked catalog onto the floor or the plan, with a ghost footprint and distance pills showing snaps to walls and to neighbouring objects before you drop. Doors and windows insert onto walls and slide along them. Everything is undoable, and the room persists to `localStorage`, so a reload picks up where you left off. The shell is deliberately quiet — white and warm-off-white surfaces, hairline borders, one blue accent — so the warm room you are planning is the only colourful thing on screen.

**[Live demo](https://eduardse.github.io/plan-forge/)**

## Video showcase

![PlanForge — drawing, furnishing and orbiting a two-storey plan](docs/media/planforge.gif)

## Development

```bash
pnpm install
pnpm dev      # dev server on port 3005
pnpm test     # run the Vitest suite
pnpm build    # production build
pnpm check    # Biome lint + format check
```
