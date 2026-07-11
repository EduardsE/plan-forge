import { describe, expect, it } from "vitest";
import {
  canHostStack,
  clampStackOffset,
  deriveStackPosition,
  isStackHost,
  isStackRider,
  riderFitsHost,
  stackFreedom,
  stackOffsetOf,
  stackSurfaceHeight,
  syncStackedRiders,
} from "./stack";
import type { FurnitureItem, Room } from "./types";

const host = (over: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: "desk-1",
  catalogId: "dining-table",
  position: { x: 3, y: 2 },
  rotation: 0,
  footprint: { width: 1.6, depth: 0.9, height: 0.75 },
  ...over,
});

const rider = (over: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: "lamp-1",
  catalogId: "table-lamp",
  position: { x: 3.2, y: 2.1 },
  rotation: 0,
  footprint: { width: 0.22, depth: 0.22, height: 0.48 },
  stack: { hostId: "desk-1", dx: 0.2, dy: 0.1 },
  ...over,
});

const roomWith = (furniture: FurnitureItem[]): Room => ({
  id: "room-1",
  outline: [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 6 },
    { x: 0, y: 6 },
  ],
  openings: [],
  furniture,
});

describe("host/rider predicates", () => {
  it("hosts are tables and storage", () => {
    expect(isStackHost("desk")).toBe(true);
    expect(isStackHost("credenza")).toBe(true);
    expect(isStackHost("sofa-2")).toBe(false);
    expect(isStackHost("unknown")).toBe(false);
  });

  it("riders are lighting, decor and plants", () => {
    expect(isStackRider("table-lamp")).toBe(true);
    expect(isStackRider("plant")).toBe(true);
    expect(isStackRider("rug")).toBe(true);
    expect(isStackRider("desk")).toBe(false);
    expect(isStackRider("picture-frame")).toBe(false);
  });

  it("a placed host must stand free on the floor", () => {
    expect(canHostStack(host())).toBe(true);
    expect(
      canHostStack(host({ mount: { wallIndex: 0, offset: 1, elevation: 1 } })),
    ).toBe(false);
    expect(
      canHostStack(host({ stack: { hostId: "other", dx: 0, dy: 0 } })),
    ).toBe(false);
    expect(canHostStack(host({ catalogId: "sofa-2" }))).toBe(false);
  });
});

describe("stackSurfaceHeight", () => {
  it("defaults to the footprint height", () => {
    expect(stackSurfaceHeight(host())).toBe(0.75);
  });

  it("uses the desk's worktop ratio (the monitor sits above it)", () => {
    const desk = host({
      catalogId: "desk",
      footprint: { width: 2.2, depth: 0.85, height: 1.12 },
    });
    expect(stackSurfaceHeight(desk)).toBeCloseTo(1.12 * 0.66);
  });
});

describe("deriveStackPosition / stackOffsetOf", () => {
  it("adds the raw offset on an unrotated host", () => {
    expect(
      deriveStackPosition(host(), { hostId: "h", dx: 0.4, dy: -0.2 }),
    ).toEqual({ x: 3.4, y: 1.8 });
  });

  it("spins the offset with the host (plan y points down)", () => {
    const spun = host({ rotation: 90 });
    const p = deriveStackPosition(spun, { hostId: "h", dx: 0.4, dy: 0 });
    // +x local turns toward -y in plan coords at +90°.
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(1.6);
  });

  it("round-trips through stackOffsetOf at any rotation", () => {
    const spun = host({ rotation: 137 });
    const stack = { hostId: "h", dx: 0.31, dy: -0.12 };
    const local = stackOffsetOf(spun, deriveStackPosition(spun, stack));
    expect(local.x).toBeCloseTo(stack.dx);
    expect(local.y).toBeCloseTo(stack.dy);
  });
});

describe("stackFreedom / riderFitsHost / clampStackOffset", () => {
  it("freedom is host half-size minus the rider's relative hull", () => {
    const freedom = stackFreedom(host(), { width: 0.2, depth: 0.4 }, 0);
    expect(freedom.x).toBeCloseTo(0.7);
    expect(freedom.y).toBeCloseTo(0.25);
  });

  it("a quarter-turned rider swaps its hull axes", () => {
    const freedom = stackFreedom(host(), { width: 0.2, depth: 0.4 }, 90);
    expect(freedom.x).toBeCloseTo(0.6);
    expect(freedom.y).toBeCloseTo(0.35);
  });

  it("relative rotation is what counts, not world rotation", () => {
    const spun = host({ rotation: 90 });
    const freedom = stackFreedom(spun, { width: 0.2, depth: 0.4 }, 90);
    expect(freedom.x).toBeCloseTo(0.7);
    expect(freedom.y).toBeCloseTo(0.25);
  });

  it("an oversized rider does not fit", () => {
    expect(riderFitsHost(host(), { width: 2.8, depth: 2 }, 0)).toBe(false);
    expect(riderFitsHost(host(), { width: 0.45, depth: 0.45 }, 0)).toBe(true);
  });

  it("clamps into the freedom and centers an oversized axis", () => {
    const offset = clampStackOffset(
      host(),
      { x: 5, y: -5 },
      { width: 0.2, depth: 0.4 },
      0,
    );
    expect(offset.x).toBeCloseTo(0.7);
    expect(offset.y).toBeCloseTo(-0.25);
    const oversized = clampStackOffset(
      host(),
      { x: 5, y: 5 },
      { width: 2, depth: 2 },
      0,
    );
    expect(oversized).toEqual({ x: 0, y: 0 });
  });
});

describe("syncStackedRiders", () => {
  it("re-derives rider positions from the (moved) host", () => {
    const moved = host({ position: { x: 5, y: 4 } });
    const room = roomWith([moved, rider()]);
    const next = syncStackedRiders(room, "desk-1");
    expect(next.furniture[1].position).toEqual({ x: 5.2, y: 4.1 });
  });

  it("spins rider facing by the host's rotation delta", () => {
    const spun = host({ rotation: 90 });
    const room = roomWith([spun, rider({ rotation: 350 })]);
    const next = syncStackedRiders(room, "desk-1", 90);
    const lamp = next.furniture[1];
    expect(lamp.rotation).toBe(80);
    expect(lamp.position.x).toBeCloseTo(3.1);
    expect(lamp.position.y).toBeCloseTo(1.8);
  });

  it("returns the same room when nothing rides the host", () => {
    const room = roomWith([host()]);
    expect(syncStackedRiders(room, "desk-1")).toBe(room);
    expect(syncStackedRiders(room, "missing")).toBe(room);
  });
});
