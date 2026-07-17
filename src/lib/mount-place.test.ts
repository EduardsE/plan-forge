import { describe, expect, it } from "vitest";
import type { Floor, Point } from "#/lib/model";
import { mountAt } from "#/lib/mount-place";

/** A rectangular single-face graph floor from its interior corners. */
function rectFloor(w: number, h: number): Floor {
  return {
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: w, y: 0 },
      { id: "c", x: w, y: h },
      { id: "d", x: 0, y: h },
    ],
    edges: [
      { id: "ab", a: "a", b: "b" },
      { id: "bc", a: "b", b: "c" },
      { id: "cd", a: "c", b: "d" },
      { id: "da", a: "d", b: "a" },
    ],
    openings: [],
    furniture: [],
    rooms: [],
  };
}

const FLOOR = rectFloor(6.4, 5.2);
const FOOTPRINT = { width: 0.9, depth: 0.06 };
const at = (p: Point, snap = true) => mountAt(FLOOR, p, FOOTPRINT, 1.5, snap);

describe("mountAt", () => {
  it("mounts to the nearest edge, flush against its face", () => {
    // Cursor just below the top edge, near x=2.
    const result = at({ x: 2, y: 0.4 });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mount.edgeId).toBe("ab");
    expect(result.mount.side).toBe(1);
    expect(result.mount.elevation).toBe(1.5);
    // Center at cursor x=2, so near-edge offset ≈ 2 - 0.45 = 1.55.
    expect(result.mount.offset).toBeCloseTo(1.55);
    // Pushed off the centerline by t/2 + depth/2 = 0.05 + 0.03 = 0.08.
    expect(result.position.y).toBeCloseTo(0.08);
    expect(result.rotation).toBeCloseTo(0);
  });

  it("quantizes the offset to the placement grid when snapping", () => {
    const result = at({ x: 2.03, y: 0.3 });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mount.offset * 20).toBeCloseTo(
      Math.round(result.mount.offset * 20),
    );
  });

  it("clamps into the edge so the item can't hang past a corner", () => {
    const result = at({ x: 0.2, y: -1 });
    expect(result?.mount.edgeId).toBe("ab");
    expect(result?.mount.offset).toBeGreaterThanOrEqual(0);
  });

  it("emits corner guides while snapping, none when snap is off", () => {
    expect(at({ x: 2, y: 0.4 }, true)?.guides.length).toBeGreaterThan(0);
    expect(at({ x: 2, y: 0.4 }, false)?.guides).toEqual([]);
  });

  it("skips an edge too short for the item and returns null when none fit", () => {
    const tiny = rectFloor(0.5, 0.5);
    expect(mountAt(tiny, { x: 0.25, y: 0.1 }, FOOTPRINT, 1.5)).toBeNull();
  });

  it("returns null for a floor with no edges", () => {
    expect(
      mountAt(
        { nodes: [], edges: [], openings: [], furniture: [], rooms: [] },
        { x: 1, y: 1 },
        FOOTPRINT,
        1.5,
      ),
    ).toBeNull();
  });
});
