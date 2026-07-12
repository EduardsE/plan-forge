import { describe, expect, it } from "vitest";
import type { Opening, Room } from "#/lib/model";
import { floorPortals, floorSeamData, floorSeams, portalLabel } from "./seams";

/** Two rooms flush on x = 6.4: the kitchen's west wall abuts the middle
 * stretch of the living room's east wall (living wall 1 runs y 0 → 5.2,
 * kitchen wall 3 runs y 4 → 1, so the walls are antiparallel). */
function livingRoom(openings: Opening[] = []): Room {
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

function kitchen(openings: Opening[] = []): Room {
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

  it("ignores rooms with a gap between them", () => {
    const shifted = kitchen();
    shifted.outline = shifted.outline.map((p) => ({ x: p.x + 0.1, y: p.y }));
    expect(floorSeams([livingRoom(), shifted])).toEqual([]);
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
  const door: Opening = {
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
    const straddling: Opening = { ...door, offset: 3.7 };
    const portals = floorPortals([livingRoom([straddling]), kitchen()]);
    expect(portals).toHaveLength(1);
    expect(portals[0].otherOffset).toBeCloseTo(0);
    expect(portals[0].otherWidth).toBeCloseTo(0.3);
  });

  it("leaves openings off the seam unclassified", () => {
    const exterior: Opening = { ...door, wallIndex: 0 };
    const pastSeam: Opening = { ...door, offset: 4.2 };
    expect(floorPortals([livingRoom([exterior, pastSeam]), kitchen()])).toEqual(
      [],
    );
  });
});

describe("floorSeamData", () => {
  const door: Opening = {
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
  const door: Opening = {
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
    const exterior: Opening = { ...door, wallIndex: 0 };
    const rooms = [livingRoom([exterior]), kitchen()];
    expect(portalLabel(rooms, floorPortals(rooms), "door-1")).toBeNull();
  });
});
