import { describe, expect, it } from "vitest";
import {
  addFurniture,
  DUPLICATE_OFFSET,
  duplicateFurniture,
  footprintCorners,
  formatFootprintCm,
  furnitureDisplayName,
  MIN_FOOTPRINT_SIZE,
  removeFurniture,
  rotateFurniture,
  setFurnitureColorway,
  setFurnitureFootprint,
  setFurnitureRotation,
  setMountElevation,
  updateFurniture,
} from "./furniture";
import { createSampleRoom } from "./sample-room";
import type { FurnitureItem, Room } from "./types";

/**
 * A derived-shape room with one wall-mounted item, for the mount branches.
 * Mounts are edge-based now (`{ edgeId, offset, side, elevation }`); their
 * plan transform is re-derived from the graph by `deriveFloor`, so these
 * pure setters only adjust the mount's own fields.
 */
function mountedRoom(): Room {
  return {
    id: "living-room",
    outline: [
      { x: 0, y: 0 },
      { x: 6.4, y: 0 },
      { x: 6.4, y: 5.2 },
      { x: 0, y: 5.2 },
    ],
    openings: [],
    furniture: [
      {
        id: "frame-1",
        catalogId: "picture-frame",
        position: { x: 0.03, y: 1.6 },
        rotation: 90,
        footprint: { width: 0.9, depth: 0.06, height: 0.7 },
        mount: { edgeId: "e-FA", offset: 3.15, side: 1, elevation: 1.5 },
      },
    ],
  };
}

describe("rotateFurniture", () => {
  it("adds the delta to the target item only", () => {
    const room = createSampleRoom();
    const next = rotateFurniture(room, "desk-1", -90);
    expect(next.furniture.find((item) => item.id === "desk-1")?.rotation).toBe(
      270,
    );
    expect(
      next.furniture.find((item) => item.id === "credenza-1")?.rotation,
    ).toBe(90);
  });

  it("normalizes past a full turn", () => {
    const room = rotateFurniture(createSampleRoom(), "credenza-1", 360 + 45);
    expect(
      room.furniture.find((item) => item.id === "credenza-1")?.rotation,
    ).toBe(135);
  });

  it("does not mutate the input room", () => {
    const room = createSampleRoom();
    rotateFurniture(room, "desk-1", 90);
    expect(room.furniture.find((item) => item.id === "desk-1")?.rotation).toBe(
      0,
    );
  });
});

describe("setFurnitureColorway", () => {
  const of = (room: Room, id: string) =>
    room.furniture.find((item) => item.id === id);

  it("sets an explicit colorway on the target item only", () => {
    const room = createSampleRoom();
    const next = setFurnitureColorway(room, "desk-1", "#123456");
    expect(of(next, "desk-1")?.colorway).toBe("#123456");
    expect(of(next, "credenza-1")?.colorway).toBeUndefined();
  });

  it("clears the override back to the catalog default with null", () => {
    const painted = setFurnitureColorway(
      createSampleRoom(),
      "desk-1",
      "#123456",
    );
    const cleared = setFurnitureColorway(painted, "desk-1", null);
    expect(of(cleared, "desk-1")?.colorway).toBeUndefined();
    expect("colorway" in (of(cleared, "desk-1") as object)).toBe(false);
  });

  it("returns the same room for no-ops (unknown id, unchanged, clear-when-plain)", () => {
    const room = createSampleRoom();
    expect(setFurnitureColorway(room, "nope", "#123456")).toBe(room);
    expect(setFurnitureColorway(room, "desk-1", null)).toBe(room);
    const painted = setFurnitureColorway(room, "desk-1", "#123456");
    expect(setFurnitureColorway(painted, "desk-1", "#123456")).toBe(painted);
  });

  it("does not mutate the input room", () => {
    const room = createSampleRoom();
    setFurnitureColorway(room, "desk-1", "#123456");
    expect(of(room, "desk-1")?.colorway).toBeUndefined();
  });
});

describe("duplicateFurniture", () => {
  it("appends an offset copy under the new id", () => {
    const room = createSampleRoom();
    const next = duplicateFurniture(room, "desk-chair-1", "desk-chair-2");
    expect(next.furniture).toHaveLength(room.furniture.length + 1);
    const copy = next.furniture.at(-1);
    expect(copy).toMatchObject({
      id: "desk-chair-2",
      catalogId: "desk-chair",
      rotation: 180,
      footprint: { width: 0.64, depth: 0.64, height: 1.04 },
    });
    expect(copy?.position).toEqual({
      x: 4.52 + DUPLICATE_OFFSET,
      y: 2.22 + DUPLICATE_OFFSET,
    });
  });

  it("returns the room unchanged for an unknown id", () => {
    const room = createSampleRoom();
    expect(duplicateFurniture(room, "nope", "nope-2")).toBe(room);
  });

  it("shifts a wall-mounted copy along its edge, keeping edge/side/elevation", () => {
    const room = mountedRoom();
    const source = room.furniture.find((item) => item.mount);
    if (!source?.mount) throw new Error("no mounted fixture");
    const next = duplicateFurniture(room, source.id, "frame-copy");
    const copy = next.furniture.find((item) => item.id === "frame-copy");
    // The mount's edge offset shifts; edgeId/side/elevation ride along.
    // (`deriveFloor` re-derives position/rotation from the shifted mount.)
    expect(copy?.mount).toEqual({
      edgeId: source.mount.edgeId,
      offset: source.mount.offset + DUPLICATE_OFFSET,
      side: source.mount.side,
      elevation: source.mount.elevation,
    });
  });
});

describe("updateFurniture", () => {
  it("repositions the target item only, without mutating the input", () => {
    const room = createSampleRoom();
    const next = updateFurniture(room, "desk-chair-1", {
      position: { x: 2.5, y: 3.15 },
    });
    expect(
      next.furniture.find((item) => item.id === "desk-chair-1")?.position,
    ).toEqual({ x: 2.5, y: 3.15 });
    expect(
      next.furniture.find((item) => item.id === "desk-1")?.position,
    ).toEqual({ x: 4.7, y: 0.73 });
    expect(
      room.furniture.find((item) => item.id === "desk-chair-1")?.position,
    ).toEqual({ x: 4.52, y: 2.22 });
  });

  it("applies rotation and mount when the update carries them", () => {
    const room = createSampleRoom();
    const mount = {
      edgeId: "e-EF",
      offset: 1.1,
      side: 1 as const,
      elevation: 1.4,
    };
    const next = updateFurniture(room, "desk-chair-1", {
      position: { x: 3, y: 5 },
      rotation: 180,
      mount,
    });
    const item = next.furniture.find((entry) => entry.id === "desk-chair-1");
    expect(item?.rotation).toBe(180);
    expect(item?.mount).toEqual(mount);
  });

  it("leaves an item's rotation and mount untouched when the update omits them", () => {
    const room = mountedRoom();
    const source = room.furniture.find((item) => item.mount);
    if (!source) throw new Error("no mounted fixture");
    const next = updateFurniture(room, source.id, {
      position: { x: 1, y: 1 },
    });
    const item = next.furniture.find((entry) => entry.id === source.id);
    expect(item?.rotation).toBe(source.rotation);
    expect(item?.mount).toEqual(source.mount);
  });

  it("leaves the room unchanged for an unknown id", () => {
    const room = createSampleRoom();
    expect(
      updateFurniture(room, "nope", { position: { x: 1, y: 1 } }).furniture,
    ).toEqual(room.furniture);
  });
});

describe("setFurnitureFootprint", () => {
  it("patches the footprint about the center (position untouched)", () => {
    const room = createSampleRoom();
    const next = setFurnitureFootprint(room, "desk-1", {
      width: 1.8,
      depth: 0.85,
      height: 1.12,
    });
    const desk = next.furniture.find((item) => item.id === "desk-1");
    expect(desk?.footprint).toEqual({ width: 1.8, depth: 0.85, height: 1.12 });
    expect(desk?.position).toEqual({ x: 4.7, y: 0.73 });
    expect(
      room.furniture.find((item) => item.id === "desk-1")?.footprint.width,
    ).toBe(2.2);
  });

  it("clamps an edited dimension to the minimum size", () => {
    const room = createSampleRoom();
    const next = setFurnitureFootprint(room, "plant-1", {
      width: 0.02,
      depth: 0.45,
      height: 1.2,
    });
    expect(
      next.furniture.find((item) => item.id === "plant-1")?.footprint.width,
    ).toBe(MIN_FOOTPRINT_SIZE);
  });

  it("leaves an untouched sub-minimum dimension alone (a rug's height)", () => {
    const room = createSampleRoom();
    const next = setFurnitureFootprint(room, "rug-1", {
      width: 3.2,
      depth: 2,
      height: 0.01,
    });
    const rug = next.furniture.find((item) => item.id === "rug-1");
    expect(rug?.footprint).toEqual({ width: 3.2, depth: 2, height: 0.01 });
  });

  it("updates a mounted item's footprint, leaving its edge/offset alone", () => {
    const room = mountedRoom();
    const source = room.furniture.find((item) => item.mount);
    if (!source?.mount) throw new Error("no mounted fixture");
    const footprint = { width: 1.4, depth: 0.06, height: 0.7 };
    const next = setFurnitureFootprint(room, source.id, footprint);
    const item = next.furniture.find((entry) => entry.id === source.id);
    // The footprint changes; the mount's edge/offset/side stay put —
    // `deriveFloor` re-derives the flush position/rotation from the edge.
    expect(item?.footprint).toEqual(footprint);
    expect(item?.mount?.edgeId).toBe(source.mount.edgeId);
    expect(item?.mount?.offset).toBe(source.mount.offset);
    expect(item?.mount?.side).toBe(source.mount.side);
  });

  it("lifts a mounted item's elevation clear of the floor on a tall resize", () => {
    const room = mountedRoom();
    const source = room.furniture.find((item) => item.mount);
    if (!source?.mount) throw new Error("no mounted fixture");
    const next = setFurnitureFootprint(room, source.id, {
      ...source.footprint,
      height: 3.4,
    });
    expect(
      next.furniture.find((entry) => entry.id === source.id)?.mount?.elevation,
    ).toBe(1.7);
  });

  it("returns the room unchanged for an unknown id", () => {
    const room = createSampleRoom();
    expect(
      setFurnitureFootprint(room, "nope", { width: 1, depth: 1, height: 1 }),
    ).toBe(room);
  });
});

describe("setFurnitureRotation", () => {
  it("sets an absolute normalized angle on the target item only", () => {
    const room = createSampleRoom();
    const next = setFurnitureRotation(room, "desk-1", -90);
    expect(next.furniture.find((item) => item.id === "desk-1")?.rotation).toBe(
      270,
    );
    expect(
      next.furniture.find((item) => item.id === "credenza-1")?.rotation,
    ).toBe(90);
  });

  it("returns the room unchanged for a no-op angle", () => {
    const room = createSampleRoom();
    expect(setFurnitureRotation(room, "desk-1", 360)).toBe(room);
  });

  it("refuses mounted items (rotation is derived from the wall)", () => {
    const room = createSampleRoom();
    expect(setFurnitureRotation(room, "picture-frame-1", 45)).toBe(room);
  });

  it("returns the room unchanged for an unknown id or non-finite angle", () => {
    const room = createSampleRoom();
    expect(setFurnitureRotation(room, "nope", 45)).toBe(room);
    expect(setFurnitureRotation(room, "desk-1", Number.NaN)).toBe(room);
  });
});

describe("setMountElevation", () => {
  it("sets the mount's center elevation", () => {
    const room = mountedRoom();
    const next = setMountElevation(room, "frame-1", 1.8);
    expect(
      next.furniture.find((item) => item.id === "frame-1")?.mount?.elevation,
    ).toBe(1.8);
  });

  it("clamps so the body stays above the floor", () => {
    const room = mountedRoom();
    // The frame is 0.7 m tall, so its center can't go below 0.35.
    const next = setMountElevation(room, "frame-1", 0.1);
    expect(
      next.furniture.find((item) => item.id === "frame-1")?.mount?.elevation,
    ).toBe(0.35);
  });

  it("returns the room unchanged for floor items and no-op values", () => {
    const room = createSampleRoom();
    expect(setMountElevation(room, "desk-1", 1.2)).toBe(room);
    expect(setMountElevation(room, "picture-frame-1", 1.5)).toBe(room);
  });
});

describe("removeFurniture", () => {
  it("removes the item without mutating the input", () => {
    const room = createSampleRoom();
    const next = removeFurniture(room, "rug-1");
    expect(next.furniture.some((item) => item.id === "rug-1")).toBe(false);
    expect(next.furniture).toHaveLength(room.furniture.length - 1);
    expect(room.furniture.some((item) => item.id === "rug-1")).toBe(true);
  });
});

describe("addFurniture", () => {
  it("appends the item without mutating the input", () => {
    const room = createSampleRoom();
    const item = {
      id: "sofa-2-1",
      catalogId: "sofa-2",
      position: { x: 3, y: 3.8 },
      rotation: 0,
      footprint: { width: 1.68, depth: 0.88, height: 0.82 },
    };
    const next = addFurniture(room, item);
    expect(next.furniture.at(-1)).toBe(item);
    expect(next.furniture).toHaveLength(room.furniture.length + 1);
    expect(room.furniture.some((entry) => entry.id === "sofa-2-1")).toBe(false);
  });
});

describe("furnitureDisplayName", () => {
  it("uses the catalog name when the id is known", () => {
    expect(furnitureDisplayName("sofa-2")).toBe("Sofa · 2-seat");
    expect(furnitureDisplayName("plant")).toBe("Potted Plant");
  });

  it("falls back to a title-cased slug for unknown ids", () => {
    expect(furnitureDisplayName("bean-bag")).toBe("Bean Bag");
  });
});

describe("formatFootprintCm", () => {
  it("renders whole centimeters in the mockup format", () => {
    expect(formatFootprintCm({ width: 0.64, depth: 0.64, height: 1.04 })).toBe(
      "64 × 64 · H 104 cm",
    );
  });

  it("rounds sub-centimeter values", () => {
    expect(formatFootprintCm({ width: 0.945, depth: 0.4, height: 2.052 })).toBe(
      "95 × 40 · H 205 cm",
    );
  });
});

describe("footprintCorners", () => {
  it("returns the axis-aligned corners of an unrotated item", () => {
    const corners = footprintCorners({
      id: "f1",
      catalogId: "sofa-2",
      position: { x: 2, y: 3 },
      rotation: 0,
      footprint: { width: 2, depth: 1, height: 0.8 },
    });
    expect(corners).toEqual([
      { x: 1, y: 2.5 },
      { x: 3, y: 2.5 },
      { x: 3, y: 3.5 },
      { x: 1, y: 3.5 },
    ]);
  });

  it("swaps the extents at 90°", () => {
    const corners = footprintCorners({
      id: "f1",
      catalogId: "sofa-2",
      position: { x: 0, y: 0 },
      rotation: 90,
      footprint: { width: 2, depth: 1, height: 0.8 },
    });
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2);
  });
});

describe("stacked riders through the mutations", () => {
  const table = (): FurnitureItem => ({
    id: "table-1",
    catalogId: "dining-table",
    position: { x: 3, y: 2 },
    rotation: 0,
    footprint: { width: 1.6, depth: 0.9, height: 0.75 },
  });
  const lamp = (): FurnitureItem => ({
    id: "lamp-1",
    catalogId: "table-lamp",
    position: { x: 3.4, y: 2.1 },
    rotation: 0,
    footprint: { width: 0.22, depth: 0.22, height: 0.48 },
    stack: { hostId: "table-1", dx: 0.4, dy: 0.1 },
  });
  const stackedRoom = (): Room => ({
    id: "room-1",
    outline: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ],
    openings: [],
    furniture: [table(), lamp()],
  });

  it("updateFurniture sets a stack anchor and clears it with null", () => {
    const room = stackedRoom();
    const anchored = updateFurniture(room, "lamp-1", {
      position: { x: 2.8, y: 2 },
      stack: { hostId: "table-1", dx: -0.2, dy: 0 },
    });
    expect(anchored.furniture[1].stack).toEqual({
      hostId: "table-1",
      dx: -0.2,
      dy: 0,
    });
    const floored = updateFurniture(room, "lamp-1", {
      position: { x: 6, y: 5 },
      stack: null,
    });
    expect(floored.furniture[1].stack).toBeUndefined();
    expect(floored.furniture[1].position).toEqual({ x: 6, y: 5 });
  });

  it("updateFurniture re-fits a rider repositioned without an anchor", () => {
    const room = stackedRoom();
    // Asked for a point past the table edge: the anchor clamps back in.
    const next = updateFurniture(room, "lamp-1", {
      position: { x: 4.5, y: 2 },
    });
    const rider = next.furniture[1];
    expect(rider.stack?.dx).toBeCloseTo((1.6 - 0.22) / 2);
    expect(rider.position.x).toBeCloseTo(3 + (1.6 - 0.22) / 2);
  });

  it("updateFurniture carries riders when the host moves", () => {
    const next = updateFurniture(stackedRoom(), "table-1", {
      position: { x: 5, y: 4 },
    });
    expect(next.furniture[1].position).toEqual({ x: 5.4, y: 4.1 });
    expect(next.furniture[1].stack).toEqual({
      hostId: "table-1",
      dx: 0.4,
      dy: 0.1,
    });
  });

  it("rotateFurniture on the host orbits and spins its riders", () => {
    const next = rotateFurniture(stackedRoom(), "table-1", 90);
    const rider = next.furniture[1];
    // Offset (0.4, 0.1) at +90°: +x toward -y, +y toward +x.
    expect(rider.position.x).toBeCloseTo(3.1);
    expect(rider.position.y).toBeCloseTo(1.6);
    expect(rider.rotation).toBe(90);
    expect(rider.stack).toEqual({ hostId: "table-1", dx: 0.4, dy: 0.1 });
  });

  it("duplicateFurniture keeps a rider copy on the host", () => {
    const next = duplicateFurniture(stackedRoom(), "lamp-1", "lamp-2");
    const copy = next.furniture.at(-1);
    expect(copy?.stack?.hostId).toBe("table-1");
    // dx + 0.4 clamps to the table's freedom (1.6 - 0.22)/2 = 0.69.
    expect(copy?.stack?.dx).toBeCloseTo(0.69);
    expect(copy?.stack?.dy).toBeCloseTo(0.34);
    expect(copy?.position.x).toBeCloseTo(3.69);
  });

  it("removeFurniture drops riders to the floor where they stand", () => {
    const next = removeFurniture(stackedRoom(), "table-1");
    expect(next.furniture).toHaveLength(1);
    const rider = next.furniture[0];
    expect(rider.stack).toBeUndefined();
    expect(rider.position).toEqual({ x: 3.4, y: 2.1 });
  });

  it("setFurnitureFootprint on the host re-fits its riders", () => {
    const next = setFurnitureFootprint(stackedRoom(), "table-1", {
      width: 0.9,
      depth: 0.9,
      height: 0.75,
    });
    const rider = next.furniture[1];
    expect(rider.stack?.dx).toBeCloseTo((0.9 - 0.22) / 2);
    expect(rider.position.x).toBeCloseTo(3 + (0.9 - 0.22) / 2);
  });

  it("setFurnitureRotation re-fits the spun rider on its host", () => {
    const room = stackedRoom();
    // Park the lamp against the table's near edge, then stretch it: at 90°
    // the hull swaps axes and the anchor must pull back in.
    const wide = setFurnitureFootprint(room, "lamp-1", {
      width: 0.22,
      depth: 0.8,
      height: 0.48,
    });
    const parked = updateFurniture(wide, "lamp-1", {
      position: { x: 3, y: 2.35 },
    });
    expect(parked.furniture[1].stack?.dy).toBeCloseTo(0.05);
    const spun = setFurnitureRotation(parked, "lamp-1", 90);
    const rider = spun.furniture[1];
    expect(rider.rotation).toBe(90);
    // Rotated hull: 0.8 wide along x → freedom (1.6 - 0.8)/2 = 0.4.
    expect(rider.stack?.dy).toBeCloseTo(0.05);
    expect(Math.abs(rider.stack?.dx ?? 0)).toBeLessThanOrEqual(0.4);
  });
});
