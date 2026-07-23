# Multifloor: stacked storeys, stairs, ghost underlay — design

*2026-07-22. Settled with the product owner in a brainstorming session; supersedes the
Phase 7 deferral "no Z levels / stairs / multiple storeys (one floor plane)".*

## Problem

A plan is one `Floor` — a single planar wall graph on one z-plane. Real dwellings have
storeys: the owner wants to draw and furnish more than one level, see them stacked in
the 3D dollhouse, align upper walls with the walls below, and connect levels with
stairs.

## Scope decision (owner)

**Full vertical connectivity in one phase**, decomposed into session-sized tasks at
planning time:

1. Floor switcher — add/rename/delete storeys, edit one at a time.
2. Ghost underlay — the floor below shows faintly in the flat lenses and its walls are
   snap targets ("trace the storey below").
3. Stacked 3D dollhouse — storeys render physically stacked; the stack is sliced at the
   active floor (Sims rule).
4. Stairs — one straight-run stair object that auto-cuts a matching void in the slab
   above.

## Architecture decision

**`Building { floors: Floor[] }` — a list of independent wall graphs, elevation
derived.** Each storey keeps today's `Floor` model untouched; cross-floor concerns
(elevation, stacking, underlay, stair voids) are building-level derivations in new
pure modules. Chosen over:

- *One z-aware wall graph* (nodes gain a level, stairs are edges of a third kind):
  conceptually pure but churns every pure helper, test, and the face-extraction math
  for structures that genuinely are independent planar problems. All cost, no
  user-visible gain.
- *Separate documents per floor with a project switcher*: cheapest switcher, but
  stacked 3D, underlay, and stairs all need cross-floor geometry in one coordinate
  space — this shape fights all three.

This is the M1 trick again: existing helpers, snap paths, and scene components keep
their `Floor` signatures; the active-floor id threads at the route boundary.

## Data model

```ts
Building { floors: Floor[] }            // ordered ground-up; index 0 = ground floor

Floor {                                 // today's shape, plus:
  id: string                            //   stable identity (like Room.id was in M1)
  name?: string                         //   sparse; absent → display default by index
  stairs: Stair[]                       //   stairs rising FROM this floor
  ...nodes/edges/openings/furniture/rooms unchanged
}

Stair {
  id: string
  position: Point                       // footprint center, plan coords
  rotation: number                      // degrees CCW, furniture convention
  width: number                         // clamped [0.7, 2.0], default 0.9
}
```

- **Floor display names:** absent `name` renders "Ground floor", "Floor 2", "Floor 3"…
  by index. (`Floor.name` already exists in the model and is UI-unused today — it
  becomes the storey name.)
- **Stair run is derived, never stored.** `risers = ceil(storeyHeight / MAX_RISER
  0.19)`, `run = risers × TREAD_DEPTH 0.25`. Raising a ceiling below lengthens the
  stair automatically. Direction of climb is the stair's local +x under `rotation`
  (footprint convention shared with furniture).
- **Elevation is derived, never stored** (new `lib/building.ts`):
  `storeyHeightOf(floor)` = max `wallHeightOf` across its derived rooms
  (`DEFAULT_WALL_HEIGHT` 2.5 if the floor has no rooms) + `SLAB_THICKNESS` 0.2;
  `storeyElevation(building, i)` = Σ `storeyHeightOf` over floors below `i`.
- **Voids are derived from stairs** (new `lib/stairs.ts`): the stair's rotated
  footprint rectangle is cut as a hole in its own floor's ceiling slab and in the
  floor-above's platform, and doubles as a furniture-placement obstacle on the floor
  above. No stored `Void` entity.
- **A stair is placeable only when a floor above exists** (the void must cut into
  something). Deleting a floor deletes the stairs that rise onto it from the floor
  below (confirm copy says so).

## History, route state, and mutations

- The route holds `History<Building>`. New `model/building.ts`:
  `updateFloorIn(building, floorId, fn)` extends the same-reference no-op contract one
  level up (mirror of M1's `updateRoomIn`) — pure-setter no-ops still can't push empty
  history steps.
- **The active floor id is route/UI state, not model state.** Switching floors is like
  moving a selection — never an undo step. If undo/redo produces a building without
  the active floor, the route clamps to the nearest surviving index.
- Every existing mutation path (furniture, openings, graph edits, room records) wraps
  in `updateFloorIn` with the active floor's id — except edits to a *picked*
  lower-floor item in 3D, which resolve the owning floor from the selected id (same
  spirit as `mutateRoomOf` in M2).

## Persistence — v7, v6 readable

- v7 payload: `{ version: 7, building, unit, savedAt }`.
- A v6 `{ floor }` save migrates **on read** into a one-floor building with a
  generated floor id and empty `stairs`, staying v6 on disk until the first real
  change writes v7 (M1 precedent — keeps the honest saved-at time).
- Validation stays paranoid, reject-the-whole-save style: ≥ 1 floor; floor and stair
  ids present, non-empty, unique building-wide; stair `width` in [0.7, 2.0], finite
  position/rotation; a stair on the top floor rejects (it can't have a void).
- "New room" resets to a one-floor building (fresh empty floor, new id), drops into
  draw — unchanged behavior, one level up.

## 3D lens — the stack

- `RoomScene` renders floors 0 → active, each floor's whole scene group translated up
  by `storeyElevation`; floors above the active index don't render at all (Sims
  slice). Switching floors re-slices.
- **Active floor: today's behavior exactly** — cutaway/stub walls, furniture, opening
  pick volumes, selection rims, drags.
- **Lower floors render "capped":** the same live camera-facing wall cutaway as the
  active floor (originally spec'd as full-height/no-cutaway; changed 2026-07-23 —
  frozen full walls hid lower interiors while orbiting), furniture in place, plus a
  **ceiling slab** per room — the room's
  outline polygon extruded `SLAB_THICKNESS`, sitting on top of that room's walls —
  with stair voids cut as shape holes. The floor-above's platform cuts the matching
  hole, so a stairwell reads as one continuous opening from both sides.
- **Picking across storeys (owner decision):** everything visible is pickable — all
  four selection kinds (furniture, openings, walls, stairs) on any *visible* floor.
  Selecting a lower-floor item shows it in the inspector; edits and drags apply
  *within its own floor* — its own wall-slab obstacles, at its own elevation (the
  move-drag's ground plane and the opening/wall projectors lift to the owning
  floor's elevation). New placements (library drops, opening drops, draw mode)
  always target the **active** floor; their raycast planes lift to the active
  floor's elevation.
- **Camera & grounding:** framing fits the union bbox of *visible* floors; on a floor
  switch the orbit target eases to the active storey's mid-height. The studio-pool
  CSS vars follow the same union bbox; the contact shadow renders at ground level
  only (one shadow under the building).
- **Stair mesh:** one box per tread (wood tone), stringer-less, no handrail (deferred).

## Flat lenses (2D + draw) — active floor + ghost underlay

- Both flat lenses show the active floor exactly as today.
- **Ghost underlay:** the floor *directly below* renders non-interactive — wall bands
  stroked light grey `#D4D4CC`, above the dot grid, below all live content. No
  furniture, openings as simple gaps. A status-bar toggle ("Underlay", shown only
  when a floor below exists) turns it off — same pattern and styling as grid/snap.
- **Underlay snapping:** the below-floor's edges join `snapTargetsOfGraph`'s targets,
  so drawing an upper wall snaps to the centerline of the wall below — corner
  coordinates and wall lines both attract, same tolerances as own-floor targets.
- **Stair symbols:** lower floor shows tread lines + an "UP" arrow along the climb
  direction; the floor above shows the void outline with the conventional break line
  + "DN" label. Symbols use the existing ink-grey plan stroke palette.

## Stairs — placement and editing

- The objects library gains a **"Stairs" category** with the straight-run card. With
  no floor above the active one, the card renders disabled with the hint "Add a floor
  above first".
- Drag-out reuses the standard placement ghost: footprint = `width × derived run`,
  grid + wall snapping like furniture, blue ghost when valid. **Invalid placements
  tint the ghost red and refuse the drop.** Invalid means: the footprint intersects a
  wall slab on its own floor, or the void rectangle intersects a wall slab on the
  floor above.
- Selection (either lens, a fourth selection kind alongside furniture, openings,
  walls): inspector STAIR section with WIDTH / ROTATE / POS X / POS Y fields, a
  read-only "Rises Ground floor → Floor 2" line with the derived run length, and
  Delete. The free-rotation handle reuses the furniture machinery (15° grid + wall
  snap). Every edit re-checks the same validity rule; invalid edits clamp or reject
  like `setFurnitureFootprint`.
- Keyboard: arrows nudge, R rotates 90°, delete/backspace deletes — same wiring as
  furniture.

## Chrome

- **Floor chips (canvas overlay):** a small vertical stack floating at the canvas's
  left edge, vertically centered — one chip per storey, top chip = top floor, labeled
  "G", "1", "2"…, full name in the tooltip; active chip = blue tint (Paper styling).
  A "+" chip above the stack adds an empty floor above the topmost and switches to
  it. The stack always shows, even with one floor (it *is* the add-floor
  affordance): just "G" and "+".
- **Rename/delete:** the settings popover gains one section per floor — floor name
  field, then that floor's per-room name/ceiling fields as today. Delete-floor is a
  confirm-gated action there (like "New room"), disabled when it's the last floor;
  the confirm names the stairs it will take with it.
- **Status bar:** prepends the floor when the building has more than one ("Ground
  floor · 48.9 m² · 2 rooms · Kitchen").
- **Inspector overview (no selection):** becomes a building summary — one row per
  floor (name, area, room count; the active one highlighted), footer totals across
  storeys (total floor area, room count).

## Testing

- **Unit (vitest, pure modules):** `building.ts` — storey height/elevation
  derivation (per-room ceilings, empty floor default), `updateFloorIn` no-op
  contract; `stairs.ts` — run derivation vs. storey height, rotated void rectangle,
  validity rule against wall slabs on both floors; persistence — v7 round-trip, v6
  one-floor migration, reject cases (dup ids, top-floor stair, out-of-range width);
  floor add/delete (stair cascade).
- **Headless (production build, per house rules):** seeded v6 save migrates and
  renders pixel-identically; "+" chip adds a floor and switches; draw an upper wall
  snapping to an underlay wall at the exact lower x; place a stair on the ground
  floor → stacked 3D screenshot shows the void through slab and platform; drag the
  stair somewhere invalid → red ghost, no drop; floor switch re-slices the 3D stack;
  single ⌘Z unwinds the stair placement; v7 reload hydrates; zero page errors.

## Deliberate deferrals

L/U-shaped stairs and handrails; basements (below-ground storeys); roofs; a manual
void tool / double-height rooms; cross-floor furniture drags (an item moves within
its floor — changing floors = delete + re-place); floor reordering and duplication;
per-floor PNG export batching; cantilevered-slab underside polish (an upper floor
overhanging the one below renders a floating platform edge — acceptable in v1).
