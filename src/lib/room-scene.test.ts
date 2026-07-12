import { describe, expect, it } from "vitest";
import { createSampleRoom } from "#/lib/model/sample-room";
import {
  buildWallSolids,
  cornerPosts,
  DOOR_HEIGHT,
  STUB_WALL_HEIGHT,
  stubSpans,
  WALL_HEIGHT,
  WINDOW_HEAD,
  WINDOW_SILL,
  wallPieces,
} from "./room-scene";

describe("buildWallSolids", () => {
  it("yields no walls for degenerate outlines", () => {
    expect(
      buildWallSolids({
        id: "room-1",
        outline: [],
        openings: [],
        furniture: [],
      }),
    ).toEqual([]);
    expect(
      buildWallSolids({
        id: "room-1",
        outline: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
        openings: [],
        furniture: [],
      }),
    ).toEqual([]);
  });

  it("derives outward normals pointing away from the sample room interior", () => {
    const solids = buildWallSolids(createSampleRoom());
    expect(solids).toHaveLength(4);
    // Sample winding is clockwise on screen: 0 top, 1 right, 2 bottom, 3 left.
    expect(solids[0].outward).toEqual({ x: 0, y: -1 });
    expect(solids[1].outward).toEqual({ x: 1, y: 0 });
    expect(solids[2].outward).toEqual({ x: 0, y: 1 });
    expect(solids[3].outward).toEqual({ x: -1, y: 0 });
  });

  it("flips outward normals when the outline winding reverses", () => {
    const room = createSampleRoom();
    room.outline.reverse();
    const solids = buildWallSolids(room);
    // First wall now runs along the bottom edge (0,5.2) → (6.4,5.2).
    expect(solids[0].dir).toEqual({ x: 1, y: 0 });
    expect(solids[0].outward).toEqual({ x: 0, y: 1 });
  });

  it("places the sample openings as holes in wall-local coordinates", () => {
    const solids = buildWallSolids(createSampleRoom());
    expect(solids[0].holes).toEqual([
      {
        id: "window-1",
        kind: "window",
        start: 3.5,
        width: expect.closeTo(2.1, 10),
        bottom: WINDOW_SILL,
        top: WINDOW_HEAD,
      },
    ]);
    expect(solids[1].holes).toEqual([
      {
        id: "door-1",
        kind: "door",
        start: 3.6,
        width: expect.closeTo(0.95, 10),
        bottom: 0,
        top: DOOR_HEIGHT,
        hinge: "start",
      },
    ]);
    expect(solids[2].holes).toEqual([]);
    expect(solids[3].holes).toEqual([]);
  });

  it("clamps holes to the wall extent and drops the fully outside ones", () => {
    const room = createSampleRoom();
    room.openings = [
      { id: "w", kind: "window", wallIndex: 0, offset: 5.5, width: 2 },
      { id: "d", kind: "door", wallIndex: 0, offset: 7, width: 1 },
    ];
    const solids = buildWallSolids(room);
    expect(solids[0].holes).toEqual([
      {
        id: "w",
        kind: "window",
        start: 5.5,
        width: expect.closeTo(0.9, 10),
        bottom: WINDOW_SILL,
        top: WINDOW_HEAD,
      },
    ]);
  });

  it("clamps hole tops to a low wall height", () => {
    const solids = buildWallSolids(createSampleRoom(), 1.5);
    expect(solids[0].holes[0].top).toBe(1.5);
    expect(solids[1].holes[0].top).toBe(1.5);
  });

  it("uses the full wall height for door tops by default", () => {
    expect(DOOR_HEIGHT).toBeLessThan(WALL_HEIGHT);
  });

  it("defaults the wall height to the room's own setting", () => {
    const room = { ...createSampleRoom(), wallHeight: 2.2 };
    // Both hole tops stay untouched: door 2.05 and window head 1.94 fit
    // under the lowest legal ceiling — that's what MIN_WALL_HEIGHT protects.
    const solids = buildWallSolids(room);
    expect(solids[0].holes[0].top).toBe(WINDOW_HEAD);
    expect(solids[1].holes[0].top).toBe(DOOR_HEIGHT);
    // An explicit argument still wins over the room's setting.
    expect(buildWallSolids(room, 2)[1].holes[0].top).toBe(2);
  });
});

describe("cornerPosts", () => {
  it("fills every corner of the rectangular sample room", () => {
    const solids = buildWallSolids(createSampleRoom());
    const posts = cornerPosts(solids, 0.1);
    expect(posts).toHaveLength(4);
    const topLeft = posts.find((p) => p.corner.x === 0 && p.corner.y === 0);
    // Between left wall (outward -x) and top wall (outward -y).
    expect(topLeft?.center).toEqual({ x: -0.05, y: -0.05 });
    expect(topLeft?.walls).toEqual([3, 0]);
  });

  it("skips concave corners, where walls overlap instead", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const solids = buildWallSolids({
      id: "room-1",
      outline,
      openings: [],
      furniture: [],
    });
    const posts = cornerPosts(solids, 0.1);
    expect(posts).toHaveLength(5);
    expect(
      posts.find((p) => p.corner.x === 2 && p.corner.y === 2),
    ).toBeUndefined();
  });
});

describe("buildWallSolids with seam data", () => {
  it("cuts phantom holes for a neighbor's portal openings", () => {
    const room = {
      id: "kitchen",
      outline: [
        { x: 6.4, y: 1 },
        { x: 10, y: 1 },
        { x: 10, y: 4 },
        { x: 6.4, y: 4 },
      ],
      openings: [],
      furniture: [],
    };
    const solids = buildWallSolids(room, undefined, {
      seamSpans: new Map([[3, [{ start: 0, end: 3 }]]]),
      portalHoles: [
        { id: "door-1", kind: "door", wallIndex: 3, offset: 1.1, width: 0.9 },
      ],
    });
    expect(solids[3].seams).toEqual([{ start: 0, end: 3 }]);
    expect(solids[3].holes).toEqual([
      {
        id: "door-1",
        kind: "door",
        start: 1.1,
        width: expect.closeTo(0.9, 10),
        bottom: 0,
        top: DOOR_HEIGHT,
        phantom: true,
      },
    ]);
    // The other walls stay untouched, without seam spans.
    expect(solids[0].holes).toEqual([]);
    expect(solids[0].seams).toBeUndefined();
  });
});

describe("stubSpans", () => {
  const piece = (
    holes: Array<{ start: number; width: number; bottom: number }>,
    span = { start: 0, end: 5.2 },
  ) => ({
    ...span,
    seam: false,
    holes: holes.map((h, i) => ({
      id: `h-${i}`,
      kind: "door" as const,
      top: DOOR_HEIGHT,
      ...h,
    })),
  });

  it("covers a hole-free piece with one span", () => {
    expect(stubSpans(piece([]))).toEqual([{ start: 0, end: 5.2 }]);
  });

  it("turns a door hole into a full gap through the stub", () => {
    expect(stubSpans(piece([{ start: 2, width: 0.9, bottom: 0 }]))).toEqual([
      { start: 0, end: 2 },
      { start: 2.9, end: 5.2 },
    ]);
  });

  it("ignores windows: their sill sits above the stub top", () => {
    expect(WINDOW_SILL).toBeGreaterThan(STUB_WALL_HEIGHT);
    expect(
      stubSpans(piece([{ start: 3, width: 1.5, bottom: WINDOW_SILL }])),
    ).toEqual([{ start: 0, end: 5.2 }]);
  });

  it("drops spans that a piece-edge hole leaves degenerate", () => {
    // A door flush with the piece start (e.g. clipped at a seam boundary).
    expect(
      stubSpans(
        piece([{ start: 1, width: 0.8, bottom: 0 }], { start: 1, end: 4 }),
      ),
    ).toEqual([{ start: 1.8, end: 4 }]);
  });

  it("merges the cursor past overlapping gaps", () => {
    expect(
      stubSpans(
        piece([
          { start: 1, width: 1, bottom: 0 },
          { start: 1.5, width: 1, bottom: 0 },
        ]),
      ),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 2.5, end: 5.2 },
    ]);
  });
});

describe("wallPieces", () => {
  const baseSolid = {
    index: 1,
    start: { x: 6.4, y: 0 },
    dir: { x: 0, y: 1 },
    outward: { x: 1, y: 0 },
    length: 5.2,
    holes: [],
  };

  it("keeps an unshared wall as one full-thickness piece", () => {
    expect(wallPieces(baseSolid)).toEqual([
      { start: 0, end: 5.2, seam: false, holes: [] },
    ]);
  });

  it("splits at the seam boundaries and assigns holes to their pieces", () => {
    const door = {
      id: "door-1",
      kind: "door" as const,
      start: 2,
      width: 0.9,
      bottom: 0,
      top: DOOR_HEIGHT,
    };
    const window = {
      id: "window-1",
      kind: "window" as const,
      start: 4.5,
      width: 0.5,
      bottom: WINDOW_SILL,
      top: WINDOW_HEAD,
    };
    const pieces = wallPieces({
      ...baseSolid,
      holes: [door, window],
      seams: [{ start: 1, end: 4 }],
    });
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toEqual({ start: 0, end: 1, seam: false, holes: [] });
    expect(pieces[1]).toEqual({ start: 1, end: 4, seam: true, holes: [door] });
    expect(pieces[2]).toEqual({
      start: 4,
      end: 5.2,
      seam: false,
      holes: [window],
    });
  });

  it("clips a hole straddling a seam boundary into both pieces", () => {
    const door = {
      id: "door-1",
      kind: "door" as const,
      start: 3.8,
      width: 0.4,
      bottom: 0,
      top: DOOR_HEIGHT,
    };
    const pieces = wallPieces({
      ...baseSolid,
      holes: [door],
      seams: [{ start: 1, end: 4 }],
    });
    // Widths compare as the exact float differences the clipping computes.
    expect(pieces[1].holes).toEqual([{ ...door, start: 3.8, width: 4 - 3.8 }]);
    expect(pieces[2].holes).toEqual([
      { ...door, start: 4, width: 3.8 + 0.4 - 4 },
    ]);
  });

  it("covers a fully shared wall with one seam piece", () => {
    expect(
      wallPieces({ ...baseSolid, seams: [{ start: 0, end: 5.2 }] }),
    ).toEqual([{ start: 0, end: 5.2, seam: true, holes: [] }]);
  });
});
