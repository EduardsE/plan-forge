import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOUNT_ELEVATION,
  defaultMountElevation,
  deriveMountTransform,
  isWallItem,
  wallFrames,
} from "./wall-mount";

/** The sample room outline, wound clockwise in y-down plan coords. */
const OUTLINE = [
  { x: 0, y: 0 },
  { x: 6.4, y: 0 },
  { x: 6.4, y: 5.2 },
  { x: 0, y: 5.2 },
];

describe("wallFrames", () => {
  it("derives one frame per wall with outward normals pointing out of the room", () => {
    const frames = wallFrames(OUTLINE);
    expect(frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    // Top wall runs +x, its outward normal points up (out of the room = -y).
    expect(frames[0].dir).toEqual({ x: 1, y: 0 });
    expect(frames[0].outward.x).toBeCloseTo(0);
    expect(frames[0].outward.y).toBeCloseTo(-1);
    // Left wall runs -y (from (0,5.2) to (0,0)); outward points -x.
    expect(frames[3].dir).toEqual({ x: 0, y: -1 });
    expect(frames[3].outward.x).toBeCloseTo(-1);
    expect(frames[3].outward.y).toBeCloseTo(0);
    expect(frames[0].length).toBeCloseTo(6.4);
    expect(frames[3].length).toBeCloseTo(5.2);
  });

  it("yields no frames for a degenerate outline", () => {
    expect(
      wallFrames([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([]);
  });
});

describe("deriveMountTransform", () => {
  // A one-edge graph: the top wall from A(0,0) to B(6.4,0), running +x.
  const graph = {
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 6.4, y: 0 },
      { id: "f", x: 0, y: 5.2 },
    ],
    edges: [
      { id: "ab", a: "a", b: "b" },
      { id: "fa", a: "f", b: "a" },
    ],
  };

  it("centers the item along the edge and pushes it off the centerline by t/2 + depth/2", () => {
    const footprint = { width: 0.9, depth: 0.06 };
    // Edge AB, offset 2.0 → center at along 2.45; side 1's left normal is
    // (0, 1), pushing into the room by 0.05 + 0.03 = 0.08.
    const t = deriveMountTransform(
      { edgeId: "ab", offset: 2.0, side: 1, elevation: 1.5 },
      graph,
      footprint,
    );
    expect(t?.position.x).toBeCloseTo(2.45);
    expect(t?.position.y).toBeCloseTo(0.08);
    expect(t?.rotation).toBeCloseTo(0);
  });

  it("turns the width axis to align with the edge direction", () => {
    // Edge FA points -y; its yaw is 90° so the item's width runs vertically.
    const t = deriveMountTransform(
      { edgeId: "fa", offset: 1.0, side: 1, elevation: 1.5 },
      graph,
      { width: 0.9, depth: 0.06 },
    );
    expect(t?.rotation).toBeCloseTo(90);
  });

  it("returns null when the edge is gone", () => {
    expect(
      deriveMountTransform(
        { edgeId: "missing", offset: 1, side: 1, elevation: 1 },
        graph,
        { width: 0.9, depth: 0.06 },
      ),
    ).toBeNull();
  });
});

describe("defaultMountElevation", () => {
  it("hangs a picture frame lower than a clock", () => {
    expect(defaultMountElevation("picture-frame")).toBe(1.5);
    expect(defaultMountElevation("wall-clock")).toBe(1.9);
  });

  it("falls back for unknown ids", () => {
    expect(defaultMountElevation("mystery")).toBe(DEFAULT_MOUNT_ELEVATION);
  });
});

describe("isWallItem", () => {
  it("is true only for the wall-items category", () => {
    expect(isWallItem("picture-frame")).toBe(true);
    expect(isWallItem("wall-clock")).toBe(true);
    expect(isWallItem("desk")).toBe(false);
    expect(isWallItem("nope")).toBe(false);
  });
});

describe("deriveMountTransform with per-edge side halves", () => {
  const graph = {
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 5, y: 0 },
    ],
    edges: [{ id: "ab", a: "a", b: "b" }],
  };
  const mount = { edgeId: "ab", offset: 2, side: 1 as const, elevation: 1.5 };
  const footprint = { width: 1, depth: 0.04 };

  it("defaults to the standard half-thickness push", () => {
    const transform = deriveMountTransform(mount, graph, footprint);
    expect(transform?.position.y).toBeCloseTo(0.07, 9);
  });

  it("pushes off the resolved face of a thickened wall", () => {
    const halves = new Map([["ab", { pos: 0.15, neg: 0.05 }]]);
    const transform = deriveMountTransform(mount, graph, footprint, halves);
    expect(transform?.position.y).toBeCloseTo(0.17, 9);
  });
});
