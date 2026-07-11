import { describe, expect, it } from "vitest";
import { createSampleRoom } from "./model";
import {
  deserializeSavedState,
  formatSavedStatus,
  serializeSavedState,
} from "./persistence";

const sampleState = () => ({
  room: createSampleRoom(),
  unit: "cm" as const,
  savedAt: 1_750_000_000_000,
});

describe("serialize / deserialize round trip", () => {
  it("restores the room, unit, and savedAt exactly", () => {
    const state = sampleState();
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a material colorway override", () => {
    const base = createSampleRoom();
    const state = {
      room: {
        ...base,
        furniture: base.furniture.map((item, i) =>
          i === 0 ? { ...item, colorway: "#6f7d6a" } : item,
        ),
      },
      unit: "m" as const,
      savedAt: 1,
    };
    const restored = deserializeSavedState(serializeSavedState(state));
    expect(restored?.room.furniture[0].colorway).toBe("#6f7d6a");
  });

  it("accepts an empty room (a new room awaiting its first draw)", () => {
    const state = {
      room: { name: "Untitled room", outline: [], openings: [], furniture: [] },
      unit: "m" as const,
      savedAt: 1,
    };
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
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
      '"version":2',
      '"version":99',
    );
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("still reads a legacy v1 save (colorway predates it, stays default)", () => {
    const state = sampleState();
    const v1 = serializeSavedState(state).replace('"version":2', '"version":1');
    expect(deserializeSavedState(v1)).toEqual(state);
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

  it("rejects malformed outline points and furniture", () => {
    const state = sampleState();
    const badOutline = {
      ...state,
      room: { ...state.room, outline: [{ x: 0, y: "zero" }] },
    };
    expect(
      deserializeSavedState(serializeSavedState(badOutline as never)),
    ).toBeNull();
    const badFurniture = {
      ...state,
      room: {
        ...state.room,
        furniture: [{ id: "x", catalogId: "desk" }],
      },
    };
    expect(
      deserializeSavedState(serializeSavedState(badFurniture as never)),
    ).toBeNull();
  });

  it("rejects an opening whose wallIndex points past the outline's walls", () => {
    const state = sampleState();
    const room = state.room;
    room.openings[0].wallIndex = room.outline.length;
    expect(deserializeSavedState(serializeSavedState(state))).toBeNull();
  });

  it("round-trips a stacked rider and rejects broken stack anchors", () => {
    const stacked = () => {
      const state = sampleState();
      state.room.furniture.push({
        id: "lamp-1",
        catalogId: "table-lamp",
        position: { x: 4, y: 1 },
        rotation: 0,
        footprint: { width: 0.22, depth: 0.22, height: 0.48 },
        stack: { hostId: "desk-1", dx: 0.4, dy: 0.1 },
      });
      return state;
    };
    expect(deserializeSavedState(serializeSavedState(stacked()))).toEqual(
      stacked(),
    );

    // Anchor pointing at a missing host.
    const orphaned = stacked();
    const orphanRider = orphaned.room.furniture.at(-1);
    if (orphanRider?.stack) orphanRider.stack.hostId = "gone";
    expect(deserializeSavedState(serializeSavedState(orphaned))).toBeNull();

    // Anchor pointing at another rider (stacks are one level deep).
    const chained = stacked();
    chained.room.furniture.push({
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
    const bentRider = bent.room.furniture.at(-1);
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
