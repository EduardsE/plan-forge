import { describe, expect, it } from "vitest";
import {
  deriveFloor,
  type Floor,
  type Point,
  setEdgeThickness,
  setOpeningSillMaterial,
  setOpeningSillOverhang,
  WALL_THICKNESS,
} from "#/lib/model";
import { makeFloor, makeLRoom } from "#/lib/model/test-fixtures";
import {
  buildEdgeSolids,
  ceilingSlabShape,
  DOOR_HEIGHT,
  faceOutwardOffset,
  nodePosts,
  STUB_WALL_HEIGHT,
  sillBox,
  stubSpans,
  sunAnchorAzimuth,
  WALL_HEIGHT,
  type WallSolid,
  WINDOW_HEAD,
  WINDOW_SILL,
  wallZOffset,
  windowUnitZ,
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
        sillOverhang: expect.any(Number),
        sillMaterial: expect.any(String),
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
      id: "fixture",
      nodes: [
        { id: "p", x: 0, y: 0 },
        { id: "q", x: 3, y: 0 },
      ],
      edges: [{ id: "PQ", a: "p", b: "q" }],
      openings: [],
      furniture: [],
      rooms: [],
      stairs: [],
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

  it("honors per-opening sill/head overrides", () => {
    const floor = makeFloor();
    floor.openings = floor.openings.map((o) =>
      o.id === "window-AB" ? { ...o, sill: 0.9, head: 2.2 } : o,
    );
    const hole = byEdge(solidsOf(floor), "AB").holes[0];
    expect(hole.bottom).toBe(0.9);
    expect(hole.top).toBe(2.2);
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
    thickness: WALL_THICKNESS,
    outwardShift: 0,
    outwardSign: 1,
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
      id: "fixture",
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
      stairs: [],
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

describe("nodePosts corners", () => {
  const postsOf = (floor: Floor) => {
    const solids = buildEdgeSolids(floor, deriveFloor(floor).rooms);
    return nodePosts(floor, solids);
  };
  const sortedCorners = (post: { corners: Point[] }) =>
    [...post.corners].sort((a, b) => a.x - b.x || a.y - b.y);

  it("default corner: the old 10 cm square", () => {
    const post = postsOf(makeFloor()).find((p) => p.nodeId === "A");
    if (!post) throw new Error("post at A missing");
    expect(sortedCorners(post)).toEqual([
      { x: -0.1, y: -0.1 },
      { x: -0.1, y: 0 },
      { x: 0, y: -0.1 },
      { x: 0, y: 0 },
    ]);
  });

  it("thickened wall widens its axis of the corner post", () => {
    // AB (horizontal, outward −y) thickened to 0.3: the post at A spans
    // y from the pinned interior face (0) to the bulked exterior (−0.3),
    // while FA's axis (x) keeps the default 0.1 span.
    const post = postsOf(setEdgeThickness(makeFloor(), "AB", 0.3)).find(
      (p) => p.nodeId === "A",
    );
    if (!post) throw new Error("post at A missing");
    expect(sortedCorners(post)).toEqual([
      { x: -0.1, y: -0.3 },
      { x: -0.1, y: 0 },
      { x: 0, y: -0.3 },
      { x: 0, y: 0 },
    ]);
  });
});

describe("sunAnchorAzimuth", () => {
  it("anchors outside the sample floor's only glazed wall", () => {
    // The one window sits on AB, whose outward normal points up-plan (0, -1),
    // so the sun anchors at atan2(-1, 0) = -π/2.
    expect(sunAnchorAzimuth(solidsOf(makeFloor()))).toBeCloseTo(
      -Math.PI / 2,
      10,
    );
  });

  it("prefers the wall with the largest total window area", () => {
    const floor = makeFloor();
    // A wider window on CD (outward (1, 0)) outweighs AB's 2.1 m one.
    floor.openings = [
      ...floor.openings,
      {
        id: "window-CD",
        kind: "window",
        edgeId: "CD",
        offset: 1.0,
        width: 3.0,
        side: 1,
      },
    ];
    expect(sunAnchorAzimuth(solidsOf(floor))).toBeCloseTo(0, 10);
  });

  it("ignores doors and falls back to a fixed default without glazing", () => {
    const floor = makeFloor();
    floor.openings = floor.openings.filter((o) => o.kind !== "window");
    expect(sunAnchorAzimuth(solidsOf(floor))).toBeCloseTo(
      (232 * Math.PI) / 180,
      10,
    );
  });
});

describe("per-edge wall thickness", () => {
  it("defaults every solid to WALL_THICKNESS, centered", () => {
    for (const solid of solidsOf(makeFloor())) {
      expect(solid.thickness).toBe(WALL_THICKNESS);
      expect(solid.outwardShift).toBe(0);
    }
  });

  it("grows a 1-face wall outward, interior face pinned", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
    const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
    expect(ab?.thickness).toBe(0.3);
    expect(ab?.outwardShift).toBeCloseTo(0.1, 9);
    // AB's single face is the living room on side +1, so outward is the
    // rightNormal → outwardSign −1, and the interior face stays at 5 cm:
    expect(ab?.outwardSign).toBe(-1);
    if (!ab) throw new Error("AB solid missing");
    expect(faceOutwardOffset(ab, 1)).toBeCloseTo(-0.05, 9);
    expect(faceOutwardOffset(ab, -1)).toBeCloseTo(0.25, 9);
    expect(wallZOffset(ab)).toBeCloseTo(-0.25, 9);
  });

  it("keeps a shared (2-face) wall at the default — override dormant", () => {
    const floor = setEdgeThickness(makeFloor(), "BE", 0.3);
    const be = solidsOf(floor).find((s) => s.edgeId === "BE");
    expect(be?.thickness).toBe(WALL_THICKNESS);
    expect(be?.outwardShift).toBe(0);
  });

  it("grows a dangling (0-face) edge symmetrically", () => {
    const base = makeFloor();
    const floor = setEdgeThickness(
      {
        ...base,
        nodes: [
          ...base.nodes,
          { id: "X", x: 20, y: 0 },
          { id: "Y", x: 22, y: 0 },
        ],
        edges: [...base.edges, { id: "XY", a: "X", b: "Y" }],
      },
      "XY",
      0.3,
    );
    const xy = solidsOf(floor).find((s) => s.edgeId === "XY");
    expect(xy?.thickness).toBe(0.3);
    expect(xy?.outwardShift).toBe(0);
  });

  it("resolves window sill fields onto the hole", () => {
    let floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0.18);
    floor = setOpeningSillMaterial(floor, "window-AB", "wood");
    const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
    const hole = ab?.holes.find((h) => h.id === "window-AB");
    expect(hole?.sillOverhang).toBe(0.18);
    expect(hole?.sillMaterial).toBe("wood");
    // Unit sits in the outer 10 cm; on a default wall that is centered:
    if (!ab || !hole) throw new Error("window hole missing");
    expect(windowUnitZ(ab, hole)).toBeCloseTo(0, 9);
  });

  it("thin wall (< default): interior face stays pinned, sill degrades to the overhang", () => {
    const floor = setEdgeThickness(makeFloor(), "AB", 0.05);
    const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
    if (!ab) throw new Error("AB solid missing");
    expect(ab.thickness).toBe(0.05);
    expect(ab.outwardShift).toBeCloseTo(-0.025, 9);
    // Interior face (room side +1) still 5 cm off the centerline; the
    // exterior face lands on the centerline itself.
    expect(faceOutwardOffset(ab, 1)).toBeCloseTo(-0.05, 9);
    expect(faceOutwardOffset(ab, -1)).toBeCloseTo(0, 9);
    const hole = ab.holes.find((h) => h.id === "window-AB");
    if (!hole) throw new Error("window hole missing");
    const sill = sillBox(ab, hole);
    if (!sill) throw new Error("sill missing");
    // Unit depth clamps to the wall (0.05), so the board is overhang-only.
    expect(sill.depth).toBeCloseTo(0.03, 9);
  });
});

describe("sillBox", () => {
  const solidsOf = (floor: Floor) =>
    buildEdgeSolids(floor, deriveFloor(floor).rooms);
  const windowOn = (floor: Floor) => {
    const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
    const hole = ab?.holes.find((h) => h.id === "window-AB");
    if (!ab || !hole) throw new Error("fixture window missing");
    return { ab, hole };
  };

  it("default wall + default overhang: a 3 cm ledge on the room side", () => {
    const { ab, hole } = windowOn(makeFloor());
    const sill = sillBox(ab, hole);
    expect(sill).not.toBeNull();
    if (!sill) return;
    expect(sill.width).toBeCloseTo(hole.width + 0.08, 9);
    expect(sill.height).toBe(0.04);
    expect(sill.y).toBeCloseTo(hole.bottom - 0.02, 9);
    expect(sill.depth).toBeCloseTo(0.03, 9);
    // Room is on side +1; the board spans interior face (+0.05) → +0.08.
    expect(sill.z).toBeCloseTo(0.065, 9);
    expect(sill.material).toBe("white");
  });

  it("thick wall + overhang 0: fills the reveal, flush at the face", () => {
    let floor = setEdgeThickness(makeFloor(), "AB", 0.3);
    floor = setOpeningSillOverhang(floor, "window-AB", 0);
    const { ab, hole } = windowOn(floor);
    const sill = sillBox(ab, hole);
    if (!sill) throw new Error("sill missing");
    // Reveal = 0.3 − 0.1 = 0.2, spanning local z −0.15 (unit's interior
    // face) → +0.05 (pinned interior wall face).
    expect(sill.depth).toBeCloseTo(0.2, 9);
    expect(sill.z).toBeCloseTo(-0.05, 9);
  });

  it("null for doors and for a zero-depth board", () => {
    const floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0);
    const { ab, hole } = windowOn(floor);
    expect(sillBox(ab, hole)).toBeNull();
    const be = solidsOf(makeFloor()).find((s) => s.edgeId === "BE");
    const door = be?.holes.find((h) => h.id === "door-BE");
    if (!be || !door) throw new Error("fixture door missing");
    expect(sillBox(be, door)).toBeNull();
  });
});

describe("ceilingSlabShape", () => {
  const rect: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];

  it("returns a shape whose bounding box matches a 4×3 outline", () => {
    const result = ceilingSlabShape(rect, []);
    if (!result) throw new Error("shape missing");
    const points = result.shape.getPoints();
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 9);
    expect(result.shape.holes).toHaveLength(0);
  });

  it("carries one hole path per rectangular hole", () => {
    const hole: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    const result = ceilingSlabShape(rect, [hole]);
    if (!result) throw new Error("shape missing");
    expect(result.shape.holes).toHaveLength(1);
    const points = result.shape.holes[0].getPoints();
    const xs = points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
  });

  it("is null for a degenerate outline", () => {
    expect(
      ceilingSlabShape(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        [],
      ),
    ).toBeNull();
    expect(ceilingSlabShape([], [])).toBeNull();
  });
});
