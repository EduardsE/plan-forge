---
name: verify
description: How to drive PlanForge headless for runtime verification — launch, seed state, and script real-mouse flows against the 3D/2D canvas.
---

# Verifying PlanForge changes in a real browser

## Launch

```bash
pnpm dev   # port 3005; poll http://localhost:3005/ until 200
```

## Browser

Headless Playwright per CLAUDE.md — do not use the (headed) Playwright MCP.
`playwright-core` lives in the MCP's npx cache:

```js
import { createRequire } from "node:module";
const require = createRequire("/Users/e2/.npm/_npx/9833c18b2d85bc59/node_modules/");
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
```

## Seeding a known floor

Skip UI setup by seeding the autosave before load (`page.addInitScript`):
key `planforge.room`, payload `{ version: 4, floor: { rooms: [...] }, unit: "m"|"cm", savedAt }`.
Room: `{ id, name, outline: [{x,y}...], openings: [], furniture: [...] }`;
furniture item: `{ id, catalogId, position: {x,y}, rotation, footprint: {width,depth,height} }`
(catalog ids in `src/lib/model/catalog.ts`, e.g. `wardrobe` is 1.0×0.6, H 2.0).
Deserialization is strict — any malformed field silently drops the whole save.

## Driving the 3D canvas

No DOM handles inside the canvas — compute pixel targets from the camera:

- Default view is 3D; initial orbit: polar 62°, azimuth 38°, target = floor
  bounds center at y=0, fov 42° (constants in `planner-canvas.tsx`). Initial
  radius is the perspective *fit distance*, not 10 — read it back from the
  readout zoom if it matters.
- Project world→pixel with standard lookAt + perspective math against the
  largest `<canvas>`'s bounding rect (rect ≈ x:64, y:56 at 1440×900).
- Status bar shows live truth: `orbit <azimuth>° / <polar>°` and the zoom
  pill %. Assert camera stillness by comparing that text.
- Item interactions need real mouse input: `page.mouse.down/move/up`.
  First click selects (inspector shows the item name); a press-drag on an
  *already selected* item moves it. Orbit by dragging empty canvas
  (vertical = polar, clamps at 87°; horizontal = azimuth).
- Read results from `localStorage.planforge.room` (autosave commits after
  pointerup) and from the inspector POS X/POS Y fields.

## Gotchas

- The readout only publishes on OrbitControls change events — a camera moved
  by anything else renders differently while the readout goes stale. For
  camera-motion bugs, temporarily mount a `useFrame` probe inside `<Canvas>`
  writing `window.__probe = { pos, target, enabled }` and sample it from the
  script (remove before commit).
- Kill the dev server when done: `lsof -ti :3005 | xargs kill`.
