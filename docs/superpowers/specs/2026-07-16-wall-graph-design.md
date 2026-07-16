# Wall graph: shared walls, inferred rooms — design

*2026-07-16. Settled with the product owner in a brainstorming session; supersedes the
per-room-outline wall model (Phase 7's "walls are derived from each room's closed
outline" convention).*

## Problem

Each `Room` stores its own closed outline; a "shared" wall is two independent copies of
the same line, re-correlated every frame by `seams.ts` (flush or back-to-back at
`WALL_THICKNESS`). Nothing links the corners, and draw mode edits a single-room draft.
Consequences the owner hit directly:

- Dragging a corner requires first clicking to pick which room's draft you're editing.
- Dragging a corner shared by several rooms moves only one room; the neighbours keep
  their stale copies and the seam silently splits back into two walls.
- You cannot draw a wall without closing a loop — every wall must be part of some
  room's outline.

## Decision

Rebuild the floor model as a **single planar wall graph** with **derived rooms and
stored room identity**. Chosen over the cheaper alternative (coordinated corner-drag on
the per-room model) because the owner rated free/unclosed walls a core requirement, and
the graph makes shared corners, un-doubled walls, and open walls all consequences of
one model.

Second decision: draw mode moves from draft/commit sessions to **live edits with normal
undo** (the furniture-editing pattern). Esc cancels only the gesture in progress, not a
session.

Third decision (owner, explicitly): **no data preservation**. Not a production app, no
users — persistence v5 simply replaces v4; older payloads read as "no save". No
migration code.

## Data model

```ts
WallNode  { id, x, y }                  // a corner, shared by every wall meeting there
WallEdge  { id, a, b }                  // a wall: node id → node id; global WALL_THICKNESS
Opening   { id, kind, edgeId, offset, width, hinge?, side }
                                        // offset from node a; side: 1 | -1 = which
                                        // face (left/right of a→b) the door swings
                                        // toward / the item faces
RoomRecord{ id, name?, wallHeight?, anchor: Point }
Floor     { name?, nodes, edges, openings, furniture, rooms: RoomRecord[] }
```

- **Furniture and openings are floor-level lists.** "Which room is this in" is derived
  by containment, never stored — this finishes the direction the codebase already
  leans (`roomAtPoint`, floor-wide selection, no active-room mode).
- **Wall mounts** re-anchor as `{ edgeId, offset, side, elevation }`.
- Dragging a corner = moving one node; every wall and room touching it follows by
  construction. There is exactly one copy of a shared wall, so desync is impossible.
  `seams.ts` is deleted; a portal is simply an opening on an edge with a room on both
  sides.

## Normalization + face extraction (the derive pipeline)

After every mutation, a **normalization pass** keeps the stored graph canonical:

1. Merge coincident nodes (small tolerance; grid snapping does most of the work).
2. Split edges where a node lies on their interior (T-junctions) and where two edges
   cross.
3. Drop zero-length edges and duplicate edges.

Normalization is what makes "drag a corner onto another corner" weld them, and "end a
wall chain on an existing wall" split that wall — both first-class join gestures.

Then **face extraction** walks the planar graph (sort edges by angle around each node,
next half-edge = most clockwise turn; discard the outer face). Each closed interior
face is a room polygon. Open wall chains bound no face: they render as walls, produce
no room, no label, no area — accepted and intended.

## Room identity

Faces are geometry; identity lives in `RoomRecord`s, matched deterministically:

- A face containing a record's `anchor` **is** that room. The anchor doubles as the
  label position and re-centers into the face after each match (pole-of-inaccessibility
  or centroid).
- A face no record claims becomes a new room: fresh record, auto-name via
  `nextRoomName`.
- A record whose face vanished goes **dormant, not deleted** — drag a wall open and
  close it again and the Kitchen returns with its name and ceiling height. Dormant
  records persist indefinitely (they're tiny; no automatic garbage collection).
- Splitting a room in two: the half containing the anchor keeps the identity; the other
  half is a new room. Merging (deleting a shared edge): the record whose anchor lands
  in the merged face survives; the other goes dormant.

## Draw-mode interactions

Floor-wide graph editor, normal undo, no room pre-selection:

- **Corner drag:** grab any node anywhere. Snapping unchanged in feel (other nodes'
  x/y, grid quantize, snap toggle off = free-hand). Previews stream through history's
  preview channel and settle into one undo step on release.
- **Wall chain:** click-click-click places nodes and edges. Each completed segment is
  one undo step; esc discards only the rubber-band segment; stopping mid-chain is
  legal. Clicking an existing node or wall ends the segment there (normalization splits
  the wall). Closing a loop needs no ceremony — the moment a face closes, the room
  appears. The ⏎-to-close ritual, the draft, and "leaving draw mode applies the draft"
  all disappear.
- **Split / delete:** wall split inserts a node on an edge (both adjacent rooms see
  it). Deleting a 2-edge node merges its edges; deleting any other node removes it with
  its edges. Deleting an *edge* is first-class — it's how two rooms merge.
- **Length pills:** editing a wall's length moves its far node (and everything attached
  there — coordinated by construction). `setClosedSegmentLength`'s closed-loop
  propagation walk is retired.
- **Rect tool:** unchanged in feel — two clicks emit 4 nodes + 4 edges; normalization
  dedupes anything landing on existing walls, so a rect drawn against a room shares
  that wall.

## Rendering & derived geometry

- **Walls center on the edge line:** the edge extruded to `WALL_THICKNESS`, half on
  each side — the only symmetric choice when one wall serves two rooms. The
  flush/back-to-back halving conventions disappear with `seams.ts`. Wall height = max
  of the adjacent rooms' `wallHeight` (default for edges bounding no room); each side's
  face can carry its own room's finish/baseboard.
- **Interior polygons:** the extracted face runs along centerlines, so the interior
  polygon = face inset by `WALL_THICKNESS / 2`. It drives the floor slab, the m²
  readout, and containment — area keeps meaning "carpet area".
- **Accepted semantic change:** length pills measure **centerline** lengths (standard
  architectural convention); wall-face dimensions shift by ±half a thickness versus the
  old outline-face numbers.
- **Sidedness is explicit:** doors swing toward `side` (default = the room the opening
  was placed from; flippable like the hinge). Mounts hang flush on their side's face.
  An opening on an edge with rooms on both sides *is* a portal — both faces get the
  cut, no correlation step.
- **Cutaway/stubs:** keyed off wall pieces exactly as now; a shared wall is one piece
  that always occludes one of its rooms, so it stays cut down at every orbit — same
  rule, simpler input.
- **Furniture policy:** items may sit anywhere walls allow — collision against wall
  solids replaces "clamp inside the room outline". Furniture in un-roomed space is
  legal; room-membership readouts use derived containment.

## Persistence

v6 payload (the codebase is already at v5) stores `{ floor: { name?, nodes, edges,
openings, furniture, rooms }, unit, savedAt }` with the usual paranoid validation
(dangling node refs, duplicate ids,
non-finite coords → "no save"). `READABLE_VERSIONS = [6]`: older payloads are treated
as no-save (owner's call — destructive is fine). The sample fixture
(`sample-room.ts`) is rebuilt in graph form.

## Testing

- **Pure model, heavily unit-tested:** normalization (merge/split, idempotence — a
  normalized graph re-normalizes to itself), face extraction fixtures (lone rectangle,
  two rooms sharing a wall, T-junction, open chain, crossing walls, concave
  shapes), identity rules (split keeps anchor side, merge survivor,
  dormant-record revival), opening/mount re-anchoring on edge splits and merges.
- **Headless Playwright against the production build** (per project rules): drag a
  shared corner and verify *both* rooms reshape; draw an unclosed wall and see it
  render with no label; weld two rooms by ending a chain on an existing wall; portal
  door renders through the shared wall; undo granularity; reload survival.

## Scope & sequencing

phase-sized (Phase 9; comparable to Phase 7's M1–M6): pure graph model first, then persistence
+ sample fixture, scenes, draw mode, openings/mounts, furniture policy — one spec, a
multi-task implementation plan (each task one session, verified headless, committed).
Backlog items **W2** (true-thickness draft preview — subsumed: walls are always
rendered at true thickness from the graph) and **W3** (borrow-the-wall close —
subsumed: ending a chain on a wall welds by normalization) are retired.

**Out of scope:** per-edge wall thickness, curved walls, Z levels/storeys, per-room
floor finishes, auto-generating rooms from scanned plans. Also deferred: **island
rooms** (a room floating wholly inside another) — single-cycle face walking doesn't
assign holes to enclosing faces, so the outer room's area would ignore the island;
acceptable for now and revisitable without a model change.

## Known risks

- **Tolerance fragility:** face extraction needs exact node sharing; a free-hand
  (snap-off) endpoint 1 mm from a wall means no closure and no room. Normalization's
  merge tolerance must be committed into the data, not just visual. Mitigation: grid
  snapping stays default-on; the weld tolerance applies even with snap off.
- **Identity heuristics:** anchor-based matching is deterministic but can surprise on
  exotic edits (e.g. dragging a wall across an anchor). Accepted; the rules above are
  the contract, and dormancy makes mistakes recoverable.
- **Refactor blast radius:** model, both scenes, draw mode, collision/placement,
  opening/mount placement, inspector/status readouts all change. Mitigated by the
  derive pipeline being pure and test-first, and by sequencing scenes before
  interactions.
