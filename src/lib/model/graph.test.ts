import { describe, expect, it } from "vitest";
import { type GraphState, normalizeGraph } from "./graph";

let counter = 0;
const nextId = () => `gen-${counter++}`;
const node = (id: string, x: number, y: number) => ({ id, x, y });
const edge = (id: string, a: string, b: string) => ({ id, a, b });
const state = (partial: Partial<GraphState>): GraphState => ({
  nodes: [],
  edges: [],
  openings: [],
  ...partial,
});

describe("normalizeGraph", () => {
  it("welds nodes within tolerance and keeps grid-distinct nodes apart", () => {
    const g = normalizeGraph(
      state({
        nodes: [
          node("a", 0, 0),
          node("b", 0.02, 0), // 2 cm from a → welds
          node("c", 0.05, 1), // one grid step from d in x… (1 m away in y: stays)
          node("d", 0, 1.05),
        ],
        edges: [edge("e1", "a", "c"), edge("e2", "b", "d")],
      }),
      nextId,
    );
    expect(g.nodes).toHaveLength(3);
    // Earlier node absorbs: "a" survives at its own position.
    expect(g.nodes.map((n) => n.id)).toContain("a");
    expect(g.nodes.map((n) => n.id)).not.toContain("b");
    expect(g.edges.map((e) => [e.a, e.b])).toContainEqual(["a", "d"]);
  });

  it("drops zero-length and duplicate edges, re-homing a reversed duplicate's opening", () => {
    const g = normalizeGraph(
      state({
        nodes: [node("a", 0, 0), node("b", 4, 0)],
        edges: [
          edge("e1", "a", "b"),
          edge("e2", "b", "a"), // reversed duplicate
          edge("e3", "a", "a"), // zero-length
        ],
        openings: [
          // On the reversed edge: 1 m from b, 0.8 wide, swinging side +1.
          {
            id: "o1",
            kind: "door",
            edgeId: "e2",
            offset: 1,
            width: 0.8,
            side: 1,
          },
        ],
      }),
      nextId,
    );
    expect(g.edges).toHaveLength(1);
    const o = g.openings[0];
    expect(o.edgeId).toBe("e1");
    // Mirrored: offset from a = 4 - 1 - 0.8, side flips.
    expect(o.offset).toBeCloseTo(2.2);
    expect(o.side).toBe(-1);
  });

  it("splits an edge at a node on its interior (T-junction) and re-homes openings", () => {
    const g = normalizeGraph(
      state({
        nodes: [
          node("a", 0, 0),
          node("b", 6, 0),
          node("t", 4, 0.01),
          node("s", 4, 2),
        ],
        edges: [edge("e1", "a", "b"), edge("stub", "t", "s")],
        openings: [
          {
            id: "left",
            kind: "window",
            edgeId: "e1",
            offset: 1,
            width: 1,
            side: 1,
          },
          {
            id: "right",
            kind: "door",
            edgeId: "e1",
            offset: 4.5,
            width: 0.9,
            side: 1,
          },
        ],
      }),
      nextId,
    );
    // t snaps onto the line (y=0) and splits e1 into a→t and t→b.
    const horizontal = g.edges.filter((e) => e.id !== "stub");
    expect(horizontal).toHaveLength(2);
    const left = g.openings.find((o) => o.id === "left");
    const right = g.openings.find((o) => o.id === "right");
    expect(left?.offset).toBeCloseTo(1);
    expect(right?.offset).toBeCloseTo(0.5); // 4.5 - 4 on the t→b piece
  });

  it("splits two crossing edges at their intersection", () => {
    const g = normalizeGraph(
      state({
        nodes: [
          node("a", 0, 1),
          node("b", 4, 1),
          node("c", 2, 0),
          node("d", 2, 3),
        ],
        edges: [edge("h", "a", "b"), edge("v", "c", "d")],
      }),
      nextId,
    );
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
  });

  it("drops orphan nodes and openings that no longer fit their edge", () => {
    const g = normalizeGraph(
      state({
        nodes: [node("a", 0, 0), node("b", 0.5, 0), node("lonely", 9, 9)],
        edges: [edge("e1", "a", "b")],
        openings: [
          {
            id: "big",
            kind: "door",
            edgeId: "e1",
            offset: 0,
            width: 0.9,
            side: 1,
          },
          {
            id: "gone",
            kind: "door",
            edgeId: "dead",
            offset: 0,
            width: 0.9,
            side: 1,
          },
        ],
      }),
      nextId,
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.openings).toHaveLength(0); // 0.9 door can't fit a 0.5 wall
  });

  it("is idempotent", () => {
    const once = normalizeGraph(
      state({
        nodes: [
          node("a", 0, 0),
          node("b", 6, 0),
          node("t", 3, 0),
          node("u", 3, 2),
        ],
        edges: [edge("e1", "a", "b"), edge("e2", "t", "u")],
      }),
      nextId,
    );
    const twice = normalizeGraph(once, nextId);
    expect(twice).toEqual(once);
    // No-op contract: a settled graph returns the very same object reference.
    expect(twice).toBe(once);
  });

  it("returns the same reference when nothing needs repair", () => {
    const settled = state({
      nodes: [node("a", 0, 0), node("b", 4, 0)],
      edges: [edge("e1", "a", "b")],
    });
    expect(normalizeGraph(settled, nextId)).toBe(settled);
  });

  it("drops an edge whose endpoint resolves to no node", () => {
    const g = normalizeGraph(
      state({
        nodes: [node("a", 0, 0), node("b", 4, 0)],
        edges: [
          edge("e1", "a", "b"),
          edge("e2", "a", "ghost"), // dangling reference → dropped
        ],
      }),
      nextId,
    );
    expect(g.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
