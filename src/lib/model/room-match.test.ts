import { describe, expect, it } from "vitest";
import { extractFaces } from "./faces";
import { matchRooms } from "./room-match";

const rect = (x0: number, x1: number, prefix: string) => ({
  nodes: [
    { id: `${prefix}a`, x: x0, y: 0 },
    { id: `${prefix}b`, x: x1, y: 0 },
    { id: `${prefix}c`, x: x1, y: 4 },
    { id: `${prefix}d`, x: x0, y: 4 },
  ],
  edges: [
    { id: `${prefix}1`, a: `${prefix}a`, b: `${prefix}b` },
    { id: `${prefix}2`, a: `${prefix}b`, b: `${prefix}c` },
    { id: `${prefix}3`, a: `${prefix}c`, b: `${prefix}d` },
    { id: `${prefix}4`, a: `${prefix}d`, b: `${prefix}a` },
  ],
});
const twoFaces = () => {
  const l = rect(0, 5, "l");
  const r = rect(5, 9, "r"); // separate square sharing the x=5 line? No —
  // distinct nodes; two disjoint loops is fine for matching tests.
  return extractFaces({
    nodes: [...l.nodes, ...r.nodes],
    edges: [...l.edges, ...r.edges],
  });
};
let n = 0;
const nextId = () => `new-${n++}`;

describe("matchRooms", () => {
  it("matches records to the faces containing their anchors, re-centering anchors", () => {
    const faces = twoFaces();
    const records = [
      { id: "kitchen", name: "Kitchen", anchor: { x: 7, y: 2 } },
      { id: "living", name: "Living room", anchor: { x: 2, y: 2 } },
    ];
    const result = matchRooms(records, faces, nextId);
    expect(result.matched.map((m) => m.record.id)).toEqual([
      "kitchen",
      "living",
    ]);
    expect(result.records).toHaveLength(2);
    const kitchen = result.matched[0];
    // Anchor re-centered into its face (the 5..9 rectangle).
    expect(kitchen.record.anchor.x).toBeGreaterThan(5);
  });

  it("creates auto-named records for unclaimed faces", () => {
    const result = matchRooms([], twoFaces(), nextId);
    expect(result.matched).toHaveLength(2);
    expect(result.records.map((r) => r.name)).toEqual(["Room 1", "Room 2"]);
  });

  it("keeps a record whose face vanished (dormant) and revives it on reclose", () => {
    const dormant = {
      id: "kitchen",
      name: "Kitchen",
      wallHeight: 3,
      anchor: { x: 7, y: 2 },
    };
    const gone = matchRooms([dormant], [], nextId);
    expect(gone.matched).toHaveLength(0);
    expect(gone.records).toEqual([dormant]);
    const back = matchRooms(gone.records, twoFaces(), nextId);
    const kitchen = back.matched.find((m) => m.record.id === "kitchen");
    expect(kitchen?.record.name).toBe("Kitchen");
    expect(kitchen?.record.wallHeight).toBe(3);
  });

  it("two anchors in one face: first in registry order wins, the other goes dormant", () => {
    const faces = extractFaces(rect(0, 5, "l"));
    const result = matchRooms(
      [
        { id: "first", name: "First", anchor: { x: 1, y: 1 } },
        { id: "second", name: "Second", anchor: { x: 4, y: 3 } },
      ],
      faces,
      nextId,
    );
    expect(result.matched.map((m) => m.record.id)).toEqual(["first"]);
    expect(result.records.map((r) => r.id)).toEqual(["first", "second"]);
  });
});
