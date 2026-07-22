import { describe, expect, it } from "vitest";
import type { Floor, Point } from "#/lib/model";
import { deriveFloor, floorArea } from "#/lib/model";
import { makeFloor } from "#/lib/model/test-fixtures";
import {
  addWallSegment,
  deleteEdge,
  deleteNode,
  moveNodePreview,
  setEdgeLength,
  settleNodeMove,
  snapNodeDrag,
  splitEdgeAt,
} from "./graph-edit";

/** Deterministic id factory so minted ids are stable in tests. */
function idFactory() {
  let n = 0;
  return () => `gen-${n++}`;
}

function worldCenter(floor: Floor, openingId: string): Point {
  const opening = floor.openings.find((o) => o.id === openingId);
  if (!opening) throw new Error("missing opening");
  const edge = floor.edges.find((e) => e.id === opening.edgeId);
  if (!edge) throw new Error("missing host edge");
  const a = floor.nodes.find((n) => n.id === edge.a);
  const b = floor.nodes.find((n) => n.id === edge.b);
  if (!a || !b) throw new Error("missing host nodes");
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const mid = opening.offset + opening.width / 2;
  return { x: a.x + dir.x * mid, y: a.y + dir.y * mid };
}

describe("settleNodeMove", () => {
  it("reshapes both faces sharing the dragged node, keeping record ids", () => {
    const floor = makeFloor();
    const before = deriveFloor(floor);
    const after = deriveFloor(settleNodeMove(floor, "E", { x: 6.4, y: 4.0 }));

    expect(after.rooms.map((r) => r.id).sort()).toEqual(["kitchen", "living"]);
    for (const id of ["living", "kitchen"]) {
      const b = before.rooms.find((r) => r.id === id);
      const a = after.rooms.find((r) => r.id === id);
      if (!a || !b) throw new Error(`missing room ${id}`);
      expect(floorArea(a.outline)).not.toBeCloseTo(floorArea(b.outline), 3);
    }
  });

  it("welds a node dragged onto another: count drops, no duplicate edges", () => {
    const floor = makeFloor();
    expect(floor.nodes).toHaveLength(6);
    const welded = settleNodeMove(floor, "C", { x: 9.45, y: 5.25 });
    expect(welded.nodes).toHaveLength(5);
    const keys = welded.edges.map((e) => [e.a, e.b].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("no-ops by reference on an unknown id", () => {
    const floor = makeFloor();
    expect(settleNodeMove(floor, "nope", { x: 1, y: 1 })).toBe(floor);
  });
});

describe("moveNodePreview", () => {
  it("does not weld at a coincident position (raw move, count unchanged)", () => {
    const floor = makeFloor();
    const preview = moveNodePreview(floor, "C", { x: 9.45, y: 5.25 });
    expect(preview.nodes).toHaveLength(6);
    expect(preview.nodes.find((n) => n.id === "C")).toEqual({
      id: "C",
      x: 9.45,
      y: 5.25,
    });
  });

  it("no-ops by reference on an unknown id", () => {
    const floor = makeFloor();
    expect(moveNodePreview(floor, "nope", { x: 1, y: 1 })).toBe(floor);
  });
});

describe("addWallSegment", () => {
  it("closing a detached chain births one face with an auto-named record", () => {
    let floor: Floor = makeFloor();
    const before = deriveFloor(floor).rooms.length;
    const newId = idFactory();
    const a = { x: 20, y: 20 };
    const b = { x: 24, y: 20 };
    const c = { x: 24, y: 24 };
    const d = { x: 20, y: 24 };
    floor = addWallSegment(floor, a, b, newId);
    floor = addWallSegment(floor, b, c, newId);
    floor = addWallSegment(floor, c, d, newId);
    floor = addWallSegment(floor, d, a, newId);

    expect(deriveFloor(floor).rooms).toHaveLength(before + 1);
    expect(floor.rooms).toHaveLength(3);
    expect(floor.rooms.map((r) => r.name)).toContain("Room 3");
  });

  it("landing on an existing edge's interior splits it (T-junction)", () => {
    const floor = addWallSegment(
      makeFloor(),
      { x: 3, y: -3 },
      { x: 3, y: -0.05 },
      idFactory(),
    );
    const tnode = floor.nodes.find(
      (n) => Math.abs(n.x - 3) < 1e-6 && Math.abs(n.y + 0.05) < 1e-6,
    );
    expect(tnode).toBeDefined();
    if (!tnode) throw new Error("missing T-node");
    const degree = floor.edges.filter(
      (e) => e.a === tnode.id || e.b === tnode.id,
    ).length;
    expect(degree).toBe(3);
    // The original AB edge was split, not left whole.
    expect(floor.edges.some((e) => e.id === "AB")).toBe(false);
  });
});

describe("splitEdgeAt", () => {
  it("inserts a node at the quantized projection", () => {
    const floor = splitEdgeAt(
      makeFloor(),
      "AB",
      { x: 3, y: -0.05 },
      idFactory(),
    );
    const node = floor.nodes.find(
      (n) => Math.abs(n.x - 3) < 1e-6 && Math.abs(n.y + 0.05) < 1e-6,
    );
    expect(node).toBeDefined();
    expect(floor.edges.some((e) => e.id === "AB")).toBe(false);
  });

  it("refuses a split within the corner clearance, and unknown ids", () => {
    const base = makeFloor();
    expect(splitEdgeAt(base, "AB", { x: 0.05, y: -0.05 })).toBe(base);
    expect(splitEdgeAt(base, "nope", { x: 3, y: -0.05 })).toBe(base);
  });
});

describe("deleteEdge", () => {
  it("merges the two faces on the shared edge into one identity", () => {
    const floor = deleteEdge(makeFloor(), "BE");
    const derived = deriveFloor(floor);
    expect(derived.rooms).toHaveLength(1);
    expect(derived.rooms[0].id).toBe("living");
    // The kitchen record survives dormant in the registry.
    expect(floor.rooms.map((r) => r.id).sort()).toEqual(["kitchen", "living"]);
    // The shared edge's door is gone with it.
    expect(floor.openings.find((o) => o.id === "door-BE")).toBeUndefined();
  });

  it("no-ops by reference on an unknown id", () => {
    const floor = makeFloor();
    expect(deleteEdge(floor, "nope")).toBe(floor);
  });
});

describe("deleteNode", () => {
  it("merges two collinear edges, re-projecting a window's world position", () => {
    const floor: Floor = {
      id: "fixture",
      nodes: [
        { id: "P", x: 0, y: 0 },
        { id: "M", x: 3, y: 0 },
        { id: "Q", x: 6, y: 0 },
      ],
      edges: [
        { id: "PM", a: "P", b: "M" },
        { id: "MQ", a: "M", b: "Q" },
      ],
      openings: [
        {
          id: "win",
          kind: "window",
          edgeId: "MQ",
          offset: 1,
          width: 1,
          side: 1,
        },
      ],
      furniture: [],
      rooms: [],
      stairs: [],
    };
    // Window world center before: M(3,0) + 1.5 along +x = (4.5, 0).
    const merged = deleteNode(floor, "M", idFactory());
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(["P", "Q"]);
    expect(merged.edges).toHaveLength(1);
    const win = merged.openings.find((o) => o.id === "win");
    expect(win).toBeDefined();
    expect(worldCenter(merged, "win").x).toBeCloseTo(4.5, 4);
  });

  it("keeps a stacked pair in place through a merge (no sideways shove)", () => {
    const floor: Floor = {
      id: "fixture",
      nodes: [
        { id: "P", x: 0, y: 0 },
        { id: "M", x: 3, y: 0 },
        { id: "Q", x: 6, y: 0 },
      ],
      edges: [
        { id: "PM", a: "P", b: "M" },
        { id: "MQ", a: "M", b: "Q" },
      ],
      openings: [
        {
          id: "win-low",
          kind: "window",
          edgeId: "MQ",
          offset: 1,
          width: 1,
          side: 1,
        },
        {
          // Same span, vertically clear band — a stacked window.
          id: "win-high",
          kind: "window",
          edgeId: "MQ",
          offset: 1,
          width: 1,
          side: 1,
          sill: 2.0,
          head: 2.6,
        },
      ],
      furniture: [],
      rooms: [],
      stairs: [],
    };
    const merged = deleteNode(floor, "M", idFactory());
    // Both survive at the same world spot: (4.5, 0) center each.
    expect(worldCenter(merged, "win-low").x).toBeCloseTo(4.5, 4);
    expect(worldCenter(merged, "win-high").x).toBeCloseTo(4.5, 4);
  });

  it("no-ops by reference on an unknown id", () => {
    const floor = makeFloor();
    expect(deleteNode(floor, "nope")).toBe(floor);
  });
});

describe("setEdgeLength", () => {
  it("moves the free node and drags the perpendicular wall's corner with it", () => {
    const floor = setEdgeLength(makeFloor(), "CD", 4.0, "a");
    expect(floor.nodes.find((n) => n.id === "D")).toEqual({
      id: "D",
      x: 9.45,
      y: 3.95,
    });
    // The perpendicular wall DE's far node (E) is untouched.
    expect(floor.nodes.find((n) => n.id === "E")).toEqual({
      id: "E",
      x: 6.4,
      y: 5.25,
    });
  });

  it("no-ops by reference on invalid lengths and unknown ids", () => {
    const floor = makeFloor();
    expect(setEdgeLength(floor, "CD", 0, "a")).toBe(floor);
    expect(setEdgeLength(floor, "CD", -2, "a")).toBe(floor);
    expect(setEdgeLength(floor, "nope", 3, "a")).toBe(floor);
  });
});

describe("snapNodeDrag", () => {
  it("locks an axis to another node and quantizes the free axis", () => {
    const floor = makeFloor();
    const snap = snapNodeDrag(floor, "E", { x: 6.42, y: 2.53 }, 0.1, true);
    expect(snap.point).toEqual({ x: 6.4, y: 2.55 });
    expect(snap.guides).toContainEqual({ nodeId: "B", axis: "x" });
  });

  it("passes the raw cursor through when snapping is off", () => {
    const floor = makeFloor();
    const snap = snapNodeDrag(floor, "E", { x: 6.42, y: 2.53 }, 0.1, false);
    expect(snap.point).toEqual({ x: 6.42, y: 2.53 });
    expect(snap.guides).toEqual([]);
  });
});
