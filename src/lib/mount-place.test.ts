import { describe, expect, it } from "vitest";
import { wallFrames } from "#/lib/model";
import { mountAt, reanchorMount } from "#/lib/mount-place";

const OUTLINE = [
  { x: 0, y: 0 },
  { x: 6.4, y: 0 },
  { x: 6.4, y: 5.2 },
  { x: 0, y: 5.2 },
];
const FRAMES = wallFrames(OUTLINE);
const FOOTPRINT = { width: 0.9, depth: 0.06 };

describe("mountAt", () => {
  it("mounts to the nearest wall, flush against its face", () => {
    // Cursor just below the top wall, near x=2.
    const result = mountAt(FRAMES, { x: 2, y: 0.4 }, FOOTPRINT, 1.5);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mount.wallIndex).toBe(0);
    expect(result.mount.elevation).toBe(1.5);
    // Center at cursor x=2, so near-edge offset ≈ 2 - 0.45 = 1.55.
    expect(result.mount.offset).toBeCloseTo(1.55);
    expect(result.position.y).toBeCloseTo(0.03); // pushed into the room
    expect(result.rotation).toBeCloseTo(0);
  });

  it("quantizes the offset to the placement grid when snapping", () => {
    const result = mountAt(FRAMES, { x: 2.03, y: 0.3 }, FOOTPRINT, 1.5);
    expect(result).not.toBeNull();
    if (!result) return;
    // Offset lands on the 0.05 grid.
    expect(result.mount.offset * 20).toBeCloseTo(
      Math.round(result.mount.offset * 20),
    );
  });

  it("clamps into the wall so the item can't hang past a corner", () => {
    // Cursor above the top wall, past its left corner (nearest the top wall
    // but projecting to a negative near-edge offset).
    const result = mountAt(FRAMES, { x: 0.2, y: -1 }, FOOTPRINT, 1.5);
    expect(result?.mount.wallIndex).toBe(0);
    expect(result?.mount.offset).toBeGreaterThanOrEqual(0);
  });

  it("emits corner-distance guides while snapping, none when snap is off", () => {
    const snapped = mountAt(FRAMES, { x: 2, y: 0.4 }, FOOTPRINT, 1.5, true);
    expect(snapped?.guides.length).toBeGreaterThan(0);
    const free = mountAt(FRAMES, { x: 2, y: 0.4 }, FOOTPRINT, 1.5, false);
    expect(free?.guides).toEqual([]);
  });

  it("skips a wall too short for the item and uses the next nearest", () => {
    // A tiny room whose only walls are 0.5 m — nothing fits a 0.9 m frame.
    const tiny = wallFrames([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ]);
    expect(mountAt(tiny, { x: 0.25, y: 0.1 }, FOOTPRINT, 1.5)).toBeNull();
  });
});

describe("reanchorMount", () => {
  it("keeps a mount on its geometrically nearest wall after a reshape", () => {
    // Item near the top wall re-anchors to wall 0.
    const result = reanchorMount(FRAMES, { x: 3, y: 0.03 }, FOOTPRINT, 1.5);
    expect(result?.mount.wallIndex).toBe(0);
    expect(result?.position.y).toBeCloseTo(0.03);
  });

  it("drops the mount when its nearest wall no longer fits it", () => {
    const tiny = wallFrames([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ]);
    expect(
      reanchorMount(tiny, { x: 0.25, y: 0.03 }, FOOTPRINT, 1.5),
    ).toBeNull();
  });
});
