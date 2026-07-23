import { describe, expect, it } from "vitest";
import type { Floor, Point } from "#/lib/model";
import { mountAt, mountAtRay, type Vec3 } from "#/lib/mount-place";
import type { WallHole, WallSolid } from "#/lib/room-scene";

/** A rectangular single-face graph floor from its interior corners. */
function rectFloor(w: number, h: number): Floor {
  return {
    id: "fixture",
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
    stairs: [],
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
        {
          id: "empty",
          nodes: [],
          edges: [],
          openings: [],
          furniture: [],
          rooms: [],
          stairs: [],
        },
        { x: 1, y: 1 },
        FOOTPRINT,
        1.5,
      ),
    ).toBeNull();
  });
});

/** A wall solid of the FLOOR fixture (single interior room, height 2.7). */
function solid(
  index: number,
  edgeId: string,
  start: Point,
  dir: Point,
  length: number,
  outward: Point,
  holes: WallHole[] = [],
): WallSolid {
  return {
    index,
    edgeId,
    start,
    dir,
    outward,
    length,
    height: 2.7,
    thickness: 0.1,
    outwardShift: 0,
    outwardSign: -1,
    holes,
    faces: 1,
    faceSides: [1],
  };
}

/** The FLOOR rect's four walls; interior is the `+1` side of every edge. */
function rectSolids(holesOnAb: WallHole[] = []): WallSolid[] {
  return [
    solid(
      0,
      "ab",
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      6.4,
      { x: 0, y: -1 },
      holesOnAb,
    ),
    solid(1, "bc", { x: 6.4, y: 0 }, { x: 0, y: 1 }, 5.2, { x: 1, y: 0 }),
    solid(2, "cd", { x: 6.4, y: 5.2 }, { x: -1, y: 0 }, 6.4, { x: 0, y: 1 }),
    solid(3, "da", { x: 0, y: 5.2 }, { x: 0, y: -1 }, 5.2, { x: -1, y: 0 }),
  ];
}

/** An unnormalized ray from `origin` through `target` (floor-local). */
function rayTo(origin: Vec3, target: Vec3) {
  return {
    origin,
    dir: {
      x: target.x - origin.x,
      y: target.y - origin.y,
      z: target.z - origin.z,
    },
  };
}

// An orbit camera south of the room (plan y ≡ world z), above mid-height:
// the south wall "cd" faces it (stubbed by the cutaway), the north wall "ab"
// stands full across the room.
const CAMERA: Vec3 = { x: 3.2, y: 4, z: 10 };

describe("mountAtRay", () => {
  it("hangs the item on the aimed far wall's interior face, not behind it", () => {
    // Aim over the stubbed near wall at a point on the far wall "ab". The
    // floor-plane projection of this ray lands *behind* ab (plan y < 0) —
    // the ray pick must still choose the interior (+1) face being aimed at.
    const result = mountAtRay(
      FLOOR,
      rectSolids(),
      rayTo(CAMERA, { x: 2, y: 0.5, z: 0 }),
      CAMERA,
      FOOTPRINT,
      1.5,
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mount.edgeId).toBe("ab");
    expect(result.mount.side).toBe(1);
    expect(result.mount.offset).toBeCloseTo(1.55);
    // Pushed into the room (+y), flush on the interior face.
    expect(result.position.y).toBeCloseTo(0.08);
  });

  it("passes over the stubbed near wall even where a full wall would block", () => {
    // The same ray crosses the near wall "cd" at ~2.3m up — inside a full
    // wall's body, above its 0.3m cutaway stub — so it must reach "ab".
    const result = mountAtRay(
      FLOOR,
      rectSolids(),
      rayTo(CAMERA, { x: 2, y: 0.5, z: 0 }),
      CAMERA,
      FOOTPRINT,
      1.5,
    );
    expect(result?.mount.edgeId).toBe("ab");
  });

  it("mounts on a stub's own face when aimed below the stub height", () => {
    const result = mountAtRay(
      FLOOR,
      rectSolids(),
      rayTo(CAMERA, { x: 2, y: 0.2, z: 5.2 }),
      CAMERA,
      FOOTPRINT,
      1.5,
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mount.edgeId).toBe("cd");
    // The face the ray came from: the camera's (exterior) side.
    expect(result.mount.side).toBe(-1);
    expect(result.position.y).toBeCloseTo(5.28);
  });

  it("returns null for straight-down rays (the 2D lens falls back to mountAt)", () => {
    const result = mountAtRay(
      FLOOR,
      rectSolids(),
      { origin: { x: 2, y: 5, z: 1 }, dir: { x: 0, y: -1, z: 0 } },
      { x: 2, y: 5, z: 1 },
      FOOTPRINT,
      1.5,
    );
    expect(result).toBeNull();
  });

  it("lets the ray pass through holes instead of mounting over a doorway", () => {
    const door: WallHole = {
      id: "door",
      kind: "door",
      start: 1.5,
      width: 1,
      bottom: 0,
      top: 2,
      side: 1,
    };
    const result = mountAtRay(
      FLOOR,
      rectSolids([door]),
      rayTo(CAMERA, { x: 2, y: 0.5, z: 0 }),
      CAMERA,
      FOOTPRINT,
      1.5,
    );
    expect(result).toBeNull();
  });
});
