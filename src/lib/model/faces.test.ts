import { describe, expect, it } from "vitest";
import {
  extractFaces,
  faceLabelPoint,
  insetPolygon,
  sideOfPoint,
} from "./faces";
import { pointInOutline } from "./geometry";

const node = (id: string, x: number, y: number) => ({ id, x, y });
const edge = (id: string, a: string, b: string) => ({ id, a, b });
const square = {
  nodes: [node("a", 0, 0), node("b", 5, 0), node("c", 5, 4), node("d", 0, 4)],
  edges: [
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("cd", "c", "d"),
    edge("da", "d", "a"),
  ],
};

describe("extractFaces", () => {
  it("finds one interior face for a rectangle, positive area, sample winding", () => {
    const faces = extractFaces(square);
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(20);
    expect(faces[0].nodeIds).toHaveLength(4);
    // Winding matches the sample convention: positive shoelace sign.
    const p = faces[0].polygon;
    let sum = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      sum += p[i].x * q.y - q.x * p[i].y;
    }
    expect(sum).toBeGreaterThan(0);
  });

  it("finds two faces for two rectangles sharing an edge — the shared edge in both", () => {
    const g = {
      nodes: [...square.nodes, node("e", 9, 0), node("f", 9, 4)],
      edges: [
        edge("ab", "a", "b"),
        edge("bc", "b", "c"),
        edge("cd", "c", "d"),
        edge("da", "d", "a"),
        edge("be", "b", "e"),
        edge("ef", "e", "f"),
        edge("fc", "f", "c"),
      ],
    };
    const faces = extractFaces(g);
    expect(faces).toHaveLength(2);
    expect(faces.every((f) => f.edgeIds.includes("bc"))).toBe(true);
    expect(faces.map((f) => f.area).sort()).toEqual([16, 20]);
  });

  it("yields no face for an open chain, one face for square-plus-dangling-edge", () => {
    expect(
      extractFaces({
        nodes: [node("a", 0, 0), node("b", 3, 0), node("c", 3, 2)],
        edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
      }),
    ).toHaveLength(0);
    const g = {
      nodes: [...square.nodes, node("x", 8, 8)],
      edges: [...square.edges, edge("dx", "c", "x")],
    };
    expect(extractFaces(g)).toHaveLength(1);
  });

  it("handles a concave L-shape", () => {
    const g = {
      nodes: [
        node("a", 0, 0),
        node("b", 6, 0),
        node("c", 6, 2),
        node("d", 3, 2),
        node("e", 3, 5),
        node("f", 0, 5),
      ],
      edges: [
        edge("1", "a", "b"),
        edge("2", "b", "c"),
        edge("3", "c", "d"),
        edge("4", "d", "e"),
        edge("5", "e", "f"),
        edge("6", "f", "a"),
      ],
    };
    const faces = extractFaces(g);
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(6 * 2 + 3 * 3);
  });
});

describe("insetPolygon", () => {
  it("insets a rectangle symmetrically", () => {
    const inset = insetPolygon(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 4 },
        { x: 0, y: 4 },
      ],
      0.05,
    );
    expect(inset).toEqual([
      { x: 0.05, y: 0.05 },
      { x: 4.95, y: 0.05 },
      { x: 4.95, y: 3.95 },
      { x: 0.05, y: 3.95 },
    ]);
  });

  it("returns null when the polygon is too thin to inset", () => {
    expect(
      insetPolygon(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 0.08 },
          { x: 0, y: 0.08 },
        ],
        0.05,
      ),
    ).toBeNull();
  });
});

describe("faceLabelPoint / sideOfPoint", () => {
  it("label point lies inside a concave polygon", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 5 },
      { x: 0, y: 5 },
    ];
    const p = faceLabelPoint(poly);
    expect(p.x).toBeGreaterThan(0);
    expect(pointInOutline(poly, p)).toBe(true);
  });

  it("sideOfPoint is antisymmetric across the line", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };
    expect(sideOfPoint(a, b, { x: 2, y: 1 })).toBe(
      -sideOfPoint(a, b, { x: 2, y: -1 }) as 1 | -1,
    );
  });
});
