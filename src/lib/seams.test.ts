import { describe, expect, it } from "vitest";
import type { Room, RoomOpening } from "#/lib/model";
import { floorPortals, floorSeamData, floorSeams, portalLabel } from "./seams";

/** Two rooms flush on x = 6.4: the kitchen's west wall abuts the middle
 * stretch of the living room's east wall (living wall 1 runs y 0 → 5.2,
 * kitchen wall 3 runs y 4 → 1, so the walls are antiparallel). */
function livingRoom(openings: RoomOpening[] = []): Room {
  return {
    id: "living",
    name: "Living room",
    outline: [
      { x: 0, y: 0 },
      { x: 6.4, y: 0 },
      { x: 6.4, y: 5.2 },
      { x: 0, y: 5.2 },
    ],
    openings,
    furniture: [],
  };
}

function kitchen(openings: RoomOpening[] = []): Room {
  return {
    id: "kitchen",
    name: "Kitchen",
    outline: [
      { x: 6.4, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 4 },
      { x: 6.4, y: 4 },
    ],
    openings,
    furniture: [],
  };
}

describe("floorSeams", () => {
  it("finds the shared stretch of two flush rooms, from both sides", () => {
    const seams = floorSeams([livingRoom(), kitchen()]);
    expect(seams).toHaveLength(2);

    const living = seams.find((seam) => seam.roomId === "living");
    expect(living).toMatchObject({
      wallIndex: 1,
      otherRoomId: "kitchen",
      otherWallIndex: 3,
    });
    expect(living?.span.start).toBeCloseTo(1);
    expect(living?.span.end).toBeCloseTo(4);
    // Antiparallel walls: the mapping runs backwards.
    expect(living?.otherStart).toBeCloseTo(3);
    expect(living?.otherEnd).toBeCloseTo(0);

    const other = seams.find((seam) => seam.roomId === "kitchen");
    expect(other).toMatchObject({
      wallIndex: 3,
      otherRoomId: "living",
      otherWallIndex: 1,
    });
    expect(other?.span.start).toBeCloseTo(0);
    expect(other?.span.end).toBeCloseTo(3);
    expect(other?.otherStart).toBeCloseTo(4);
    expect(other?.otherEnd).toBeCloseTo(1);
  });

  it("pairs back-to-back walls (lines one thickness apart) as a seam", () => {
    // Shift the kitchen one wall thickness east: the two wall lines no
    // longer coincide, but the outward-extruded solids occupy the same
    // slab — the user-visible "one wall" the doors were cut into.
    const shifted = kitchen();
    shifted.outline = shifted.outline.map((p) => ({ x: p.x + 0.1, y: p.y }));
    const seams = floorSeams([livingRoom(), shifted]);
    expect(seams).toHaveLength(2);

    const living = seams.find((seam) => seam.roomId === "living");
    expect(living).toMatchObject({
      wallIndex: 1,
      otherRoomId: "kitchen",
      otherWallIndex: 3,
      gap: 0.1,
    });
    expect(living?.span.start).toBeCloseTo(1);
    expect(living?.span.end).toBeCloseTo(4);
    // The offset is perpendicular, so the along-wall mapping is unchanged.
    expect(living?.otherStart).toBeCloseTo(3);
    expect(living?.otherEnd).toBeCloseTo(0);
    expect(seams.find((seam) => seam.roomId === "kitchen")?.gap).toBe(0.1);
  });

  it("flags flush seams with gap 0", () => {
    for (const seam of floorSeams([livingRoom(), kitchen()])) {
      expect(seam.gap).toBe(0);
    }
  });

  it("ignores rooms with a real gap or overlap between them", () => {
    // Half a thickness (solids overlap but lines differ), a thickness plus
    // a grid step (real air gap), and minus a thickness (rooms overlap).
    for (const dx of [0.05, 0.15, -0.1]) {
      const shifted = kitchen();
      shifted.outline = shifted.outline.map((p) => ({ x: p.x + dx, y: p.y }));
      expect(floorSeams([livingRoom(), shifted])).toEqual([]);
    }
  });

  it("ignores parallel walls one thickness apart that face the same way", () => {
    // A room overlapping the living room's east edge: its east wall runs
    // 0.1 beyond the living room's east wall — parallel, one thickness
    // apart, but both face east, so their solids don't share a slab.
    const overlapping: Room = {
      id: "overlap",
      name: "Overlap",
      outline: [
        { x: 6.2, y: 1 },
        { x: 6.5, y: 1 },
        { x: 6.5, y: 4 },
        { x: 6.2, y: 4 },
      ],
      openings: [],
      furniture: [],
    };
    expect(floorSeams([livingRoom(), overlapping])).toEqual([]);
  });

  it("ignores corner touches (zero-length overlaps)", () => {
    const below = kitchen();
    // Slide the kitchen fully below the living room: its west wall still
    // lies on x = 6.4 but shares only the corner point y = 5.2.
    below.outline = below.outline.map((p) => ({ x: p.x, y: p.y + 4.2 }));
    expect(floorSeams([livingRoom(), below])).toEqual([]);
  });

  it("finds nothing on a single-room floor", () => {
    expect(floorSeams([livingRoom()])).toEqual([]);
  });
});

describe("floorPortals", () => {
  const door: RoomOpening = {
    id: "door-1",
    kind: "door",
    wallIndex: 1,
    offset: 2,
    width: 0.9,
    hinge: "start",
  };

  it("classifies an opening on the shared stretch as a portal", () => {
    const portals = floorPortals([livingRoom([door]), kitchen()]);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({
      openingId: "door-1",
      kind: "door",
      roomId: "living",
      wallIndex: 1,
      otherRoomId: "kitchen",
      otherWallIndex: 3,
    });
    // Living offsets [2, 2.9] map to kitchen-wall offsets [1.1, 2].
    expect(portals[0].otherOffset).toBeCloseTo(1.1);
    expect(portals[0].otherWidth).toBeCloseTo(0.9);
  });

  it("clips a partially shared opening to the seam", () => {
    const straddling: RoomOpening = { ...door, offset: 3.7 };
    const portals = floorPortals([livingRoom([straddling]), kitchen()]);
    expect(portals).toHaveLength(1);
    expect(portals[0].otherOffset).toBeCloseTo(0);
    expect(portals[0].otherWidth).toBeCloseTo(0.3);
  });

  it("derives portals across a back-to-back seam", () => {
    const shifted = kitchen();
    shifted.outline = shifted.outline.map((p) => ({ x: p.x + 0.1, y: p.y }));
    const portals = floorPortals([livingRoom([door]), shifted]);
    expect(portals).toHaveLength(1);
    // Same along-wall mapping as the flush case — the offset is
    // perpendicular to the wall, so it doesn't shift the hole.
    expect(portals[0].otherOffset).toBeCloseTo(1.1);
    expect(portals[0].otherWidth).toBeCloseTo(0.9);
  });

  it("leaves openings off the seam unclassified", () => {
    const exterior: RoomOpening = { ...door, wallIndex: 0 };
    const pastSeam: RoomOpening = { ...door, offset: 4.2 };
    expect(floorPortals([livingRoom([exterior, pastSeam]), kitchen()])).toEqual(
      [],
    );
  });
});

describe("floorSeamData", () => {
  const door: RoomOpening = {
    id: "door-1",
    kind: "door",
    wallIndex: 1,
    offset: 2,
    width: 0.9,
  };

  it("collects seam spans and the neighbor's portal holes per room", () => {
    const data = floorSeamData([livingRoom([door]), kitchen()]);

    const living = data.get("living");
    expect(living?.portalHoles).toEqual([]);
    expect(living?.seamSpans.get(1)).toHaveLength(1);
    expect(living?.seamSpans.get(1)?.[0].start).toBeCloseTo(1);
    expect(living?.seamSpans.get(1)?.[0].end).toBeCloseTo(4);

    const other = data.get("kitchen");
    expect(other?.seamSpans.get(3)).toHaveLength(1);
    expect(other?.portalHoles).toHaveLength(1);
    expect(other?.portalHoles[0]).toMatchObject({
      id: "door-1",
      kind: "door",
      wallIndex: 3,
    });
    expect(other?.portalHoles[0].offset).toBeCloseTo(1.1);
    expect(other?.portalHoles[0].width).toBeCloseTo(0.9);
  });

  it("has no entry for rooms without shared walls", () => {
    expect(floorSeamData([livingRoom()]).get("living")).toBeUndefined();
  });
});

describe("portalLabel", () => {
  const door: RoomOpening = {
    id: "door-1",
    kind: "door",
    wallIndex: 1,
    offset: 2,
    width: 0.9,
  };

  it("names both rooms, the owner first", () => {
    const rooms = [livingRoom([door]), kitchen()];
    const portals = floorPortals(rooms);
    expect(portalLabel(rooms, portals, "door-1")).toBe("Living room ↔ Kitchen");
  });

  it("returns null for a non-portal opening", () => {
    const exterior: RoomOpening = { ...door, wallIndex: 0 };
    const rooms = [livingRoom([exterior]), kitchen()];
    expect(portalLabel(rooms, floorPortals(rooms), "door-1")).toBeNull();
  });
});
