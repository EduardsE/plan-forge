import { describe, expect, it } from "vitest";
import { createSampleRoom } from "#/lib/model/sample-room";
import {
  buildWallSolids,
  cornerPosts,
  DOOR_HEIGHT,
  WALL_HEIGHT,
  WINDOW_HEAD,
  WINDOW_SILL,
} from "./room-scene";

describe("buildWallSolids", () => {
  it("yields no walls for degenerate outlines", () => {
    expect(
      buildWallSolids({ outline: [], openings: [], furniture: [] }),
    ).toEqual([]);
    expect(
      buildWallSolids({
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
    const solids = buildWallSolids({ outline, openings: [], furniture: [] });
    const posts = cornerPosts(solids, 0.1);
    expect(posts).toHaveLength(5);
    expect(
      posts.find((p) => p.corner.x === 2 && p.corner.y === 2),
    ).toBeUndefined();
  });
});
