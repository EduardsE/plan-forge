import { describe, expect, it } from "vitest";
import type { FurnitureItem } from "#/lib/model";
import { stackAt } from "./stack-place";

const desk: FurnitureItem = {
  id: "desk-1",
  catalogId: "desk",
  position: { x: 3, y: 2 },
  rotation: 0,
  footprint: { width: 2.2, depth: 0.85, height: 1.12 },
};

const sideTable: FurnitureItem = {
  id: "side-1",
  catalogId: "side-table",
  position: { x: 3, y: 2 },
  rotation: 0,
  footprint: { width: 0.45, depth: 0.45, height: 0.52 },
};

const lamp = { width: 0.22, depth: 0.22 };

describe("stackAt", () => {
  it("returns null when the cursor is over no host", () => {
    expect(stackAt([desk], { x: 6, y: 5 }, lamp)).toBeNull();
  });

  it("snaps the rider onto the hovered host, quantized to the grid", () => {
    const result = stackAt([desk], { x: 3.52, y: 2.11 }, lamp);
    expect(result?.host.id).toBe("desk-1");
    expect(result?.stack).toEqual({ hostId: "desk-1", dx: 0.5, dy: 0.1 });
    expect(result?.position).toEqual({ x: 3.5, y: 2.1 });
  });

  it("clamps the anchor inside the host top", () => {
    const result = stackAt([desk], { x: 4.05, y: 2.4 }, lamp);
    // Freedom: (2.2 - 0.22)/2 = 0.99 along x, (0.85 - 0.22)/2 = 0.315 along y.
    expect(result?.stack.dx).toBeCloseTo(0.99);
    expect(result?.stack.dy).toBeCloseTo(0.315);
  });

  it("passes the raw offset through with snap off", () => {
    const result = stackAt([desk], { x: 3.52, y: 2.11 }, lamp, 0, false);
    expect(result?.stack.dx).toBeCloseTo(0.52);
    expect(result?.stack.dy).toBeCloseTo(0.11);
  });

  it("hit-tests against the rotated host footprint", () => {
    const spun = { ...desk, rotation: 90 };
    // The desk's long axis now runs along plan y; a point 1 m above the
    // center is inside the turned footprint, but 1 m beside it is not.
    expect(stackAt([spun], { x: 3, y: 1 }, lamp)).not.toBeNull();
    expect(stackAt([spun], { x: 4, y: 2 }, lamp)).toBeNull();
  });

  it("prefers the smallest containing host and skips ones the rider outgrows", () => {
    const cursor = { x: 3.1, y: 2.1 };
    const both = stackAt([desk, sideTable], cursor, lamp);
    expect(both?.host.id).toBe("side-1");
    // A rider too big for the side table falls through to the desk.
    const tray = { width: 0.6, depth: 0.5 };
    const fallthrough = stackAt([sideTable, desk], cursor, tray);
    expect(fallthrough?.host.id).toBe("desk-1");
  });

  it("offsets from the drag center while hit-testing the cursor", () => {
    const result = stackAt([desk], { x: 3, y: 2 }, lamp, 0, true, {
      x: 3.2,
      y: 2.2,
    });
    expect(result?.stack.dx).toBeCloseTo(0.2);
    expect(result?.stack.dy).toBeCloseTo(0.2);
  });
});
