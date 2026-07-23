import { describe, expect, it } from "vitest";

import {
  type Building,
  createFloor,
  createSampleFloor,
  type Floor,
  reconcileFloor,
  type Stair,
  setEdgeThickness,
  setOpeningSillMaterial,
  setOpeningSillOverhang,
} from "#/lib/model";
import { makeFloor } from "#/lib/model/test-fixtures";
import {
  deserializeSavedState,
  formatSavedStatus,
  serializeSavedState,
} from "./persistence";

/**
 * A normalized v6 floor — reconcile is idempotent, so a read round-trips it.
 * Pinned to a fixed id (`createSampleFloor` otherwise mints a fresh
 * `crypto.randomUUID()` per call) so two independent calls in the same test
 * compare equal.
 */
const sampleFloor = (): Floor => ({
  ...reconcileFloor(createSampleFloor()),
  id: "sample-floor",
});

const sampleBuilding = (): Building => ({ floors: [sampleFloor()] });

const sampleState = () => ({
  building: sampleBuilding(),
  unit: "cm" as const,
  savedAt: 1_750_000_000_000,
});

/** `sampleState` with a patched, single-floor building. */
const withFloor = (floor: Floor) => ({
  ...sampleState(),
  building: { floors: [floor] },
});

/** Pulls the first floor's raw parsed record out of a tampered save payload. */
const floorAt = (p: Record<string, unknown>): Record<string, unknown> => {
  const building = p.building as Record<string, unknown>;
  const floors = building.floors as Record<string, unknown>[];
  return floors[0];
};

describe("serialize / deserialize round trip", () => {
  it("restores the building, unit, and savedAt exactly", () => {
    const state = sampleState();
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a v7 two-floor building", () => {
    const building = {
      floors: [createSampleFloor(), { ...createFloor("f2"), name: "Upstairs" }],
    };
    const json = serializeSavedState({ building, unit: "m", savedAt: 123 });
    expect(JSON.parse(json).version).toBe(7);
    const back = deserializeSavedState(json);
    expect(back?.building.floors).toHaveLength(2);
    expect(back?.building.floors[1].name).toBe("Upstairs");
  });

  it("round-trips a material colorway override", () => {
    const floor = sampleFloor();
    floor.furniture[0] = { ...floor.furniture[0], colorway: "#6f7d6a" };
    const restored = deserializeSavedState(
      serializeSavedState(withFloor(floor)),
    );
    expect(restored?.building.floors[0].furniture[0].colorway).toBe("#6f7d6a");
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
        id: "empty",
        nodes: [],
        edges: [],
        openings: [],
        furniture: [],
        rooms: [],
        stairs: [],
      }),
    );
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a named floor", () => {
    const state = withFloor({ ...sampleFloor(), name: "Loft apartment" });
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });

  it("round-trips a sun-azimuth override, and its absence", () => {
    const aimed = { ...sampleState(), sunAzimuthDeg: -117.5 };
    expect(deserializeSavedState(serializeSavedState(aimed))).toEqual(aimed);
    // Auto mode (and every pre-dial save) simply omits the field.
    const auto = deserializeSavedState(serializeSavedState(sampleState()));
    expect(auto).toEqual(sampleState());
    expect(auto && "sunAzimuthDeg" in auto).toBe(false);
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
      '"version":7',
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

  it("rejects a non-finite sun azimuth", () => {
    const json = serializeSavedState(sampleState()).replace(
      '"unit"',
      '"sunAzimuthDeg":"south","unit"',
    );
    expect(deserializeSavedState(json)).toBeNull();
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

describe("wall thickness + sill persistence", () => {
  const save = (floor: Floor): string =>
    serializeSavedState({
      building: { floors: [floor] },
      unit: "m",
      savedAt: 1,
    });

  it("round-trips edge thickness and sill fields", () => {
    let floor = reconcileFloor(makeFloor());
    floor = setEdgeThickness(floor, "AB", 0.3);
    floor = setOpeningSillOverhang(floor, "window-AB", 0.18);
    floor = setOpeningSillMaterial(floor, "window-AB", "wood");
    const restored = deserializeSavedState(save(floor));
    expect(restored).not.toBeNull();
    expect(
      restored?.building.floors[0].edges.find((e) => e.id === "AB")?.thickness,
    ).toBe(0.3);
    const window = restored?.building.floors[0].openings.find(
      (o) => o.id === "window-AB",
    );
    expect(window?.sillOverhang).toBe(0.18);
    expect(window?.sillMaterial).toBe("wood");
  });

  it("rejects out-of-range or wrong-kind values", () => {
    const base = reconcileFloor(makeFloor());
    const tamper = (
      mutate: (parsed: Record<string, unknown>) => void,
    ): string => {
      const parsed = JSON.parse(save(base)) as Record<string, unknown>;
      mutate(parsed);
      return JSON.stringify(parsed);
    };
    expect(
      deserializeSavedState(
        tamper((p) => {
          const floor = floorAt(p);
          const edges = floor.edges as Record<string, unknown>[];
          edges[0] = { ...edges[0], thickness: 3 };
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSavedState(
        tamper((p) => {
          const floor = floorAt(p);
          const openings = floor.openings as Record<string, unknown>[];
          openings[0] = { ...openings[0], sillOverhang: 0.1 };
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSavedState(
        tamper((p) => {
          const floor = floorAt(p);
          const openings = floor.openings as Record<string, unknown>[];
          openings[1] = { ...openings[1], sillMaterial: "granite" };
        }),
      ),
    ).toBeNull();
  });
});

describe("floor id / stairs (fill-on-read + validation)", () => {
  const save = (floor: Floor): string =>
    serializeSavedState({
      building: { floors: [floor] },
      unit: "m",
      savedAt: 1,
    });
  const tamper = (
    floor: Floor,
    mutate: (parsed: Record<string, unknown>) => void,
  ): string => {
    const parsed = JSON.parse(save(floor)) as Record<string, unknown>;
    mutate(parsed);
    return JSON.stringify(parsed);
  };
  const validStair: Stair = {
    id: "stair-1",
    position: { x: 2, y: 2 },
    rotation: 0,
    width: 0.9,
  };
  const base = (): Floor => reconcileFloor(makeFloor());

  it("fills a floor's missing id and stairs with generated defaults", () => {
    const json = tamper(base(), (p) => {
      const floor = floorAt(p);
      delete floor.id;
      delete floor.stairs;
    });
    const restored = deserializeSavedState(json);
    expect(restored).not.toBeNull();
    expect(typeof restored?.building.floors[0].id).toBe("string");
    expect(restored?.building.floors[0].id.length).toBeGreaterThan(0);
    expect(restored?.building.floors[0].stairs).toEqual([]);
  });

  it("rejects an empty-string floor id", () => {
    const json = tamper(base(), (p) => {
      const floor = floorAt(p);
      floor.id = "";
    });
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("rejects a stairs array whose member isn't stair-shaped", () => {
    const json = tamper({ ...base(), stairs: [validStair] }, (p) => {
      const floor = floorAt(p);
      floor.stairs = ["not-a-stair"];
    });
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("rejects a stair width outside [0.7, 2.0]", () => {
    const tooNarrow = tamper({ ...base(), stairs: [validStair] }, (p) => {
      const floor = floorAt(p);
      const stairs = floor.stairs as Record<string, unknown>[];
      stairs[0] = { ...stairs[0], width: 0.5 };
    });
    expect(deserializeSavedState(tooNarrow)).toBeNull();

    const tooWide = tamper({ ...base(), stairs: [validStair] }, (p) => {
      const floor = floorAt(p);
      const stairs = floor.stairs as Record<string, unknown>[];
      stairs[0] = { ...stairs[0], width: 2.5 };
    });
    expect(deserializeSavedState(tooWide)).toBeNull();
  });

  it("rejects a stair with a non-finite rotation", () => {
    const json = tamper({ ...base(), stairs: [validStair] }, (p) => {
      const floor = floorAt(p);
      const stairs = floor.stairs as Record<string, unknown>[];
      stairs[0] = { ...stairs[0], rotation: "north" };
    });
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("rejects duplicate stair ids on the same floor", () => {
    const twoStairs: Floor = {
      ...base(),
      stairs: [validStair, { ...validStair, id: "stair-2" }],
    };
    const json = tamper(twoStairs, (p) => {
      const floor = floorAt(p);
      const stairs = floor.stairs as Record<string, unknown>[];
      stairs[1] = { ...stairs[1], id: stairs[0].id };
    });
    expect(deserializeSavedState(json)).toBeNull();
  });

  it("round-trips a valid stairs array intact when it isn't the top floor", () => {
    const floor: Floor = {
      ...base(),
      stairs: [
        validStair,
        { ...validStair, id: "stair-2", position: { x: 4, y: 1 } },
      ],
    };
    const building = { floors: [floor, createFloor("upstairs")] };
    const state = { building, unit: "m" as const, savedAt: 1 };
    expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
  });
});

describe("v7 building validation", () => {
  const f = () => ({ ...createSampleFloor(), id: "ground" });
  const bad = (building: unknown) =>
    deserializeSavedState(
      JSON.stringify({ version: 7, building, unit: "m", savedAt: 1 }),
    );

  it("reads a v6 single-floor payload as a one-floor building", () => {
    const floor = createSampleFloor();
    const v6 = JSON.stringify({ version: 6, floor, unit: "m", savedAt: 5 });
    const back = deserializeSavedState(v6);
    expect(back?.building.floors).toHaveLength(1);
    expect(back?.building.floors[0].furniture.length).toBe(
      floor.furniture.length,
    );
    expect(back?.savedAt).toBe(5);
  });

  it("rejects: zero floors, duplicate floor ids, stairs on the top floor", () => {
    expect(bad({ floors: [] })).toBeNull();
    expect(bad({ floors: [f(), { ...createFloor(), id: f().id }] })).toBeNull();
    expect(
      bad({
        floors: [
          {
            ...f(),
            stairs: [
              { id: "s", position: { x: 1, y: 1 }, rotation: 0, width: 0.9 },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects a stair id shared across two different floors", () => {
    const stair = {
      id: "shared-stair",
      position: { x: 1, y: 1 },
      rotation: 0,
      width: 0.9,
    };
    expect(
      bad({
        floors: [
          { ...f(), stairs: [stair] },
          { ...createFloor("f2"), stairs: [stair] },
        ],
      }),
    ).toBeNull();
  });

  it("accepts a valid multi-floor building where only a lower floor has stairs", () => {
    const stair = {
      id: "stair-1",
      position: { x: 1, y: 1 },
      rotation: 0,
      width: 0.9,
    };
    const json = JSON.stringify({
      version: 7,
      building: { floors: [{ ...f(), stairs: [stair] }, createFloor("f2")] },
      unit: "m",
      savedAt: 1,
    });
    const back = deserializeSavedState(json);
    expect(back?.building.floors).toHaveLength(2);
    expect(back?.building.floors[0].stairs).toHaveLength(1);
  });
});
