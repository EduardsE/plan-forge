# Windowsills & per-wall depth — design

*2026-07-18. Brainstormed and approved with Eduards.*

## Goal

Two windowsill looks, driven by one parameter:

- **Recessed / flush** (white PVC reference photo): the sill lives inside the
  wall reveal. Requires the window wall to have real depth (25–40 cm).
- **Overhanging shelf** (live-edge oak reference photo): the board protrudes
  past the interior wall face into the room.

Both reduce to *how far the board sticks past the interior wall face*. The
reveal part fills in automatically once walls can be thicker than the current
hard-coded 10 cm — which is why per-wall thickness is in scope.

## Decisions (made during brainstorming)

1. **Sills are visual-only** for now. Nothing can be placed on them; the model
   choice must not preclude adding that later.
2. **Wall thickness is per-wall** (per graph edge), default 10 cm.
3. **Thickness grows outward** on exterior walls — the interior face stays
   pinned, so floor area, furniture placement, and room dimensions never move.
4. **Exterior walls only** in this iteration. Shared walls (two room faces)
   always use the standard 10 cm; an override stored on a wall that becomes
   shared goes dormant (not deleted) and revives if the wall becomes exterior
   again. This keeps the uniform-inset invariant in `deriveFloor`
   (`insetPolygon(face.polygon, WALL_THICKNESS / 2)`), the furniture collision
   strips (`place.ts`), and the wall-mount push (`wall-mount.ts`) untouched.
5. **Every window automatically has a sill** — no on/off toggle. An overhang
   field (default 3 cm; 0 = flush) and a material choice (white | wood) control
   the look.
6. **Walls become selectable** in 2D and 3D; the inspector gets a wall section
   where thickness is edited.

## Part 1 — Data model

### Edge thickness

- `Edge` gains optional `thickness?: number` — meters, clamped **0.05–0.60**.
- Effective thickness of a wall:
  - edge with 0 or 1 adjacent room faces → `thickness ?? WALL_THICKNESS`;
  - edge with 2 faces (shared wall) → always `WALL_THICKNESS` (0.1).
- New pure setter `setEdgeThickness(floor, edgeId, thickness)` following the
  existing `Floor → Floor` convention: clamps, returns the same reference on a
  no-op or unknown id, ends in `reconcileFloor`. Setting exactly the default
  removes the field (sparse storage). History/undo work unchanged because the
  mutation flows through the normal floor-update path.

### Sill fields on windows

- `Opening` (windows only) gains two sparse fields, stored only when they
  differ from defaults (same pattern as `sill`/`head`):
  - `sillOverhang?: number` — meters past the interior wall face, default
    **0.03**, clamped **0–0.40**;
  - `sillMaterial?: "white" | "wood"` — default `"white"`.
- Setters `setOpeningSillOverhang` / `setOpeningSillMaterial` in
  `model/openings.ts`, same conventions (no-op on doors / unknown ids /
  non-finite values).

## Part 2 — 3D geometry (`lib/room-scene.ts`, `components/room-scene.tsx`)

### Asymmetric wall solids

- `WallSolid` gains `thickness: number` and `centerOffset: number` — the signed
  plan-normal offset of the extrusion's mid-plane from the edge centerline.
- Exterior wall (1 face) with an override: the **interior face stays at
  `WALL_THICKNESS / 2` (5 cm) off the centerline on the room side**; the body
  spans `thickness` outward from that face.
- Dangling edge (0 faces): grows symmetrically about the centerline (no
  defined interior side).
- Default-thickness walls: `centerOffset = 0`, byte-identical to today.
- The extrusion depth and stub geometry use `solid.thickness`; the z-shift uses
  `centerOffset` instead of the constant `-WALL_THICKNESS / 2`.

### Corner posts

- `NodePost` grows from a fixed 10 cm square to a rectangle spanning, on each
  incident wall's normal axis, from that wall's **interior-face corner to its
  exterior-face corner**. Thick corners fill; slight overshoot on the exterior
  side is acceptable (invisible from the dollhouse interior).

### Window unit placement in depth

- The window unit (frame bars, muntin cross, sky pane) occupies the **outer
  10 cm** of the wall: for default walls this is exactly today's centered
  placement (zero visual change). If thickness < 10 cm, the unit depth clamps
  to the wall thickness.
- On a thick wall this leaves an interior **reveal** of `thickness − 0.1` m.
- Frame bar depth becomes `min(0.1, thickness) + lip` (no longer spanning the
  full wall). The always-on **shadow-proxy bars follow the same placement** so
  the sun patch and muntin cross on the floor stay correct.

### Sill board

One box per window hole, on the interior side:

- **Top face flush with `hole.bottom`** (the frame's bottom bar sits on it);
  board thickness 0.04 m hangs below.
- **Depth**: from the window unit's interior face to `overhang` past the
  interior wall face. With a thick wall and overhang 0, this is the flush
  recessed look; with overhang 15–20 cm it reads as the oak-shelf look.
- **Ears**: extends 0.04 m past the hole on each side. At overhang 0 the ears
  are buried inside the wall body (hidden); when protruding they read as the
  shelf's visible ends.
- **Material**: `"white"` matches the window-frame white; `"wood"` uses the
  warm oak tone from the furniture palette.
- Renders with the window dressing group — vanishes with the cutaway — and
  **casts no proxy shadow** (accepted simplification; the board is thin).

## Part 3 — 2D plan lens

- Wall strokes render at each edge's effective thickness with the same
  asymmetric offset as 3D: interior line fixed, outer line bulges outward.
- Opening pick / highlight / halo rectangles in `plan-openings.tsx` use the
  host edge's effective thickness instead of the `WALL_THICKNESS` constant;
  same for the opening ghost's depth.
- The plan window symbol spans the full wall depth.
- The sill draws as a hairline-stroked rectangle protruding `overhang` into
  the room, spanning the window width plus ears (architectural "stool"
  convention), **only when overhang > 0**.
- **Draw mode stays untouched** — it is the outlining lens; strokes keep the
  simple default width.

## Part 4 — Selection & inspector

- A third selection kind joins furniture and openings: **selected wall**
  (`edgeId`), mutually exclusive with the other two.
- **3D picking**: wall bodies (currently `noRaycast`) get pick targets;
  openings keep priority where they overlap. **2D picking**: the wall stroke is
  clickable outside opening spans.
- Selected wall gets an accent highlight in both lenses; Esc / empty-canvas
  click clears, matching existing selection behavior.
- **Inspector wall section**: length readout (read-only) + thickness field
  (meters, clamped 0.05–0.60). Disabled with a hint — "shared walls use the
  standard 10 cm" — when the wall borders two rooms.
- **Window inspector** gains a "Sill" group: overhang field (existing units
  conventions) + White | Wood toggle.

## Part 5 — Persistence

- Three new optional fields validated on load: `edge.thickness`,
  `opening.sillOverhang`, `opening.sillMaterial`. Non-finite / out-of-range /
  wrong-kind values reject the save (hydrates as no-save), matching the module's
  existing all-or-nothing validation style. Old saves load unchanged — absent
  fields mean defaults.

## Part 6 — Testing

- Model setters: clamps, sparse storage (default → field removed), no-ops,
  shared-wall dormancy (override ignored while 2 faces, revives at ≤ 1).
- `buildEdgeSolids`: thickness/`centerOffset` per adjacency; default walls
  unchanged.
- Corner posts cover thick-wall corners (interior-to-exterior span).
- Sill geometry as a pure, unit-tested function: flush (overhang 0, thick
  wall) vs shelf (overhang > reveal) vs thin-wall cases.
- Persistence round-trip for all three fields, plus invalid-value dropping.
- Headless Playwright verification per the project's verify skill: select a
  wall, thicken it, set a window's overhang, confirm persisted state and that
  window dragging still behaves.

## Out of scope (explicitly)

- Placing objects on sills (future; nothing here precludes it — the sill's
  top face is a well-defined plane derived from `hole.bottom`).
- Thickness on shared walls (symmetric growth, variable-offset insets).
- Sill shadow proxy; exterior sill boards below the window on the outside.
- Draw-mode thickness display.
