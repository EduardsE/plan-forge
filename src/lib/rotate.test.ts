import { describe, expect, it } from "vitest";
import { footprintCorners } from "./model";
import { nearbyWallAngles, rotationAngleOf, snapRotationDeg } from "./rotate";

/** A 6 × 4 room with its top-left corner cut at 45°: the wall from
 * (1.5, 4) back to (0, 2.5) is the only non-axis segment. */
const CUT_ROOM = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 4 },
  { x: 1.5, y: 4 },
  { x: 0, y: 2.5 },
];

describe("rotationAngleOf", () => {
  it("maps the cardinal directions (plan y down, CCW-positive)", () => {
    expect(rotationAngleOf({ x: 1, y: 0 })).toBeCloseTo(0, 10);
    expect(rotationAngleOf({ x: 0, y: -1 })).toBeCloseTo(90, 10);
    expect(rotationAngleOf({ x: -1, y: 0 })).toBeCloseTo(180, 10);
    expect(rotationAngleOf({ x: 0, y: 1 })).toBeCloseTo(270, 10);
  });

  it("inverts footprintCorners' rotation convention", () => {
    // Where does local +x land for a 30°-rotated item? The midpoint of the
    // footprint's right edge (corners 1→2) sits along it.
    const item = {
      id: "probe",
      catalogId: "desk",
      position: { x: 2, y: 2 },
      rotation: 30,
      footprint: { width: 1, depth: 0.5, height: 1 },
    };
    const [, b, c] = footprintCorners(item);
    const rightEdgeMid = {
      x: (b.x + c.x) / 2 - item.position.x,
      y: (b.y + c.y) / 2 - item.position.y,
    };
    expect(rotationAngleOf(rightEdgeMid)).toBeCloseTo(30, 10);
  });
});

describe("snapRotationDeg", () => {
  it("snaps to the nearest 15° detent", () => {
    expect(snapRotationDeg(47)).toBe(45);
    expect(snapRotationDeg(53)).toBe(60);
    expect(snapRotationDeg(7.4)).toBe(0);
  });

  it("normalizes out-of-range angles onto the detents", () => {
    expect(snapRotationDeg(-10)).toBe(345);
    expect(snapRotationDeg(353)).toBe(0);
    expect(snapRotationDeg(722)).toBe(0);
  });

  it("lets a nearby wall angle win over the 15° grid", () => {
    expect(snapRotationDeg(42, [40])).toBe(40);
    // The wall angle detents at all four axis alignments.
    expect(snapRotationDeg(131, [40])).toBe(130);
    expect(snapRotationDeg(221, [40])).toBe(220);
    expect(snapRotationDeg(312, [40])).toBe(310);
  });

  it("prefers the wall angle on a tie", () => {
    expect(snapRotationDeg(42.5, [40])).toBe(40);
  });

  it("keeps the nearer 15° detent when the wall angle is farther", () => {
    expect(snapRotationDeg(44, [37.5])).toBe(45);
  });

  it("only rounds to whole degrees with snap off", () => {
    expect(snapRotationDeg(47.3, [40], false)).toBe(47);
    expect(snapRotationDeg(359.7, [], false)).toBe(0);
  });
});

describe("nearbyWallAngles", () => {
  it("yields the diagonal wall's tangent for an item beside it", () => {
    // 0.35 m from the 45° wall's line; a 1 × 1 footprint sweeps 0.71 m.
    const angles = nearbyWallAngles(CUT_ROOM, { x: 1.2, y: 3.2 }, 0.71);
    expect(angles).toHaveLength(1);
    expect(angles[0]).toBeCloseTo(45, 10);
  });

  it("yields nothing for an item out of the wall's reach", () => {
    expect(nearbyWallAngles(CUT_ROOM, { x: 4, y: 1 }, 0.71)).toEqual([]);
  });

  it("never includes axis-aligned walls", () => {
    // Flush in the room's bottom-right corner: two axis walls in reach.
    expect(nearbyWallAngles(CUT_ROOM, { x: 5.5, y: 3.5 }, 0.71)).toEqual([]);
  });

  it("measures reach to the segment, not its infinite line", () => {
    // On the diagonal's line extended past its end corner, but ~2.2 m from
    // the segment itself.
    const angles = nearbyWallAngles(CUT_ROOM, { x: 3.5, y: 5.9 }, 0.71);
    expect(angles).toEqual([]);
  });
});
