import type { Floor } from "./types";

/**
 * Shared test fixture: two rooms sharing a full-height edge (6 nodes, 7 edges).
 * Exported for tests only (imported by `derived.test.ts` and
 * `../graph-edit.test.ts`).
 *
 *   nodes A(-0.05,-0.05) B(6.4,-0.05) C(9.45,-0.05)
 *         D(9.45,5.25)  E(6.4,5.25)  F(-0.05,5.25)
 *   edges AB BC CD DE EF FA and the shared edge BE.
 *   records: living (anchor 3,2.5), kitchen (anchor 8,2.5).
 *   openings: door on BE (offset 3.65, width 0.95, side toward living = 1),
 *             window on AB (offset 3.55, width 2.1, side toward living = 1).
 *   furniture: desk at (2,2) in living, plant at (8,4) in kitchen,
 *              stray stool at (20,20) (unassigned).
 */
export function makeFloor(): Floor {
  return {
    nodes: [
      { id: "A", x: -0.05, y: -0.05 },
      { id: "B", x: 6.4, y: -0.05 },
      { id: "C", x: 9.45, y: -0.05 },
      { id: "D", x: 9.45, y: 5.25 },
      { id: "E", x: 6.4, y: 5.25 },
      { id: "F", x: -0.05, y: 5.25 },
    ],
    edges: [
      { id: "AB", a: "A", b: "B" },
      { id: "BC", a: "B", b: "C" },
      { id: "CD", a: "C", b: "D" },
      { id: "DE", a: "D", b: "E" },
      { id: "EF", a: "E", b: "F" },
      { id: "FA", a: "F", b: "A" },
      { id: "BE", a: "B", b: "E" },
    ],
    openings: [
      {
        id: "door-BE",
        kind: "door",
        edgeId: "BE",
        offset: 3.65,
        width: 0.95,
        side: 1,
        hinge: "start",
      },
      {
        id: "window-AB",
        kind: "window",
        edgeId: "AB",
        offset: 3.55,
        width: 2.1,
        side: 1,
      },
    ],
    furniture: [
      {
        id: "desk-1",
        catalogId: "desk",
        position: { x: 2, y: 2 },
        rotation: 0,
        footprint: { width: 1.2, depth: 0.6, height: 0.75 },
      },
      {
        id: "plant-1",
        catalogId: "plant",
        position: { x: 8, y: 4 },
        rotation: 0,
        footprint: { width: 0.45, depth: 0.45, height: 1.2 },
      },
      {
        id: "stool-1",
        catalogId: "stool",
        position: { x: 20, y: 20 },
        rotation: 0,
        footprint: { width: 0.42, depth: 0.42, height: 0.45 },
      },
    ],
    rooms: [
      { id: "living", name: "Living room", anchor: { x: 3, y: 2.5 } },
      { id: "kitchen", name: "Kitchen", anchor: { x: 8, y: 2.5 } },
    ],
  };
}

/**
 * A single concave (L-shaped) room, for the wall-side derivation. The reflex
 * vertex is `d(3,2)`; its adjacent edges `cd` and `de` are exactly where a
 * label-point-vs-edge-line side test used to flip the sign. The loop is wound
 * so `extractFaces` keeps it as-is (positive shoelace), and every edge is
 * defined in the traversal direction, so the interior side of each is `+1`.
 *
 *   a(0,0) b(6,0) c(6,2) d(3,2) e(3,5) f(0,5)
 */
export function makeLRoom(): Floor {
  return {
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 6, y: 0 },
      { id: "c", x: 6, y: 2 },
      { id: "d", x: 3, y: 2 },
      { id: "e", x: 3, y: 5 },
      { id: "f", x: 0, y: 5 },
    ],
    edges: [
      { id: "ab", a: "a", b: "b" },
      { id: "bc", a: "b", b: "c" },
      { id: "cd", a: "c", b: "d" },
      { id: "de", a: "d", b: "e" },
      { id: "ef", a: "e", b: "f" },
      { id: "fa", a: "f", b: "a" },
    ],
    openings: [],
    furniture: [],
    rooms: [{ id: "ell", name: "L room", anchor: { x: 1, y: 1 } }],
  };
}
