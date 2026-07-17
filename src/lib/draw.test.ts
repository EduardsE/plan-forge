import { describe, expect, it } from "vitest";
import type { Floor } from "#/lib/model";
import {
  rectangleOutline,
  snapDraftPoint,
  snapRectPoint,
  snapTargetsOfGraph,
  targetAxisCandidate,
} from "./draw";

const TOL = 0.1;

/** An existing 6.4 × 5.2 room as a wall graph the draft snaps against
 * (plan coords, y down). */
const NEIGHBOR: Floor = {
  nodes: [
    { id: "n0", x: 0, y: 0 },
    { id: "n1", x: 6.4, y: 0 },
    { id: "n2", x: 6.4, y: 5.2 },
    { id: "n3", x: 0, y: 5.2 },
  ],
  edges: [
    { id: "e0", a: "n0", b: "n1" },
    { id: "e1", a: "n1", b: "n2" },
    { id: "e2", a: "n2", b: "n3" },
    { id: "e3", a: "n3", b: "n0" },
  ],
  openings: [],
  furniture: [],
  rooms: [],
};
const TARGETS = snapTargetsOfGraph(NEIGHBOR);

describe("snapDraftPoint", () => {
  it("quantizes a free cursor to the 5 cm draw grid", () => {
    const snap = snapDraftPoint([], { x: 2.03, y: 1.28 }, TOL);
    expect(snap.point).toEqual({ x: 2.05, y: 1.3 });
    expect(snap.axisSnapped).toBe(false);
  });

  it("locks the preview horizontal from the last corner", () => {
    const snap = snapDraftPoint([{ x: 0, y: 0 }], { x: 2.03, y: 0.06 }, TOL);
    expect(snap.point).toEqual({ x: 2.05, y: 0 });
    expect(snap.axisSnapped).toBe(true);
  });

  it("locks the preview vertical from the last corner", () => {
    const snap = snapDraftPoint([{ x: 6.4, y: 0 }], { x: 6.45, y: 2.5 }, TOL);
    expect(snap.point).toEqual({ x: 6.4, y: 2.5 });
    expect(snap.axisSnapped).toBe(true);
  });

  it("passes the raw cursor through when snapping is off", () => {
    // Would otherwise axis-lock to the last corner and quantize to 5 cm.
    const snap = snapDraftPoint(
      [{ x: 0, y: 0 }],
      { x: 2.03, y: 0.06 },
      TOL,
      false,
    );
    expect(snap.point).toEqual({ x: 2.03, y: 0.06 });
    expect(snap.axisSnapped).toBe(false);
  });
});

describe("snapTargetsOfGraph", () => {
  it("collects every node and edge of the graph", () => {
    expect(TARGETS.corners).toHaveLength(4);
    expect(TARGETS.walls).toHaveLength(4);
    expect(TARGETS.walls[1].start).toEqual({ x: 6.4, y: 0 });
    expect(TARGETS.walls[1].end).toEqual({ x: 6.4, y: 5.2 });
  });
});

describe("targetAxisCandidate centerline capture", () => {
  // The right wall's centerline is x = 6.4; a cursor within tolerance of it
  // snaps onto the line (welding onto the wall), no outer-face push.
  const tol = 0.03;

  it("snaps a cursor within tolerance of the line onto the centerline", () => {
    const candidate = targetAxisCandidate(
      TARGETS,
      "x",
      { x: 6.42, y: 2.5 },
      tol,
    );
    expect(candidate?.value).toBe(6.4);
    expect(candidate?.snap.kind).toBe("wall");
  });

  it("captures the tolerance band on both sides of the line, no further", () => {
    expect(
      targetAxisCandidate(TARGETS, "x", { x: 6.38, y: 2.5 }, tol)?.value,
    ).toBe(6.4);
    expect(
      targetAxisCandidate(TARGETS, "x", { x: 6.44, y: 2.5 }, tol),
    ).toBeNull();
    expect(
      targetAxisCandidate(TARGETS, "x", { x: 6.36, y: 2.5 }, tol),
    ).toBeNull();
  });

  it("prefers the wall line over an equally-distant corner", () => {
    const targets = {
      corners: [{ x: 6.44, y: 20 }],
      walls: TARGETS.walls,
    };
    // Cursor 6.42 sits 0.02 from both the wall line (6.4) and the corner
    // (6.44); the wall (set first) wins the tie.
    const candidate = targetAxisCandidate(
      targets,
      "x",
      { x: 6.42, y: 2.5 },
      tol,
    );
    expect(candidate?.value).toBe(6.4);
    expect(candidate?.snap.kind).toBe("wall");
  });
});

describe("snapDraftPoint against the graph", () => {
  it("composes a corner from two wall centerlines", () => {
    // Both axes capture a wall centerline around the bottom-right corner, so
    // the point lands on the corner (6.4, 5.2) — welding onto it.
    const snap = snapDraftPoint([], { x: 6.45, y: 5.13 }, TOL, true, TARGETS);
    expect(snap.point).toEqual({ x: 6.4, y: 5.2 });
    expect(snap.floorSnap?.kind).toBe("wall");
  });

  it("keeps the axis lock and pins the free coordinate to the centerline", () => {
    // The last corner axis-locks y to 5.15; x pins onto the right wall's
    // centerline (welding onto it).
    const snap = snapDraftPoint(
      [{ x: 8, y: 5.15 }],
      { x: 6.45, y: 5.12 },
      TOL,
      true,
      TARGETS,
    );
    expect(snap.point).toEqual({ x: 6.4, y: 5.15 });
    expect(snap.axisSnapped).toBe(true);
    expect(snap.floorSnap?.kind).toBe("wall");
  });

  it("pins a coordinate to a wall's centerline within its span", () => {
    const snap = snapDraftPoint([], { x: 6.45, y: 2.52 }, TOL, true, TARGETS);
    expect(snap.point).toEqual({ x: 6.4, y: 2.5 });
    expect(snap.floorSnap?.kind).toBe("wall");
  });

  it("aligns with a node's coordinate beyond the wall span", () => {
    // y = 8 is far past the right wall's span, so the wall no longer pins x,
    // but the node coordinate still aligns (the flush-extension case).
    const snap = snapDraftPoint([], { x: 6.44, y: 8.03 }, TOL, true, TARGETS);
    expect(snap.point).toEqual({ x: 6.4, y: 8.05 });
    expect(snap.floorSnap).toEqual({
      kind: "align",
      at: { x: 6.4, y: 0 },
      axis: "x",
    });
  });

  it("composes an axis lock with a wall pin on the free coordinate", () => {
    const snap = snapDraftPoint(
      [{ x: 2, y: 2.5 }],
      { x: 6.37, y: 2.53 },
      TOL,
      true,
      TARGETS,
    );
    expect(snap.point).toEqual({ x: 6.4, y: 2.5 });
    expect(snap.axisSnapped).toBe(true);
    expect(snap.floorSnap?.kind).toBe("wall");
  });

  it("passes the raw cursor through when snapping is off", () => {
    const snap = snapDraftPoint([], { x: 6.45, y: 5.13 }, TOL, false, TARGETS);
    expect(snap.point).toEqual({ x: 6.45, y: 5.13 });
    expect(snap.floorSnap).toBeNull();
  });
});

describe("snapRectPoint", () => {
  it("quantizes both axes to the 5 cm draw grid", () => {
    expect(snapRectPoint({ x: 2.03, y: 1.28 })).toEqual({ x: 2.05, y: 1.3 });
  });

  it("passes the raw cursor through when snapping is off", () => {
    expect(snapRectPoint({ x: 2.03, y: 1.28 }, false)).toEqual({
      x: 2.03,
      y: 1.28,
    });
  });

  it("pins each coordinate to an existing wall centerline or node", () => {
    // x pins onto the right wall's centerline, y free → quantized.
    expect(snapRectPoint({ x: 6.43, y: 1.28 }, true, TARGETS, TOL)).toEqual({
      x: 6.4,
      y: 1.3,
    });
    // Both coordinates capture a centerline near the bottom-right corner —
    // the rectangle corner lands on the graph corner.
    expect(snapRectPoint({ x: 6.44, y: 5.16 }, true, TARGETS, TOL)).toEqual({
      x: 6.4,
      y: 5.2,
    });
    // Within the tolerance band the centerline pins past the grid too.
    expect(snapRectPoint({ x: 6.42, y: 1.28 }, true, TARGETS, 0.03)).toEqual({
      x: 6.4,
      y: 1.3,
    });
  });
});

describe("rectangleOutline", () => {
  it("winds clockwise from two opposite corners regardless of click order", () => {
    const expected = [
      { x: 0, y: 0 },
      { x: 6.4, y: 0 },
      { x: 6.4, y: 5.2 },
      { x: 0, y: 5.2 },
    ];
    // Bottom-right dragged from the top-left, and the reverse.
    expect(rectangleOutline({ x: 0, y: 0 }, { x: 6.4, y: 5.2 })).toEqual(
      expected,
    );
    expect(rectangleOutline({ x: 6.4, y: 5.2 }, { x: 0, y: 0 })).toEqual(
      expected,
    );
  });

  it("returns null when either side collapses", () => {
    expect(rectangleOutline({ x: 1, y: 1 }, { x: 1, y: 4 })).toBeNull();
    expect(rectangleOutline({ x: 1, y: 1 }, { x: 4, y: 1 })).toBeNull();
    expect(rectangleOutline({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});
