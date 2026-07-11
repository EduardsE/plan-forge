import { describe, expect, it } from "vitest";
import { createSampleFloor, createSampleRoom } from "./model";
import {
  deserializeSavedState,
  formatSavedStatus,
  serializeSavedState,
} from "./persistence";

const sampleState = () => ({
  floor: createSampleFloor(),
  unit: "cm" as const,
  savedAt: 1_750_000_000_000,
});

/** `sampleState` with its (single) room swapped for a patched copy. */
const withRoom = (room: ReturnType<typeof createSampleRoom>) => ({
  ...sampleState(),
  floor: { rooms: [room] },
});

describe("serialize / deserialize round trip", () => {
  it("restores the floor, unit, and savedAt exactly", () => {
    const state = sampleState();
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a material colorway override", () => {
    const base = createSampleRoom();
    const state = withRoom({
      ...base,
      furniture: base.furniture.map((item, i) =>
        i === 0 ? { ...item, colorway: "#6f7d6a" } : item,
      ),
    });
    const restored = deserializeSavedState(serializeSavedState(state));
    expect(restored?.floor.rooms[0].furniture[0].colorway).toBe("#6f7d6a");
  });

  it("round-trips a custom wall height and rejects out-of-range ones", () => {
    const state = withRoom({ ...createSampleRoom(), wallHeight: 3.1 });
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);

    for (const wallHeight of [1.9, 12, Number.NaN]) {
      const bad = withRoom({ ...createSampleRoom(), wallHeight });
      expect(deserializeSavedState(serializeSavedState(bad))).toBeNull();
    }
  });

  it("accepts an empty room (a new room awaiting its first draw)", () => {
    const state = withRoom({
      id: "room-1",
      name: "Untitled room",
      outline: [],
      openings: [],
      furniture: [],
    });
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a named floor", () => {
    const state = {
      ...sampleState(),
      floor: { ...createSampleFloor(), name: "Loft apartment" },
    };
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });
});

describe("legacy single-room saves (v1–v3)", () => {
  /** A pre-v4 payload: `room` at the top level, no room id. */
  const legacyPayload = (version: number) => {
    const { id: _dropped, ...room } = createSampleRoom();
    return JSON.stringify({
      version,
      room,
      unit: "cm",
      savedAt: 1_750_000_000_000,
    });
  };

  it("migrates each readable legacy version into a one-room floor", () => {
    for (const version of [1, 2, 3]) {
      const restored = deserializeSavedState(legacyPayload(version));
      expect(restored).not.toBeNull();
      expect(restored?.floor.rooms).toHaveLength(1);
      const { id, ...rest } = restored?.floor.rooms[0] ?? { id: "" };
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      const { id: _sample, ...sampleRest } = createSampleRoom();
      expect(rest).toEqual(sampleRest);
      expect(restored?.unit).toBe("cm");
      expect(restored?.savedAt).toBe(1_750_000_000_000);
    }
  });

  it("still rejects a malformed legacy room", () => {
    const broken = JSON.stringify({
      version: 3,
      room: { outline: 5, openings: [], furniture: [] },
      unit: "cm",
      savedAt: 1,
    });
    expect(deserializeSavedState(broken)).toBeNull();
  });
});

describe("deserializeSavedState rejection", () => {
  it("returns null for a missing or unparsable payload", () => {
    expect(deserializeSavedState(null)).toBeNull();
    expect(deserializeSavedState("not json {")).toBeNull();
    expect(deserializeSavedState('"a string"')).toBeNull();
  });

  it("rejects an unreadable version", () => {
    const json = serializeSavedState(sampleState()).replace(
      '"version":4',
      '"version":99',
    );
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("rejects a bad unit or savedAt", () => {
    const state = sampleState();
    expect(
      deserializeSavedState(
        serializeSavedState({ ...state, unit: "ft" as never }),
      ),
    ).toBeNull();
    expect(
      deserializeSavedState(
        serializeSavedState({ ...state, savedAt: Number.NaN }),
      ),
    ).toBeNull();
  });

  it("rejects a floor with no rooms, missing ids, or duplicate ids", () => {
    const state = sampleState();
    expect(
      deserializeSavedState(
        serializeSavedState({ ...state, floor: { rooms: [] } }),
      ),
    ).toBeNull();

    const { id: _dropped, ...idless } = createSampleRoom();
    expect(
      deserializeSavedState(
        serializeSavedState({
          ...state,
          floor: { rooms: [idless] } as never,
        }),
      ),
    ).toBeNull();

    expect(
      deserializeSavedState(
        serializeSavedState({
          ...state,
          floor: { rooms: [createSampleRoom(), createSampleRoom()] },
        }),
      ),
    ).toBeNull();
  });

  it("rejects malformed outline points and furniture", () => {
    const badOutline = withRoom({
      ...createSampleRoom(),
      outline: [{ x: 0, y: "zero" }] as never,
    });
    expect(deserializeSavedState(serializeSavedState(badOutline))).toBeNull();
    const badFurniture = withRoom({
      ...createSampleRoom(),
      furniture: [{ id: "x", catalogId: "desk" }] as never,
    });
    expect(deserializeSavedState(serializeSavedState(badFurniture))).toBeNull();
  });

  it("rejects an opening whose wallIndex points past the outline's walls", () => {
    const room = createSampleRoom();
    room.openings[0].wallIndex = room.outline.length;
    expect(
      deserializeSavedState(serializeSavedState(withRoom(room))),
    ).toBeNull();
  });

  it("round-trips a stacked rider and rejects broken stack anchors", () => {
    const stacked = () => {
      const room = createSampleRoom();
      room.furniture.push({
        id: "lamp-1",
        catalogId: "table-lamp",
        position: { x: 4, y: 1 },
        rotation: 0,
        footprint: { width: 0.22, depth: 0.22, height: 0.48 },
        stack: { hostId: "desk-1", dx: 0.4, dy: 0.1 },
      });
      return withRoom(room);
    };
    expect(deserializeSavedState(serializeSavedState(stacked()))).toEqual(
      stacked(),
    );

    // Anchor pointing at a missing host.
    const orphaned = stacked();
    const orphanRider = orphaned.floor.rooms[0].furniture.at(-1);
    if (orphanRider?.stack) orphanRider.stack.hostId = "gone";
    expect(deserializeSavedState(serializeSavedState(orphaned))).toBeNull();

    // Anchor pointing at another rider (stacks are one level deep).
    const chained = stacked();
    chained.floor.rooms[0].furniture.push({
      id: "lamp-2",
      catalogId: "table-lamp",
      position: { x: 4, y: 1 },
      rotation: 0,
      footprint: { width: 0.22, depth: 0.22, height: 0.48 },
      stack: { hostId: "lamp-1", dx: 0, dy: 0 },
    });
    expect(deserializeSavedState(serializeSavedState(chained))).toBeNull();

    // Non-finite offsets.
    const bent = stacked();
    const bentRider = bent.floor.rooms[0].furniture.at(-1);
    if (bentRider?.stack) bentRider.stack.dx = Number.NaN;
    expect(deserializeSavedState(serializeSavedState(bent))).toBeNull();
  });
});

describe("formatSavedStatus", () => {
  const at = 1_000_000_000_000;
  it("steps from just now through minutes, hours, and days", () => {
    expect(formatSavedStatus(at, at)).toBe("saved just now");
    expect(formatSavedStatus(at, at + 59_000)).toBe("saved just now");
    expect(formatSavedStatus(at, at + 60_000)).toBe("saved 1 min ago");
    expect(formatSavedStatus(at, at + 59 * 60_000)).toBe("saved 59 min ago");
    expect(formatSavedStatus(at, at + 2 * 3_600_000)).toBe("saved 2 h ago");
    expect(formatSavedStatus(at, at + 3 * 86_400_000)).toBe("saved 3 d ago");
  });

  it("treats a save from the future as just now (clock skew)", () => {
    expect(formatSavedStatus(at + 5_000, at)).toBe("saved just now");
  });
});
