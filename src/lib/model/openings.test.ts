import { describe, expect, it } from "vitest";
import {
  addOpening,
  flipDoorHinge,
  moveOpening,
  removeOpening,
} from "./openings";
import { createSampleRoom } from "./sample-room";
import type { RoomOpening } from "./types";

describe("addOpening", () => {
  it("appends the opening without mutating the input", () => {
    const room = createSampleRoom();
    const opening: RoomOpening = {
      id: "door-2",
      kind: "door",
      wallIndex: 2,
      offset: 1.2,
      width: 0.9,
      hinge: "start",
    };
    const next = addOpening(room, opening);
    expect(next.openings.at(-1)).toBe(opening);
    expect(next.openings).toHaveLength(room.openings.length + 1);
    expect(room.openings.some((entry) => entry.id === "door-2")).toBe(false);
  });
});

describe("moveOpening", () => {
  it("re-offsets the target opening only, without mutating the input", () => {
    const room = createSampleRoom();
    const next = moveOpening(room, "window-1", 1.05);
    expect(next.openings.find((o) => o.id === "window-1")?.offset).toBe(1.05);
    expect(next.openings.find((o) => o.id === "door-1")?.offset).toBe(3.6);
    expect(room.openings.find((o) => o.id === "window-1")?.offset).toBe(3.5);
  });

  it("leaves the room unchanged for an unknown id", () => {
    const room = createSampleRoom();
    expect(moveOpening(room, "nope", 1).openings).toEqual(room.openings);
  });
});

describe("flipDoorHinge", () => {
  it("swaps start to end and back", () => {
    const room = createSampleRoom();
    const flipped = flipDoorHinge(room, "door-1");
    expect(flipped.openings.find((o) => o.id === "door-1")?.hinge).toBe("end");
    const restored = flipDoorHinge(flipped, "door-1");
    expect(restored.openings.find((o) => o.id === "door-1")?.hinge).toBe(
      "start",
    );
  });

  it("treats a missing hinge as the default start", () => {
    const room = addOpening(createSampleRoom(), {
      id: "door-2",
      kind: "door",
      wallIndex: 2,
      offset: 1,
      width: 0.9,
    });
    expect(
      flipDoorHinge(room, "door-2").openings.find((o) => o.id === "door-2")
        ?.hinge,
    ).toBe("end");
  });

  it("never touches windows", () => {
    const room = createSampleRoom();
    const next = flipDoorHinge(room, "window-1");
    expect(next.openings.find((o) => o.id === "window-1")?.hinge).toBe(
      undefined,
    );
  });
});

describe("removeOpening", () => {
  it("removes the opening without mutating the input", () => {
    const room = createSampleRoom();
    const next = removeOpening(room, "door-1");
    expect(next.openings.some((o) => o.id === "door-1")).toBe(false);
    expect(next.openings).toHaveLength(room.openings.length - 1);
    expect(room.openings.some((o) => o.id === "door-1")).toBe(true);
  });
});
