import { describe, expect, it } from "vitest";
import { deriveFloor, type Floor } from "#/lib/model";
import { makeFloor, makeLRoom } from "#/lib/model/test-fixtures";
import {
  buildEdgeSolids,
  DOOR_HEIGHT,
  nodePosts,
  STUB_WALL_HEIGHT,
  stubSpans,
  WALL_HEIGHT,
  type WallSolid,
  WINDOW_HEAD,
  WINDOW_SILL,
} from "./room-scene";

const solidsOf = (floor: Floor) =>
  buildEdgeSolids(floor, deriveFloor(floor).rooms);
const byEdge = (solids: WallSolid[], edgeId: string) => {
  const solid = solids.find((s) => s.edgeId === edgeId);
  if (!solid) throw new Error(`no solid for edge ${edgeId}`);
  return solid;
};

describe("buildEdgeSolids", () => {
  it("yields one solid per edge of the sample floor", () => {
    const floor = makeFloor();
    expect(solidsOf(floor)).toHaveLength(floor.edges.length);
  });

  it("carries the portal door on the shared edge as ONE two-face solid", () => {
    const be = byEdge(solidsOf(makeFloor()), "BE");
    // Both rooms border BE: it always occludes one of them → always stubs.
    expect(be.faces).toBe(2);
    expect(be.faceSides.slice().sort()).toEqual([-1, 1]);
    expect(be.holes).toEqual([
      {
        id: "door-BE",
        kind: "door",
        start: 3.65,
        width: expect.closeTo(0.95, 10),
        bottom: 0,
        top: DOOR_HEIGHT,
        hinge: "start",
        side: 1,
      },
    ]);
  });

  it("gives an exterior edge one face, its window, and an outward-pointing normal", () => {
    const ab = byEdge(solidsOf(makeFloor()), "AB");
    expect(ab.faces).toBe(1);
    // AB runs left→right along the top; the living room is below, so outward
    // (toward the empty side) points up.
    expect(ab.outward).toEqual({ x: 0, y: -1 });
    expect(ab.holes).toEqual([
      {
        id: "window-AB",
        kind: "window",
        start: 3.55,
        width: expect.closeTo(2.1, 10),
        bottom: WINDOW_SILL,
        top: WINDOW_HEAD,
        side: 1,
      },
    ]);
  });

  it("orients outward to the exterior for a concave one-face edge", () => {
    // L-room: edge `cd` (top of the lower arm, x∈[3,6]) has the room below it
    // and open space above. Its single face side is +1, so outward is the
    // right normal of dir=(-1,0) → (0,1), pointing down to the empty side. A
    // label-point side test used to read this reflex-adjacent edge as -1,
    // flipping outward up into the room.
    const cd = byEdge(solidsOf(makeLRoom()), "cd");
    expect(cd.faces).toBe(1);
    expect(cd.faceSides).toEqual([1]);
    expect(cd.outward.x).toBeCloseTo(0, 10);
    expect(cd.outward.y).toBeCloseTo(1, 10);
  });

  it("renders a dangling edge (no adjacent room) as a plain full-height wall", () => {
    const floor: Floor = {
      nodes: [
        { id: "p", x: 0, y: 0 },
        { id: "q", x: 3, y: 0 },
      ],
      edges: [{ id: "PQ", a: "p", b: "q" }],
      openings: [],
      furniture: [],
      rooms: [],
    };
    const solid = byEdge(solidsOf(floor), "PQ");
    expect(solid.faces).toBe(0);
    expect(solid.height).toBe(WALL_HEIGHT);
    expect(solid.holes).toEqual([]);
    expect(solid.length).toBeCloseTo(3, 10);
  });

  it("takes the wall height from the taller adjacent room (per-side heights)", () => {
    const floor = makeFloor();
    // Living stays 2.5 (default); the kitchen ceiling rises to 3.2.
    floor.rooms = floor.rooms.map((r) =>
      r.id === "kitchen" ? { ...r, wallHeight: 3.2 } : r,
    );
    const solids = solidsOf(floor);
    // The shared wall renders the tall side.
    expect(byEdge(solids, "BE").height).toBe(3.2);
    // The living room's exterior wall stays at the default.
    expect(byEdge(solids, "AB").height).toBe(WALL_HEIGHT);
    // A kitchen-only exterior wall is tall.
    expect(byEdge(solids, "CD").height).toBe(3.2);
  });

  it("clamps hole tops to a low wall height", () => {
    const floor = makeFloor();
    floor.rooms = floor.rooms.map((r) => ({ ...r, wallHeight: undefined }));
    const solids = buildEdgeSolids(
      { ...floor },
      deriveFloor(floor).rooms.map((r) => ({ ...r, wallHeight: 1.5 })),
    );
    expect(byEdge(solids, "AB").holes[0].top).toBe(1.5);
    expect(byEdge(solids, "BE").holes[0].top).toBe(1.5);
  });
});

describe("stubSpans", () => {
  const solid = (holes: WallSolid["holes"], length = 5.2): WallSolid => ({
    index: 0,
    edgeId: "e",
    start: { x: 0, y: 0 },
    dir: { x: 1, y: 0 },
    outward: { x: 0, y: -1 },
    length,
    height: WALL_HEIGHT,
    holes,
    faces: 1,
    faceSides: [1],
  });
  const door = (start: number, width: number, bottom = 0) => ({
    id: `h-${start}`,
    kind: "door" as const,
    start,
    width,
    bottom,
    top: DOOR_HEIGHT,
    side: 1 as const,
  });

  it("covers a hole-free wall with one span", () => {
    expect(stubSpans(solid([]))).toEqual([{ start: 0, end: 5.2 }]);
  });

  it("turns a door hole into a full gap through the stub", () => {
    expect(stubSpans(solid([door(2, 0.9)]))).toEqual([
      { start: 0, end: 2 },
      { start: 2.9, end: 5.2 },
    ]);
  });

  it("ignores windows: their sill sits above the stub top", () => {
    expect(WINDOW_SILL).toBeGreaterThan(STUB_WALL_HEIGHT);
    expect(stubSpans(solid([door(3, 1.5, WINDOW_SILL)]))).toEqual([
      { start: 0, end: 5.2 },
    ]);
  });
});

describe("nodePosts", () => {
  it("posts at the rectangle's four corners, none on straight runs", () => {
    const floor = makeFloor();
    const posts = nodePosts(floor, solidsOf(floor));
    // The 6 outer nodes are all corners or the shared-wall T-junctions
    // (B and E have degree 3). None are collinear pass-throughs.
    const ids = posts.map((p) => p.nodeId).sort();
    expect(ids).toEqual(["A", "B", "C", "D", "E", "F"]);
    // B and E are junctions of three walls.
    expect(posts.find((p) => p.nodeId === "B")?.edgeIndices).toHaveLength(3);
  });

  it("skips a collinear pass-through node and dangling ends", () => {
    const floor: Floor = {
      nodes: [
        { id: "p", x: 0, y: 0 },
        { id: "m", x: 3, y: 0 },
        { id: "q", x: 6, y: 0 },
      ],
      edges: [
        { id: "PM", a: "p", b: "m" },
        { id: "MQ", a: "m", b: "q" },
      ],
      openings: [],
      furniture: [],
      rooms: [],
    };
    // m is a straight run (collinear), p and q are dangling ends.
    expect(nodePosts(floor, solidsOf(floor))).toEqual([]);
  });

  it("takes the post height from the tallest incident wall", () => {
    const floor = makeFloor();
    floor.rooms = floor.rooms.map((r) =>
      r.id === "kitchen" ? { ...r, wallHeight: 3.4 } : r,
    );
    const posts = nodePosts(floor, solidsOf(floor));
    // Node B touches the shared wall (kitchen-tall) → tall post.
    expect(posts.find((p) => p.nodeId === "B")?.height).toBe(3.4);
  });
});
