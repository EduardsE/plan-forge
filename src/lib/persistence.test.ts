import { describe, expect, it } from "vitest";
import { createSampleFloor, type Floor, reconcileFloor } from "./model";
import {
  deserializeSavedState,
  formatSavedStatus,
  serializeSavedState,
} from "./persistence";

/** A normalized v6 floor — reconcile is idempotent, so a read round-trips it. */
const sampleFloor = (): Floor => reconcileFloor(createSampleFloor());

const sampleState = () => ({
  floor: sampleFloor(),
  unit: "cm" as const,
  savedAt: 1_750_000_000_000,
});

/** `sampleState` with a patched floor. */
const withFloor = (floor: Floor) => ({ ...sampleState(), floor });

describe("serialize / deserialize round trip", () => {
  it("restores the floor, unit, and savedAt exactly", () => {
    const state = sampleState();
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a material colorway override", () => {
    const floor = sampleFloor();
    floor.furniture[0] = { ...floor.furniture[0], colorway: "#6f7d6a" };
    const restored = deserializeSavedState(
      serializeSavedState(withFloor(floor)),
    );
    expect(restored?.floor.furniture[0].colorway).toBe("#6f7d6a");
  });

  it("round-trips a custom wall height and rejects out-of-range ones", () => {
    const floor = sampleFloor();
    floor.rooms[0] = { ...floor.rooms[0], wallHeight: 3.1 };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(floor))),
    ).toEqual(withFloor(floor));

    for (const wallHeight of [1.9, 12, Number.NaN]) {
      const bad = sampleFloor();
      bad.rooms[0] = { ...bad.rooms[0], wallHeight };
      expect(
        deserializeSavedState(serializeSavedState(withFloor(bad))),
      ).toBeNull();
    }
  });

  it("accepts an empty graph (a new room awaiting its first draw)", () => {
    const state = withFloor(
      reconcileFloor({
        nodes: [],
        edges: [],
        openings: [],
        furniture: [],
        rooms: [],
      }),
    );
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a named floor", () => {
    const state = withFloor({ ...sampleFloor(), name: "Loft apartment" });
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips opening sill/head overrides, rejects malformed ones", () => {
    const floor = sampleFloor();
    floor.openings = floor.openings.map((o) =>
      o.kind === "window" ? { ...o, sill: 0.9, head: 2.2 } : o,
    );
    expect(
      deserializeSavedState(serializeSavedState(withFloor(floor))),
    ).toEqual(withFloor(floor));

    // A door can't carry a sill; a head at/under its bottom is malformed.
    const doorSill = sampleFloor();
    doorSill.openings = doorSill.openings.map((o) =>
      o.kind === "door" ? { ...o, sill: 0.5 } : o,
    );
    expect(
      deserializeSavedState(serializeSavedState(withFloor(doorSill))),
    ).toBeNull();
    const inverted = sampleFloor();
    inverted.openings = inverted.openings.map((o) =>
      o.kind === "window" ? { ...o, sill: 1.5, head: 1.2 } : o,
    );
    expect(
      deserializeSavedState(serializeSavedState(withFloor(inverted))),
    ).toBeNull();
  });
});

describe("deserializeSavedState rejection", () => {
  it("returns null for a missing or unparsable payload", () => {
    expect(deserializeSavedState(null)).toBeNull();
    expect(deserializeSavedState("not json {")).toBeNull();
    expect(deserializeSavedState('"a string"')).toBeNull();
  });

  it("rejects an unreadable version (including a pre-v6 payload)", () => {
    const json = serializeSavedState(sampleState()).replace(
      '"version":6',
      '"version":99',
    );
    expect(deserializeSavedState(json)).toBeNull();
    // A seeded v5 (per-room-outline) payload is discarded — no migration.
    const v5 = JSON.stringify({
      version: 5,
      floor: { rooms: [{ id: "r", outline: [], openings: [], furniture: [] }] },
      unit: "cm",
      savedAt: 1,
    });
    expect(deserializeSavedState(v5)).toBeNull();
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

  it("rejects duplicate node ids or non-finite coordinates", () => {
    const dupNode = sampleFloor();
    dupNode.nodes[1] = { ...dupNode.nodes[1], id: dupNode.nodes[0].id };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(dupNode))),
    ).toBeNull();

    const badCoord = sampleFloor();
    badCoord.nodes[0] = { ...badCoord.nodes[0], x: Number.NaN };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(badCoord))),
    ).toBeNull();
  });

  it("rejects an edge with a missing endpoint, equal endpoints, or a duplicate id", () => {
    const missing = sampleFloor();
    missing.edges[0] = { ...missing.edges[0], a: "ghost" };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(missing))),
    ).toBeNull();

    const loop = sampleFloor();
    loop.edges[0] = { ...loop.edges[0], b: loop.edges[0].a };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(loop))),
    ).toBeNull();

    const dup = sampleFloor();
    dup.edges[1] = { ...dup.edges[1], id: dup.edges[0].id };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(dup))),
    ).toBeNull();
  });

  it("rejects an opening on a missing edge, with a bad side, or overrunning its edge", () => {
    const noEdge = sampleFloor();
    noEdge.openings[0] = { ...noEdge.openings[0], edgeId: "ghost" };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(noEdge))),
    ).toBeNull();

    const badSide = sampleFloor();
    badSide.openings[0] = { ...badSide.openings[0], side: 0 as never };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(badSide))),
    ).toBeNull();

    const overrun = sampleFloor();
    overrun.openings[0] = { ...overrun.openings[0], width: 999 };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(overrun))),
    ).toBeNull();
  });

  it("rejects duplicate room ids or a non-finite anchor", () => {
    const dup = sampleFloor();
    dup.rooms[1] = { ...dup.rooms[1], id: dup.rooms[0].id };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(dup))),
    ).toBeNull();

    const badAnchor = sampleFloor();
    badAnchor.rooms[0] = {
      ...badAnchor.rooms[0],
      anchor: { x: 0, y: "z" } as never,
    };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(badAnchor))),
    ).toBeNull();
  });

  it("rejects malformed furniture", () => {
    const bad = sampleFloor();
    bad.furniture = [{ id: "x", catalogId: "desk" }] as never;
    expect(
      deserializeSavedState(serializeSavedState(withFloor(bad))),
    ).toBeNull();
  });

  it("rejects a mount on a missing edge or a bad side", () => {
    const noEdge = sampleFloor();
    const mounted = noEdge.furniture.findIndex((item) => item.mount);
    const item = noEdge.furniture[mounted];
    noEdge.furniture[mounted] = {
      ...item,
      mount: { ...item.mount, edgeId: "ghost" } as never,
    };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(noEdge))),
    ).toBeNull();
  });

  it("round-trips a stacked rider and rejects broken stack anchors", () => {
    const stacked = (): Floor => {
      const floor = sampleFloor();
      floor.furniture = [
        ...floor.furniture,
        {
          id: "lamp-1",
          catalogId: "table-lamp",
          position: { x: 4, y: 1 },
          rotation: 0,
          footprint: { width: 0.22, depth: 0.22, height: 0.48 },
          stack: { hostId: "desk-1", dx: 0.4, dy: 0.1 },
        },
      ];
      return floor;
    };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(stacked()))),
    ).toEqual(withFloor(stacked()));

    const orphaned = stacked();
    orphaned.furniture[orphaned.furniture.length - 1] = {
      ...orphaned.furniture[orphaned.furniture.length - 1],
      stack: { hostId: "gone", dx: 0, dy: 0 },
    };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(orphaned))),
    ).toBeNull();

    const bent = stacked();
    bent.furniture[bent.furniture.length - 1] = {
      ...bent.furniture[bent.furniture.length - 1],
      stack: { hostId: "desk-1", dx: Number.NaN, dy: 0 },
    };
    expect(
      deserializeSavedState(serializeSavedState(withFloor(bent))),
    ).toBeNull();
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
