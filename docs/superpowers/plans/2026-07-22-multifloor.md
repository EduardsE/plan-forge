# Multifloor Implementation Plan (Phase 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple storeys on one plan — add/rename/delete floors, edit one at a time, see them stacked in the 3D dollhouse (sliced at the active floor), trace the storey below through a ghost underlay, and connect levels with straight-run stairs that auto-cut voids.

**Architecture:** A `Building { floors: Floor[] }` wrapper over today's untouched per-storey wall graphs. Elevation, stacking, underlay targets, and stair voids are all *derived* at the building level (`model/building.ts`, `lib/stairs.ts`) — no stored z anywhere. The route flips to `History<Building>` with the active floor id as UI state; every existing helper keeps its `Floor` signature and the floor id threads at the route boundary (the M1 trick). Spec: `docs/superpowers/specs/2026-07-22-multifloor-design.md`.

**Tech Stack:** TypeScript, Vitest, React 19 + R3F (three/drei), TanStack Start. No new dependencies.

## Global Constraints

- Package manager: `pnpm`. Tests: `pnpm vitest run <file>`; full suite `pnpm test`; lint/format `pnpm check` (Biome: tab indentation, double quotes) — run both before every commit.
- All lengths in meters; plan coords x right, **y down**; furniture rotation degrees CCW; `footprintCorners` convention: local +x → `(cos r, -sin r)` (`src/lib/model/furniture.ts:337`).
- **`SLAB_THICKNESS = 0.18`** — already exists as the 3D platform slab (`src/lib/room-scene.ts:37`, rendered hanging below `FLOOR_TOP`). The spec's 0.2 is **corrected to 0.18** so storey math and the rendered slab agree; the constant moves to `model/building.ts` in V1 and `lib/room-scene.ts` re-exports it.
- Stair constants (new, `lib/stairs.ts`): `MAX_RISER = 0.19`, `TREAD_DEPTH = 0.25`, `MIN_STAIR_WIDTH = 0.7`, `MAX_STAIR_WIDTH = 2.0`, `DEFAULT_STAIR_WIDTH = 0.9`.
- Persistence: current `STORAGE_VERSION` is **6**; the building payload is **v7**; `READABLE_VERSIONS = {6, 7}` — a v6 `{ floor }` migrates **on read** into a one-floor building and stays v6 on disk until the first real change (M1 precedent, keeps the honest saved-at). Validation stays reject-by-null for the whole save.
- Every mutation path returns the **same reference on no-ops** (`updateFloorIn` extends the contract one level up) and per-floor graph mutations still end in `reconcileFloor` (`src/lib/model/derived.ts:279`).
- Ids: `crypto.randomUUID()` at creation sites; pure functions that mint ids take an optional id-factory parameter so tests stay deterministic.
- Invariant: **the top floor never holds stairs** (a stair needs a floor above to cut into). `removeFloor` re-establishes it; persistence rejects saves that violate it.
- Per project rules (CLAUDE.md): after each task, verify headless with a self-launched Playwright script (`chromium.launch({ headless: true, channel: "chrome" })`, real `page.mouse`) against `pnpm build` + `pnpm preview` (port 4173; kill stale previews by port: `lsof -tnP -iTCP:4173 -sTCP:LISTEN | xargs kill`) — see the `verify` skill — then commit that task's files only.
- Check tasks off in `PROGRESS.md` (Phase 10 section) as they land.

---

### Task V1: Building & floor-identity model core

Compile-touring but behavior-neutral: `Floor` gains required `id` + `stairs`, `Building` and its derivations land, every `Floor` creation site updates, persistence keeps reading v6 by filling the new fields. The app runs exactly as before.

**Files:**
- Modify: `src/lib/model/types.ts` — `Stair`, `Building`, `Floor` gains `id: string` and `stairs: Stair[]`.
- Create: `src/lib/model/building.ts` + `src/lib/model/building.test.ts`
- Modify: `src/lib/model/sample-room.ts` (`createSampleFloor` fills `id`/`stairs`), `src/lib/model/test-fixtures.ts` (`makeFloor`, `makeLRoom`), `src/routes/index.tsx` (`emptyFloor()` at line 99), `src/lib/persistence.ts` (fill-on-read + validate-if-present; still v6), `src/lib/room-scene.ts` (move `SLAB_THICKNESS` out, re-export), `src/lib/model/index.ts` (export `building`).

**Interfaces:**
- Consumes: `Floor`, `Point` from `./types`; `deriveFloor` from `./derived`; `wallHeightOf`, `DEFAULT_WALL_HEIGHT` from `./room`.
- Produces (later tasks import these exact names):
  - `interface Stair { id: string; position: Point; rotation: number; width: number }` (types.ts)
  - `interface Building { floors: Floor[] }` (types.ts)
  - `const SLAB_THICKNESS = 0.18` (building.ts; re-exported from `#/lib/room-scene`)
  - `function createFloor(id?: string): Floor` — empty graph, empty stairs
  - `function floorById(building: Building, floorId: string): Floor | undefined`
  - `function floorIndexOf(building: Building, floorId: string): number`
  - `function floorDisplayName(building: Building, index: number): string`
  - `function storeyHeightOf(floor: Floor): number`
  - `function storeyElevation(building: Building, index: number): number`
  - `function updateFloorIn(building: Building, floorId: string, fn: (floor: Floor) => Floor): Building`
  - `function addFloorAbove(building: Building, newId?: () => string): Building`
  - `function removeFloor(building: Building, floorId: string): Building`
  - `function renameFloor(building: Building, floorId: string, name: string): Building`
  - `function floorOfItem(building: Building, itemId: string): Floor | undefined`
  - `function floorOfOpening(building: Building, openingId: string): Floor | undefined`
  - `function floorOfEdge(building: Building, edgeId: string): Floor | undefined`
  - `function floorOfStair(building: Building, stairId: string): Floor | undefined`

- [ ] **Step 1: Write the failing tests**

`building.test.ts` — build floors from `makeFloor()` (two rooms, kitchen ceiling settable via its `RoomRecord.wallHeight`) and `createFloor("f2")`:

```ts
import { describe, expect, it } from "vitest";
import {
	addFloorAbove,
	createFloor,
	floorDisplayName,
	floorOfItem,
	removeFloor,
	renameFloor,
	SLAB_THICKNESS,
	storeyElevation,
	storeyHeightOf,
	updateFloorIn,
} from "./building";
import { DEFAULT_WALL_HEIGHT } from "./room";
import { makeFloor } from "./test-fixtures";
import type { Building } from "./types";

const ground = { ...makeFloor(), id: "g" };
const building = (): Building => ({ floors: [ground, createFloor("f2")] });

describe("storey math", () => {
	it("empty floor gets the default ceiling", () => {
		expect(storeyHeightOf(createFloor("x"))).toBeCloseTo(
			DEFAULT_WALL_HEIGHT + SLAB_THICKNESS,
		);
	});
	it("tallest room wins", () => {
		const tall = {
			...ground,
			rooms: ground.rooms.map((r, i) => (i === 0 ? { ...r, wallHeight: 3.2 } : r)),
		};
		expect(storeyHeightOf(tall)).toBeCloseTo(3.2 + SLAB_THICKNESS);
	});
	it("elevation sums the storeys below", () => {
		const b = building();
		expect(storeyElevation(b, 0)).toBe(0);
		expect(storeyElevation(b, 1)).toBeCloseTo(storeyHeightOf(ground));
	});
});

describe("updateFloorIn", () => {
	it("replaces only the target floor and no-ops by reference", () => {
		const b = building();
		expect(updateFloorIn(b, "g", (f) => f)).toBe(b);
		expect(updateFloorIn(b, "missing", (f) => ({ ...f }))).toBe(b);
		const renamed = updateFloorIn(b, "f2", (f) => ({ ...f, name: "Attic" }));
		expect(renamed).not.toBe(b);
		expect(renamed.floors[0]).toBe(b.floors[0]);
		expect(renamed.floors[1].name).toBe("Attic");
	});
});

describe("floor management", () => {
	it("addFloorAbove appends an empty floor with a fresh id", () => {
		let n = 0;
		const b = addFloorAbove(building(), () => `gen-${n++}`);
		expect(b.floors).toHaveLength(3);
		expect(b.floors[2].id).toBe("gen-0");
		expect(b.floors[2].nodes).toEqual([]);
	});
	it("removeFloor refuses the last floor and strips the new top floor's stairs", () => {
		const stair = { id: "s1", position: { x: 2, y: 2 }, rotation: 0, width: 0.9 };
		const b: Building = {
			floors: [{ ...ground, stairs: [stair] }, createFloor("f2")],
		};
		const removed = removeFloor(b, "f2");
		expect(removed.floors).toHaveLength(1);
		expect(removed.floors[0].stairs).toEqual([]); // ground is top now
		expect(removeFloor(removed, "g")).toBe(removed); // last floor: no-op
	});
	it("renameFloor trims, empty reverts to absent, display names derive by index", () => {
		const b = renameFloor(building(), "f2", "  Studio  ");
		expect(b.floors[1].name).toBe("Studio");
		const cleared = renameFloor(b, "f2", "   ");
		expect(cleared.floors[1].name).toBeUndefined();
		expect(floorDisplayName(cleared, 0)).toBe("Ground floor");
		expect(floorDisplayName(cleared, 1)).toBe("Floor 2");
	});
	it("floorOfItem finds the owning floor across storeys", () => {
		const b = building();
		const anyItem = ground.furniture[0];
		expect(floorOfItem(b, anyItem.id)?.id).toBe("g");
		expect(floorOfItem(b, "nope")).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests, verify they fail** — `pnpm vitest run src/lib/model/building.test.ts`, module missing.

- [ ] **Step 3: Add the types and implement `building.ts`**

types.ts (after `Footprint`):

```ts
/** A straight-run stair rising from its floor to the one above. Run length
 * and void are derived (`lib/stairs.ts`), never stored. */
export interface Stair {
	id: string;
	/** Footprint center, plan coords. */
	position: Point;
	/** Degrees CCW, footprint convention (local +y under rotation = climb). */
	rotation: number;
	/** Across-the-run width, clamped [0.7, 2.0]. */
	width: number;
}

/** Ordered ground-up; index 0 is the ground floor. Elevation is derived. */
export interface Building {
	floors: Floor[];
}
```

`Floor` gains (first field): `id: string;` and (after `rooms`): `stairs: Stair[];`.

building.ts core (the rest follows the same patterns):

```ts
export const SLAB_THICKNESS = 0.18;

export function createFloor(id: string = crypto.randomUUID()): Floor {
	return { id, nodes: [], edges: [], openings: [], furniture: [], rooms: [], stairs: [] };
}

export function storeyHeightOf(floor: Floor): number {
	const { rooms } = deriveFloor(floor);
	const ceiling = rooms.length
		? Math.max(...rooms.map(wallHeightOf))
		: DEFAULT_WALL_HEIGHT;
	return ceiling + SLAB_THICKNESS;
}

export function storeyElevation(building: Building, index: number): number {
	let y = 0;
	for (let i = 0; i < index && i < building.floors.length; i++) {
		y += storeyHeightOf(building.floors[i]);
	}
	return y;
}

export function updateFloorIn(
	building: Building,
	floorId: string,
	fn: (floor: Floor) => Floor,
): Building {
	const index = building.floors.findIndex((f) => f.id === floorId);
	if (index === -1) return building;
	const next = fn(building.floors[index]);
	if (next === building.floors[index]) return building;
	const floors = building.floors.slice();
	floors[index] = next;
	return { floors };
}
```

`removeFloor`: no-op (same reference) when `floors.length === 1` or id unknown; otherwise drop the floor, then if the (new) last floor has stairs, replace it with `{ ...top, stairs: [] }`. `renameFloor`: trim; empty string deletes the field (`const { name: _, ...rest } = floor`); unchanged value no-ops. `floorDisplayName(building, index)`: `building.floors[index]?.name ?? (index === 0 ? "Ground floor" : `Floor ${index + 1}`)`. The three finders scan `floors` for the id in `furniture` / `openings` / `edges` / `stairs`.

- [ ] **Step 4: Tour the compile break**

`pnpm check` + `pnpm vitest run` drive it:
- `sample-room.ts`: `createSampleFloor()` returns `{ id: crypto.randomUUID(), ...existing, stairs: [] }`.
- `test-fixtures.ts`: `makeFloor()` / `makeLRoom()` add `id: "fixture-floor"` / `"fixture-l"` and `stairs: []`.
- `routes/index.tsx` `emptyFloor()` (line 99): replace body with `return createFloor();` (import from `#/lib/model`).
- `persistence.ts`: in the floor validator accept + validate the new fields **if present** (`id` non-empty string when present; `stairs` an array of `{ id: non-empty string, position: Point, rotation: finite, width: finite in [0.7, 2.0] }`, unique ids); after validation, fill defaults so the returned `Floor` always satisfies the type: `{ id: floor.id ?? crypto.randomUUID(), stairs: floor.stairs ?? [], ...rest }`. Version stays 6.
- `room-scene.ts:37`: delete the local const, add `SLAB_THICKNESS` to the model re-export line (L35).
- `model/index.ts`: `export * from "./building";`.

- [ ] **Step 5: Run tests, verify green** — `pnpm vitest run src/lib/model/building.test.ts` then `pnpm test` (full suite; fixture-dependent tests may need the two id/stairs fields — fix mechanically).

- [ ] **Step 6: Check + commit**

```bash
pnpm check && pnpm test
git add src/lib/model/types.ts src/lib/model/building.ts src/lib/model/building.test.ts \
  src/lib/model/sample-room.ts src/lib/model/test-fixtures.ts src/lib/model/index.ts \
  src/lib/persistence.ts src/lib/room-scene.ts src/routes/index.tsx
git commit -m "V1: Building/Stair model core — floor identity, derived elevation"
```

No headless run needed (behavior-neutral, covered by the suite); a quick `pnpm build` sanity check is enough.

---

### Task V2: Stair geometry + stair setters (pure)

**Files:**
- Create: `src/lib/stairs.ts` + `src/lib/stairs.test.ts`
- Create: `src/lib/model/stairs.ts` + `src/lib/model/stairs.test.ts`
- Modify: `src/lib/model/index.ts` (export `stairs`)

**Interfaces:**
- Consumes: `Stair`, `Building`, `Floor`, `Point` (types); `storeyHeightOf`, `floorIndexOf`, `updateFloorIn` (building.ts); `footprintCorners` (`model/furniture.ts` — takes `{ position, rotation, footprint }`); `edgeWallObstacles`, `Obstacle` (`lib/place.ts`).
- Produces:
  - lib/stairs.ts:
    - `const MAX_RISER = 0.19`, `TREAD_DEPTH = 0.25`, `MIN_STAIR_WIDTH = 0.7`, `MAX_STAIR_WIDTH = 2.0`, `DEFAULT_STAIR_WIDTH = 0.9`
    - `function stairRun(storeyHeight: number): { risers: number; run: number }`
    - `function stairPolygon(stair: Stair, run: number): Point[]` — 4 corners, rotated
    - `function stairClimbDir(rotation: number): Point` — unit vector, rotation 0 → `{ x: 0, y: 1 }`
    - `function stairVoidObstacles(floor: Floor, storeyHeight: number): Obstacle[]` — one AABB (+ `oriented` slab when rotated off-axis) per stair, for the floor **above**
    - `function stairValid(building: Building, floorId: string, stair: Stair): boolean`
  - model/stairs.ts (all `Floor → Floor`, same-ref no-ops):
    - `function addStair(floor: Floor, stair: Stair): Floor`
    - `function updateStair(floor: Floor, stairId: string, patch: Partial<Omit<Stair, "id">>): Floor` — clamps `width` to `[MIN_STAIR_WIDTH, MAX_STAIR_WIDTH]`
    - `function removeStair(floor: Floor, stairId: string): Floor`

- [ ] **Step 1: Write the failing tests**

`lib/stairs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SLAB_THICKNESS, createFloor } from "#/lib/model/building";
import { makeFloor } from "#/lib/model/test-fixtures";
import {
	stairClimbDir,
	stairPolygon,
	stairRun,
	stairValid,
	stairVoidObstacles,
} from "./stairs";

describe("stairRun", () => {
	it("derives risers and run from the storey height", () => {
		// 2.5 + 0.18 = 2.68 → ceil(2.68 / 0.19) = 15 risers → 3.75 m run
		const { risers, run } = stairRun(2.68);
		expect(risers).toBe(15);
		expect(run).toBeCloseTo(3.75);
	});
});

describe("stairPolygon / stairClimbDir", () => {
	it("rotation 0: width across x, run along +y, climb +y", () => {
		const poly = stairPolygon(
			{ id: "s", position: { x: 2, y: 3 }, rotation: 0, width: 1 },
			3,
		);
		const xs = poly.map((p) => p.x);
		const ys = poly.map((p) => p.y);
		expect(Math.min(...xs)).toBeCloseTo(1.5);
		expect(Math.max(...xs)).toBeCloseTo(2.5);
		expect(Math.min(...ys)).toBeCloseTo(1.5);
		expect(Math.max(...ys)).toBeCloseTo(4.5);
		expect(stairClimbDir(0).x).toBeCloseTo(0);
		expect(stairClimbDir(0).y).toBeCloseTo(1);
	});
	it("rotation 90 climbs along +x (CCW in y-down plan coords)", () => {
		const dir = stairClimbDir(90);
		expect(dir.x).toBeCloseTo(1);
		expect(dir.y).toBeCloseTo(0);
	});
});

describe("stairValid", () => {
	// makeFloor: living room interior x ∈ [0, 6.35], y ∈ [0, 5.2] with the
	// shared wall centerline at x = 6.4.
	const ground = { ...makeFloor(), id: "g" };
	const upper = createFloor("f2");
	const building = { floors: [ground, upper] };
	const stair = (x: number, y: number, rotation = 0) => ({
		id: "s",
		position: { x, y },
		rotation,
		width: 0.9,
	});
	it("accepts a stair clear of walls on both floors", () => {
		expect(stairValid(building, "g", stair(3, 2.5))).toBe(true);
	});
	it("rejects a stair overlapping its own floor's wall slab", () => {
		expect(stairValid(building, "g", stair(6.35, 2.5, 90))).toBe(false);
	});
	it("rejects any stair on the top floor", () => {
		expect(stairValid(building, "f2", stair(3, 2.5))).toBe(false);
	});
	it("rejects when the void would cut the floor above's walls", () => {
		// Give the upper floor a wall crossing x=3 at y∈[1,4].
		const walled = {
			...upper,
			nodes: [
				{ id: "n1", x: 3, y: 1 },
				{ id: "n2", x: 3, y: 4 },
			],
			edges: [{ id: "e1", a: "n1", b: "n2" }],
		};
		const b2 = { floors: [ground, walled] };
		expect(stairValid(b2, "g", stair(3, 2.5))).toBe(false);
	});
});

describe("stairVoidObstacles", () => {
	it("emits one obstacle per stair sized to the run", () => {
		const floor = { ...createFloor("g"), stairs: [
			{ id: "s", position: { x: 2, y: 3 }, rotation: 0, width: 1 },
		] };
		const [ob] = stairVoidObstacles(floor, 2.68);
		expect(ob.min.x).toBeCloseTo(1.5);
		expect(ob.max.y).toBeCloseTo(3 + 3.75 / 2);
	});
});
```

`model/stairs.test.ts`: `addStair` appends (and same floor reference when the stair id already exists); `updateStair` clamps `width: 5` → 2.0, unknown id no-ops by reference, identical patch no-ops by reference; `removeStair` drops by id, unknown id no-ops.

- [ ] **Step 2: Run, verify both fail** — `pnpm vitest run src/lib/stairs.test.ts src/lib/model/stairs.test.ts`.

- [ ] **Step 3: Implement**

`lib/stairs.ts` essentials:

```ts
export function stairRun(storeyHeight: number): { risers: number; run: number } {
	const risers = Math.max(3, Math.ceil(storeyHeight / MAX_RISER));
	return { risers, run: risers * TREAD_DEPTH };
}

export function stairPolygon(stair: Stair, run: number): Point[] {
	return footprintCorners({
		id: stair.id,
		catalogId: "stairs",
		position: stair.position,
		rotation: stair.rotation,
		footprint: { width: stair.width, depth: run, height: 0 },
	});
}

export function stairClimbDir(rotation: number): Point {
	// Local +y (the footprint's depth axis) under footprintCorners'
	// convention (local +x → (cos r, -sin r), plan y down).
	const r = (rotation * Math.PI) / 180;
	return { x: Math.sin(r), y: Math.cos(r) };
}
```

If the rotation-90 test disagrees on sign, trust the test's stated geometry (CCW, y-down) and flip the sine — then re-check rotation 0 still gives `{0, 1}`.

`stairValid(building, floorId, stair)`:
1. `floorIndexOf` — `-1` or the top index → false.
2. `poly = stairPolygon(stair, stairRun(storeyHeightOf(floor)).run)`.
3. For both `edgeWallObstacles(floor)` and `edgeWallObstacles(floors[index + 1])`: reject if the polygon intersects any obstacle. Intersection test: SAT between the stair polygon and the obstacle box (axes: x, y, and for `oriented` slabs the slab's `t`/`n`) — implement a small `polygonIntersectsObstacle(poly: Point[], ob: Obstacle): boolean` helper in this file (project corners on each axis, reject on any separating axis, shrink the obstacle by 1 mm so flush contact passes).

`stairVoidObstacles(floor, storeyHeight)`: for each stair, the AABB of `stairPolygon` as `{ min, max }`; when `rotation % 90 !== 0` also attach an `oriented` slab (`p0` = mid of the base edge, `t` = climb dir, `n` = across, `length` = run, `half` = width / 2) so `snapPlacement`'s oriented path handles it.

`model/stairs.ts`: mirror the shape of `model/walls.ts` setters — find by id, no-op by reference on unknown/unchanged, return `{ ...floor, stairs: next }`. (Stairs live outside the graph, so **no** `reconcileFloor` needed.)

- [ ] **Step 4: Run tests, verify green; full suite.**

- [ ] **Step 5: Check + commit**

```bash
pnpm check && pnpm test
git add src/lib/stairs.ts src/lib/stairs.test.ts src/lib/model/stairs.ts \
  src/lib/model/stairs.test.ts src/lib/model/index.ts
git commit -m "V2: stair geometry + setters — derived run, void obstacles, validity"
```

---

### Task V3: The flip — `History<Building>`, active floor id, persistence v7

Behavior-neutral for a one-floor building: the fresh app must render pixel-identically. No new UI yet (chips are V4).

**Files:**
- Modify: `src/routes/index.tsx` — the whole history/state/mutation layer.
- Modify: `src/lib/persistence.ts` + `src/lib/persistence.test.ts` — v7.

**Interfaces:**
- Consumes: `Building`, `createFloor`, `updateFloorIn`, `floorById`, `floorOfItem`, `floorOfOpening`, `floorOfEdge` (V1).
- Produces (V4–V8 rely on these route names):
  - `const [buildingHistory, setBuildingHistory] = useState(() => createHistory<Building>({ floors: [createSampleFloor()] }))`
  - `const building = buildingHistory.current`
  - `const [activeFloorId, setActiveFloorId] = useState<string>(...)` — initialized from the sample floor's id
  - `const floor = floorById(building, activeFloorId) ?? building.floors[0]` — everything downstream keeps the name `floor`
  - `const commitFloor = (floorId: string, fn: (floor: Floor) => Floor) => void` (commit) and `previewFloorIn = (floorId: string, fn) => void` (preview) — both via `updateFloorIn`, skipping when the building reference is unchanged
  - persistence: `interface SavedState { building: Building; unit: Unit; savedAt: number; sunAzimuthDeg?: number }`

- [ ] **Step 1: Write the failing persistence tests**

In `persistence.test.ts` add/replace:

```ts
it("round-trips a v7 two-floor building", () => {
	const building = {
		floors: [
			createSampleFloor(),
			{ ...createFloor("f2"), name: "Upstairs" },
		],
	};
	const json = serializeSavedState({ building, unit: "m", savedAt: 123 });
	expect(JSON.parse(json).version).toBe(7);
	const back = deserializeSavedState(json);
	expect(back?.building.floors).toHaveLength(2);
	expect(back?.building.floors[1].name).toBe("Upstairs");
});

it("reads a v6 single-floor payload as a one-floor building", () => {
	const floor = createSampleFloor();
	const v6 = JSON.stringify({ version: 6, floor, unit: "m", savedAt: 5 });
	const back = deserializeSavedState(v6);
	expect(back?.building.floors).toHaveLength(1);
	expect(back?.building.floors[0].furniture.length).toBe(floor.furniture.length);
	expect(back?.savedAt).toBe(5);
});

it("rejects: zero floors, duplicate floor ids, stairs on the top floor", () => {
	const f = createSampleFloor();
	const base = { unit: "m", savedAt: 1 };
	const bad = (building: unknown) =>
		deserializeSavedState(JSON.stringify({ version: 7, building, ...base }));
	expect(bad({ floors: [] })).toBeNull();
	expect(bad({ floors: [f, { ...createFloor(), id: f.id }] })).toBeNull();
	expect(
		bad({
			floors: [
				{ ...f, stairs: [{ id: "s", position: { x: 1, y: 1 }, rotation: 0, width: 0.9 }] },
			],
		}),
	).toBeNull();
});
```

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement persistence v7**

- `STORAGE_VERSION = 7`; `READABLE_VERSIONS = new Set([6, 7])`.
- `SavedState.floor` → `building: Building`.
- `deserializeSavedState`: after version check, branch — v6 payloads validate the single `floor` exactly as today (V1's fill keeps ids/stairs), then wrap: `building = { floors: [floor] }`; v7 payloads validate `building.floors` as a non-empty array of valid floors with building-wide-unique floor ids and stair ids, and reject when `floors[floors.length - 1].stairs.length > 0`. Each floor still passes through `reconcileFloor` on read.
- Every stair validated per V1's field rules; also reject a stair whose id collides across floors.

- [ ] **Step 4: Flip the route**

Mechanical but wide — the compiler drives. The essentials:

- History: `createHistory({ floors: [createSampleFloor()] })`; `building = buildingHistory.current`; `buildingRef` mirrors `floorRef`. `activeFloorId` initialized in the same `useState` initializer trick (compute the sample floor once, reuse for both) — e.g. hoist `const initial = useMemo(...)` is NOT allowed before state; instead:
  ```tsx
  const [buildingHistory, setBuildingHistory] = useState(() =>
  	createHistory<Building>({ floors: [createSampleFloor()] }),
  );
  const building = buildingHistory.current;
  const [activeFloorId, setActiveFloorId] = useState(
  	() => buildingHistory.current.floors[0].id,
  );
  ```
- `floor` (line 143) becomes the lookup above; `derived = useMemo(() => deriveFloor(floor), [floor])` unchanged.
- `setFloor(next: Floor)` → `commitFloor(activeFloorId, () => next)` internally: `setBuildingHistory((h) => { const b = updateFloorIn(h.current, floorId, fn); return b === h.current ? h : commitHistory(h, b); })`. `previewFloor` mirrors with `previewHistory`. Keep exported callback names `setFloor` / `previewFloor` so `PlannerCanvasProps` wiring is untouched — they close over `activeFloorId`... **no**: closures go stale inside history updaters. Resolve the id at call time from a `activeFloorIdRef` (mirror ref, updated each render) — same pattern as `floorRef` today.
- Selection-scoped mutations (`mutateFurniture`, the opening setters, `setWallThickness`) resolve the *owning* floor: `const owner = floorOfItem(buildingRef.current, selectedId)` (openings/edges likewise) and target `owner.id` instead of the active id. On a one-floor building this is identical behavior; V5's cross-floor picking then works for free.
- `commitToRoom` / room settings (`renameRoom`, `setCeilingHeight`): thread `updateDerivedRoom` inside `updateFloorIn(building, activeFloorId, ...)` (V4 adds per-floor targeting).
- Draw/graph callbacks (`extendChain` … `deleteEdgeCmd`): all wrap their `Floor → Floor` body in `commitFloor(activeFloorIdRef.current, body)`.
- Undo/redo clamp effect:
  ```tsx
  useEffect(() => {
  	if (!floorById(building, activeFloorId)) {
  		setActiveFloorId(building.floors[Math.min(prevIndexRef.current, building.floors.length - 1)].id);
  	} else {
  		prevIndexRef.current = floorIndexOf(building, activeFloorId);
  	}
  }, [building, activeFloorId]);
  ```
- `startNewRoom`: `setBuilding` one step to `{ floors: [createFloor()] }` + `setActiveFloorId(that id)`; confirm copy unchanged.
- Autosave effect + hydration effect: swap `floor` for `building`; on hydration set `activeFloorId` to `building.floors[0].id`.

- [ ] **Step 5: Full suite + build** — `pnpm check && pnpm test && pnpm build`.

- [ ] **Step 6: Verify headless (production build)**

Script checks: (1) fresh load renders the two-room sample identically (screenshot diff vs a pre-task baseline screenshot taken before starting V3); (2) select the desk in 2D, arrow-nudge → localStorage payload has `version: 7` and `building.floors` length 1; (3) single ⌘Z restores; (4) reload hydrates the v7 payload; (5) a seeded v6 payload (write it into localStorage before load) hydrates with furniture intact and upgrades to v7 after one nudge; (6) zero page errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/index.tsx src/lib/persistence.ts src/lib/persistence.test.ts
git commit -m "V3: History<Building> + active floor id; persistence v7 (v6 readable)"
```

---

### Task V4: Floor chips, settings sections, status/inspector readouts

**Files:**
- Create: `src/components/floor-chips.tsx` + `src/components/floor-chips.test.tsx`
- Modify: `src/routes/index.tsx` (chips mount + add/remove/rename wiring), `src/components/settings-popover.tsx` (+ test), `src/components/status-bar.tsx` (+ test), `src/components/inspector.tsx` (+ test)

**Interfaces:**
- Consumes: `addFloorAbove`, `removeFloor`, `renameFloor`, `floorDisplayName`, `storeyHeightOf` (V1); route state from V3.
- Produces:
  - `interface FloorChipsProps { floors: Array<{ id: string; label: string; name: string }>; activeFloorId: string; onSelect: (id: string) => void; onAdd: () => void }` — `label` is "G", "2", "3"…; `name` feeds the tooltip.
  - SettingsPopover props change: `rooms: Room[]` → `floors: Array<{ id: string; name: string; defaultName: string; rooms: Room[] }>`; `onRename(roomId, …)` → `onRenameRoom(floorId: string, roomId: string, name: string)`; `onWallHeightChange` → `onRoomWallHeight(floorId, roomId, meters)`; new `onRenameFloor(floorId: string, name: string)`, `onDeleteFloor(floorId: string)`, `canDeleteFloor: boolean` (false when one floor).
  - StatusBar gains `floorName?: string | null` (rendered leading when non-null).
  - Inspector gains `floorSummaries?: Array<{ id: string; name: string; area: number; roomCount: number; active: boolean }>` — when length > 1 the no-selection overview renders the building summary instead of the room list.

- [ ] **Step 1: Write failing component tests**

`floor-chips.test.tsx` (jsdom, same style as `nav-rail.test.tsx`): renders one button per floor **top-first** plus an add button (`aria-label="Add floor"`); active chip has `aria-pressed="true"`; clicking a chip calls `onSelect` with its id; clicking add calls `onAdd`. Settings test: two floors render two floor NAME fields and a "Delete floor" button per floor, disabled when `canDeleteFloor` is false; committing a floor NAME calls `onRenameFloor`. StatusBar test: `floorName="Ground floor"` appears; absent → not rendered. Inspector test: `floorSummaries` of 2 renders both names + areas and the totals footer.

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement**

`floor-chips.tsx` — ZoomPill's overlay pattern, vertical:

```tsx
<div
	className="absolute top-1/2 left-5 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[9px] border border-[var(--control-border)] bg-[var(--frame)] p-[3px]"
	style={{ boxShadow: "var(--shadow-sm)" }}
>
	<Tooltip side="right" label="Add floor">
		<button type="button" aria-label="Add floor" onClick={onAdd} className="…">
			<Plus className="h-3.5 w-3.5" />
		</button>
	</Tooltip>
	{[...floors].reverse().map((f) => (
		<Tooltip key={f.id} side="right" label={f.name}>
			<button
				type="button"
				aria-pressed={f.id === activeFloorId}
				onClick={() => onSelect(f.id)}
				className="h-8 w-8 rounded-[7px] font-mono text-[12px] …"
			>
				{f.label}
			</button>
		</Tooltip>
	))}
</div>
```

Active chip: `bg-[var(--blue-tint)] text-[var(--blue)]`; idle: `text-[var(--ink-3)]`. Labels: index 0 → "G", else `String(index + 1)`.

Route wiring: mount `<FloorChips>` inside `.workspace-canvas` next to `ZoomPill` (all lenses). `onAdd`: `setBuildingHistory(commit addFloorAbove)`, then set active to the new top floor's id (read it from the committed building). `onSelect`: `setActiveFloorId` + clear all three selections (they may live on another floor's hidden content; V5 relaxes 3D picking but a switch still resets focus).

Settings popover: outer `floors.map` with a floor header row (NAME `SettingField` + a red "Delete floor" ghost button, `window.confirm` copy: `` `Delete ${name}? Its rooms and furniture are removed; stairs rising to it from below are removed too.` ``), inner `rooms.map` unchanged but handlers carry `floorId`. Route handlers: `renameFloor`/`removeFloor` committed one step; delete also moves `activeFloorId` off the deleted floor (nearest surviving index).

Status bar: render `floorName` as the first left-segment chunk with the existing separator dot pattern. Route passes `building.floors.length > 1 ? floorDisplayName(building, activeIndex) : null`.

Inspector: when `floorSummaries` has > 1 entries and nothing is selected, render rows (`data-testid="inspector-floor-row"`): name left, `formatArea(area, unit)` + `${roomCount} rooms` right, active row tinted `var(--blue-tint)`; footer swaps FLOOR value for the summed area and shows `FLOORS: n`. Route computes summaries via `deriveFloor` per floor — reuse one `useMemo` map `derivedByFloor: Map<string, DerivedFloor>` (this memo is also what V5 hands to the canvas; build it now).

- [ ] **Step 4: Suite + build; verify headless**

Headless checks: fresh load shows "G" + add; add floor → chip "2" active, canvas empty (new storey), status bar shows "Floor 2"; switch back to G → sample room; settings popover shows two floor sections; rename Floor 2 → "Studio" reflected in chip tooltip + status bar; delete Studio → confirm → back to one floor, chips show G only; single ⌘Z restores the deleted floor (undo of the remove commit — active id clamp keeps G); zero page errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/floor-chips.tsx src/components/floor-chips.test.tsx \
  src/components/settings-popover.tsx src/components/settings-popover.test.tsx \
  src/components/status-bar.tsx src/components/status-bar.test.tsx \
  src/components/inspector.tsx src/components/inspector.test.tsx src/routes/index.tsx
git commit -m "V4: floor chips + per-floor settings, status/inspector readouts"
```

---

### Task V5: 3D stack — elevation groups, capped lower floors, cross-floor picking

**Files:**
- Modify: `src/components/planner-canvas.tsx`, `src/components/room-scene.tsx`, `src/components/move-drag.tsx`, `src/routes/index.tsx` (pool vars from union bounds)
- Modify: `src/lib/room-scene.ts` + test (ceiling-slab shape helper)

**Interfaces:**
- Consumes: `storeyElevation`, `storeyHeightOf`, `floorOfItem` (V1); `derivedByFloor` map (V4).
- Produces:
  - `PlannerCanvasProps` gains: `building: Building`, `activeFloorId: string`, `derivedByFloor: Map<string, DerivedFloor>` (existing `floor`/`rooms`/`unassignedFurniture` stay — they remain the *active* floor's, used by 2D/draw and placement).
  - `RoomSceneProps` gains: `stack: Array<{ floor: Floor; derived: DerivedFloor; elevation: number; storeyHeight: number; active: boolean }>` (replaces its `rooms`/`unassignedFurniture`/`floor` — the active entry carries them).
  - room-scene.ts: `function ceilingSlabShape(outline: Point[], holes: Point[][]): { shape: Shape } | null` — outline polygon with hole paths, for extrusion (holes empty until V7).
  - `MoveDrag` gains `floorId: string; elevation: number`; `useMoveDrag`'s `beginDrag` gains those two trailing params.

- [ ] **Step 1: Failing unit test for the slab shape**

In `src/lib/model-scene.test.ts` (or a new `room-scene.test.ts` section): `ceilingSlabShape` of a 4×3 rectangle returns a shape whose bounding box matches; with one rectangular hole the shape has `holes.length === 1`; degenerate outline (< 3 points) → null.

- [ ] **Step 2: Run, fail; implement the helper** (Shape from outline points, `shape.holes.push(new Path(holePoints))` — same three.js Shape pattern `Platform` already uses).

- [ ] **Step 3: Stack rendering**

`PlannerCanvas` builds the stack (only floors 0..activeIndex):

```tsx
const stack = useMemo(() => {
	const activeIndex = floorIndexOf(building, activeFloorId);
	return building.floors.slice(0, activeIndex + 1).map((f, i) => ({
		floor: f,
		derived: derivedByFloor.get(f.id) ?? deriveFloor(f),
		elevation: storeyElevation(building, i),
		storeyHeight: storeyHeightOf(f),
		active: i === activeIndex,
	}));
}, [building, activeFloorId, derivedByFloor]);
```

`RoomScene` maps the stack; each entry renders inside `<group position-y={entry.elevation}>`:
- **Active entry:** exactly today's tree (walls with cutaway + stubs, openings, furniture buckets, selection chip, drag session).
- **Lower entries:** `<Walls>` with a new `capped` prop — when set, every solid renders full height (skip the camera-facing hide *and* the two-face always-stub rule: pass `capped` down and short-circuit the per-frame visibility flip), posts full; `<RoomOpenings>` with pick volumes **enabled** (selection allowed) but window dressing as-is; furniture buckets; plus per room a `<CeilingSlab>`: `ceilingSlabShape(room.outline, [])` extruded `SLAB_THICKNESS`, top face at `wallHeightOf(room) + SLAB_THICKNESS`, plaster-white `meshStandardMaterial`, `raycast={noRaycast}`.
- `FloorContactShadow` + camera bounds: union of every stack entry's `floorBounds` (new tiny `unionBounds(a, b)` helper next to `floorBounds` in `model/floor.ts`); shadow stays at y≈0 only.
- Lights: unchanged (they're scene-level).

Camera: `CameraRig` gains `focusHeight: number` (route/canvas passes `activeEntry.elevation + wallHeightOf(activeRoom or DEFAULT)/2`); the orbit target's y eases toward it over ~300 ms in the existing `useFrame` (lerp when not transitioning), and `fitPerspective`/`zoomToFit` aim at that height instead of 0. Plan camera ignores it (top-down).

Pool CSS vars in the route: swap `floorBounds(derived.rooms)` for the union across visible floors (same memo that feeds the canvas).

- [ ] **Step 4: Cross-floor picking**

- `FurnitureMesh` picks already select by id; the route's owner resolution (V3) already mutates the right floor. What's left is the **drag**: `beginDrag` calls from a lower entry pass `entry.floor.id` + `entry.elevation`; `MoveDragSession` receives the *owning* entry's `floor` + `furniture` (session props come from the entry that owns `drag.floorId`) and offsets its tracked plane: `new Plane(new Vector3(0, 1, 0), -(drag.grabHeight))` already uses absolute grab height — the grab point on a lifted floor is already absolute, so only `snapPlacement`'s output needs no change (plan coords are storey-agnostic). Keyboard nudge/rotate/delete already work through owner resolution.
- Opening/wall picks on lower floors: `onSelectOpening`/`onSelectWall` fire from lower entries too (the route resolves owners). The 3D opening *drag* stays active-floor-only this task (the wall projector's plane is elevation-relative; defer to V8 polish if wanted — **out of scope here, do not build it**; clicking still selects + inspector edits work).
- New placements: `PlacementGhost`/`OpeningGhost`/`WallMountGhost` keep raycasting the active floor — lift their `FLOOR_PLANE` to `new Plane(new Vector3(0, 1, 0), -activeElevation)` via a new `planeY` prop (0 for ground).

- [ ] **Step 5: Suite + build; verify headless**

Seeded two-storey v7 building (upper floor: one small room + a bed). Checks: (1) 3D on Floor 2 shows both storeys stacked — screenshot: ground room capped by a slab, upper room on top with cutaway; (2) switch to G → upper storey gone (slice), screenshot; (3) on Floor 2, click a ground-floor item through the doorway-side view → inspector shows it, arrow-nudge moves it on the ground floor (localStorage confirms which floor's furniture changed), single ⌘Z; (4) drag a lower-floor chair with press-wait-release — it stays contained by ground-floor walls; (5) library drop while Floor 2 active lands in Floor 2's furniture array; (6) 2D lens on Floor 2 shows only Floor 2; (7) zero page errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/planner-canvas.tsx src/components/room-scene.tsx \
  src/components/move-drag.tsx src/components/placement-ghost.tsx \
  src/components/opening-ghost.tsx src/components/wall-mount-ghost.tsx \
  src/lib/room-scene.ts src/lib/model-scene.test.ts src/lib/model/floor.ts \
  src/routes/index.tsx
git commit -m "V5: 3D stack — elevation groups, capped lower floors, cross-floor picking"
```

---

### Task V6: Ghost underlay in the flat lenses + underlay snapping

**Files:**
- Modify: `src/lib/draw.ts` + `src/lib/draw.test.ts` (underlay targets), `src/components/plan-scene.tsx`, `src/components/draw-scene.tsx`, `src/components/planner-canvas.tsx`, `src/components/status-bar.tsx` (+ test), `src/routes/index.tsx`

**Interfaces:**
- Consumes: `buildEdgeSolids` (renders the underlay bands), stack/derived map (V5).
- Produces:
  - `snapTargetsOfGraph(floor: Floor, underlay?: Floor | null): SnapTargets` — underlay nodes join `corners`, underlay edges join `walls` (same `SnapWall` shape; centerline snapping, exactly like own-floor targets).
  - New component in plan-scene.tsx: `UnderlayLayer({ solids }: { solids: WallSolid[] })` — exported for DrawScene reuse.
  - `PlannerCanvasProps` + both scene props gain `underlayFloor: Floor | null` and `underlayRooms: DerivedRoom[]` (for `buildEdgeSolids`); StatusBar gains `underlayVisible?: boolean; onToggleUnderlay?: () => void; underlayAvailable?: boolean`.
  - Route state: `const [underlayVisible, setUnderlayVisible] = useState(true)`.

- [ ] **Step 1: Failing snap test**

In `draw.test.ts`:

```ts
it("underlay walls and corners attract like own-floor targets", () => {
	const below = makeFloor(); // wall at y = -0.05…, corners at x = -0.05 etc.
	const empty = { ...createFloor("up") };
	const targets = snapTargetsOfGraph(empty, below);
	// A cursor near a below-floor node snaps to its exact coordinate.
	const snap = snapDraftPoint([], { x: -0.02, y: -0.02 }, 0.08, true, targets);
	expect(snap.point.x).toBeCloseTo(-0.05);
	expect(snap.point.y).toBeCloseTo(-0.05);
});
it("no underlay → targets unchanged", () => {
	const f = makeFloor();
	expect(snapTargetsOfGraph(f, null)).toEqual(snapTargetsOfGraph(f));
});
```

- [ ] **Step 2: Run, fail; implement** — `snapTargetsOfGraph` gains the optional second param; append the underlay's node points and edge `SnapWall`s (built by the same internal walk it already does for the primary floor).

- [ ] **Step 3: Render + wiring**

- `UnderlayLayer`: for each solid, the same band rects `WallLayer` draws (reuse `bandRect`-style span fill via a `FlatShape` mesh) but flat color `#D4D4CC`, `y = 0.003` (between `SHADOW_Y` 0.002 and `FLOOR_Y` 0.004), `raycast={noRaycast}`, no openings/symbols — door gaps come free because `solid.holes` already split the spans (reuse `solidSpans`; keep window slabs whole).
- PlanScene + DrawScene render `{underlaySolids && <UnderlayLayer solids={underlaySolids} />}` first in their tree; `underlaySolids = useMemo(() => underlayFloor ? buildEdgeSolids(underlayFloor, underlayRooms) : null, …)`.
- DrawScene: `snapTargetsOfGraph(floor, underlayFloor)` (respects the toggle: canvas passes `underlayFloor` as null when hidden).
- Route: `underlayFloor = underlayVisible && activeIndex > 0 ? building.floors[activeIndex - 1] : null`; status-bar toggle (lucide `Layers` icon, `aria-pressed`, tinted `var(--blue)` when on) rendered only when `underlayAvailable` (`activeIndex > 0`), next to the grid/snap toggles.

- [ ] **Step 4: Suite + build; verify headless**

Seeded two-storey building, Floor 2 active, draw lens: (1) underlay bands visible (screenshot); (2) wall tool click near the ground floor's x=6.4 party wall snaps the new node to exactly 6.4 (assert via localStorage node coordinate after commit); (3) toggle underlay off → bands gone, same click no longer snaps to 6.4; (4) ground floor active → no underlay toggle in the status bar; (5) zero page errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/draw.ts src/lib/draw.test.ts src/components/plan-scene.tsx \
  src/components/draw-scene.tsx src/components/planner-canvas.tsx \
  src/components/status-bar.tsx src/components/status-bar.test.tsx src/routes/index.tsx
git commit -m "V6: ghost underlay — grey bands below the active plan, snap-to-below"
```

---

### Task V7: Stairs end-to-end — catalog, ghost, drop, render, voids

**Files:**
- Modify: `src/lib/model/catalog.ts` (+ test), `src/components/objects-panel.tsx` (+ test), `src/components/planner-canvas.tsx`, `src/components/room-scene.tsx`, `src/components/plan-scene.tsx`, `src/routes/index.tsx`
- Create: `src/components/stair-ghost.tsx`, `src/components/stair-mesh.tsx`, `src/components/plan-stairs.tsx`

**Interfaces:**
- Consumes: everything from V2 (`stairRun`, `stairPolygon`, `stairClimbDir`, `stairValid`, `stairVoidObstacles`, `addStair`); `ceilingSlabShape` (V5); `snapPlacement`, `separateFromWalls` (place.ts).
- Produces:
  - catalog: `"stairs"` added to `CatalogCategory` + `CATALOG_CATEGORY_LABELS` (`stairs: "Stairs"`); entry `item("stairs", "Straight stair", "stairs", 0.9, 3.0, 2.6)` (nominal card dims only); `function isStairItem(id: string): boolean`.
  - `ObjectsPanelProps` gains `stairsEnabled: boolean` — when false the stairs card renders as a disabled non-button tile with hint copy "Add a floor above first".
  - `StairGhostProps { building: Building; activeFloorId: string; planeY: number; unit: Unit; snapEnabled: boolean; onPlace: (stair: Stair) => void; onCancel: () => void }`
  - `StairMesh({ stair, storeyHeight }: { stair: Stair; storeyHeight: number })` — tread boxes; derives `{ risers, run }` via `stairRun(storeyHeight)`, riser height = `storeyHeight / risers`.
  - `PlanStairs({ floor, storeyHeight, selectedStairId, onSelectStair, variant }: { …; variant: "up" | "void" })` — "up" on the owning floor (treads + arrow + "UP"), "void" on the floor above (dashed outline + break line + "DN").

- [ ] **Step 1: Failing tests** — catalog test: `"stairs"` category exists, `isStairItem("stairs")` true, `filterCatalog("", "stairs")` returns the entry; objects-panel test: `stairsEnabled={false}` renders the hint tile and no pointerdown handler fires `onStartPlacing` for it.

- [ ] **Step 2: Run, fail; implement catalog + panel gating.** Route passes `stairsEnabled={floorIndexOf(building, activeFloorId) < building.floors.length - 1}`.

- [ ] **Step 3: Ghost + drop**

`stair-ghost.tsx`, modeled directly on `placement-ghost.tsx` (window pointer listeners, `event.target === gl.domElement` guard, plane raycast at `planeY`):
- Size: `const { run } = stairRun(storeyHeightOf(activeFloor))`; ghost footprint `{ width: DEFAULT_STAIR_WIDTH, depth: run }`, rotation 0 while placing.
- Snap: `snapPlacement(size, cursor, [...edgeWallObstacles(activeFloor), ...furniture obstacles], SNAP_TOLERANCE, PLACEMENT_GRID, snapEnabled)` then `separateFromWalls` — same pipeline as furniture, same guide pills.
- Validity: `valid = stairValid(buildingRef.current, activeFloorId, candidate)`; ghost renders the blue dashed footprint + a translucent ramp volume when valid, **red** (`#D64545` at 0.35 opacity, dashed red outline) when not; `pointerup` with `!valid` → `onCancel()` (drop refused), valid → `onPlace(stair)` with `id: crypto.randomUUID()`.
- Canvas branch: `isStairItem(placingItem.id)` → `<StairGhost …/>` (before the furniture ghost branch, like `isOpeningItem`). `onPlace` → route `placeStairItem(stair)`: `commitFloor(activeFloorId, (f) => addStair(f, stair))` + select it (V8 adds the selection kind; for now just commit) + `endPlacing()`.

- [ ] **Step 4: Render + voids**

- `StairMesh`: `risers` boxes, each `stair.width × (storeyHeight / risers)` tall × `TREAD_DEPTH` deep, stepping up along `stairClimbDir`; wood tone from `FURNITURE_COLORS` (walnut); group at `[stair.position.x, elevation, stair.position.y]` rotated like furniture. Mounted for every stack entry (active + lower) in `RoomScene`.
- Voids: in `RoomScene`, lower entries' `<CeilingSlab>` holes = `stairPolygon` of each of **that entry's own** stairs; the entry **above** a stair-bearing entry passes the same polygons into its `Platform` (Platform gains `holes?: Point[][]`, cut via the same Shape-holes path as `ceilingSlabShape` — refactor Platform to use it). 2D: `PlanStairs variant="void"` on the active plan when the floor below has stairs (dashed `#9A9A92` outline, one diagonal break line across the void, "DN" label `Html`); `variant="up"` for the active floor's own stairs (tread lines every `TREAD_DEPTH` across the width, arrow line along climb, "UP").
- Furniture obstacles above a void: everywhere the **active floor's** wall obstacles are assembled for containment — `mutateFurniture` in the route, `MoveDragSession` (L334), `PlacementGhost`, `nudgeSelected` — append `stairVoidObstacles(floorBelow, storeyHeightOf(floorBelow))` when a floor below exists. Centralize: new route-level `activeObstaclesRef` built once per building/active-floor change and threaded as a prop where each site currently calls `edgeWallObstacles` itself (canvas passes it down; move-drag takes it as an optional extra array).
- Overlap warnings: stairs are not furniture — no change needed (`overlappingFurnitureIds` never sees them).

- [ ] **Step 5: Suite + build; verify headless**

Two-storey seed: (1) stairs card enabled on G, drag to a clear spot → blue ghost with guides, drop → localStorage ground floor has one stair; (2) 3D screenshot: treads climb to the slab, void visible in the slab + Floor-2 platform (switch to Floor 2, look down the well); (3) drag the card over the party wall → red ghost, release → **no** stair added; (4) on Floor 2 the stairs card is disabled with the hint (it's the top floor); (5) Floor 2 furniture drag refuses to cross the void (chair stops at its edge); (6) 2D on G shows treads + UP, 2D on Floor 2 shows the dashed void + DN; (7) single ⌘Z removes the stair; (8) zero page errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/model/catalog.ts src/lib/model/catalog.test.ts \
  src/components/objects-panel.tsx src/components/objects-panel.test.tsx \
  src/components/stair-ghost.tsx src/components/stair-mesh.tsx src/components/plan-stairs.tsx \
  src/components/planner-canvas.tsx src/components/room-scene.tsx src/components/plan-scene.tsx \
  src/components/move-drag.tsx src/routes/index.tsx
git commit -m "V7: stairs — catalog card, validity ghost, treads, derived voids"
```

---

### Task V8: Stair selection & editing, keyboard, final sweep

**Files:**
- Modify: `src/routes/index.tsx`, `src/components/planner-canvas.tsx`, `src/components/room-scene.tsx` (`stair-mesh` pick), `src/components/plan-stairs.tsx` (pick), `src/components/inspector.tsx` (+ test), `src/components/rotate-handle.tsx`, `PROGRESS.md`

**Interfaces:**
- Consumes: `updateStair`, `removeStair`, `stairValid`, `stairRun` (V2); `floorOfStair` (V1).
- Produces:
  - Route: fourth selection state `const [selectedStairId, setSelectedStairId] = useState<string | null>(null)` — mutually exclusive with the other three (extend the canvas's `selectItem`/`selectOpening`/`selectWall` trio with `selectStair`; `onPointerMissed` clears all four).
  - `PlannerCanvasProps` gains `selectedStairId: string | null; onSelectedStairIdChange: (id: string | null) => void`.
  - Inspector gains `selectedStair?: { stair: Stair; run: number; rises: string } | null` + `onStairResize: (width: number) => void; onStairRotateTo: (deg: number) => void; onStairMoveTo: (position: Point) => void; onStairDelete: () => void`.
  - `RotateHandle`'s `item` prop generalizes to `{ position: Point; rotation: number; footprint: Footprint }` (it never reads other `FurnitureItem` fields — mount/drag gating stays at the call sites).

- [ ] **Step 1: Failing inspector test** — `selectedStair` renders a STAIR section: WIDTH/ROTATE/POS X/POS Y fields, the read-only rises line (e.g. "Rises Ground floor → Floor 2 · 3.75 m run"), a Delete button; committing WIDTH calls `onStairResize(1.2)`.

- [ ] **Step 2: Run, fail; implement the inspector section** (mirror `WallSection`'s structure; `Field` primitives; Delete = red ghost button like the furniture ARRANGE delete).

- [ ] **Step 3: Selection + edits**

- Picks: `StairMesh` gets a pick mesh (`onClick` with `event.delta > CLICK_SLOP_PX` guard + `stopPropagation` → `onSelectStair(stair.id)`); selected = existing inverted-hull rim pattern at 2 cm. `PlanStairs variant="up"` footprint becomes pickable the same way (flat mesh at `FILL_Y`); selected outline tints `var(--blue)`. Lower-floor stairs pickable too (owner resolution below).
- Route edit handlers resolve the owner: `const owner = floorOfStair(buildingRef.current, selectedStairId)`. Each edit builds the patched stair, checks `stairValid(building-with-patch…)` — invalid → **no-op** (field snaps back, same UX as a rejected resize); valid → `commitFloor(owner.id, (f) => updateStair(f, id, patch))`.
- Rotate handle in 2D: render for a selected stair (generalized `item` prop; `outline` = owning room's outline or `[]`; `wallObstacles` = the owner floor's). `onRotate` maps to the stair patch path (rotation + position from the update).
- Keyboard (new effect, guarded like the furniture one): arrows nudge the stair by `PLACEMENT_GRID`/`FINE_NUDGE_STEP` (validity-checked per step, previews via `previewHistory`, settle on keyup), `r` rotates +90, Delete/Backspace removes, Esc deselects.
- Esc/empty-click/lens-switch/reload behavior verified same as the wall selection kind.

- [ ] **Step 4: Suite + build; final headless sweep (the phase gate)**

Full-run script: (1) fresh v6 seed migrates + renders identically; (2) add floor, draw a Floor-2 room snapping to the underlay at exact coords; (3) place a stair on G, stacked-3D screenshot with the void; (4) select the stair in 2D → STAIR section, WIDTH 1.2 commits, invalid POS X (into the wall) snaps back; (5) rotate handle detents at 90°; (6) keyboard: nudge burst = one undo step, `r`, Delete + ⌘Z restore; (7) floor switch slices the 3D stack; (8) v7 reload hydrates everything (floors, names, stair); (9) zero page errors. Then `pnpm check && pnpm test`.

- [ ] **Step 5: Update PROGRESS.md + commit**

Check off the Phase 10 tasks; compact per-task notes into the phase section (History entry dated, per house style).

```bash
git add src/routes/index.tsx src/components/planner-canvas.tsx src/components/room-scene.tsx \
  src/components/plan-stairs.tsx src/components/stair-mesh.tsx src/components/inspector.tsx \
  src/components/inspector.test.tsx src/components/rotate-handle.tsx PROGRESS.md
git commit -m "V8: stair selection/editing + keyboard; Phase 10 verified end-to-end"
```

---

## Deliberate deferrals (from the spec — do not build)

L/U-shaped stairs, handrails; basements; roofs; manual void tool / double-height rooms; cross-floor furniture drags; floor reordering/duplication; per-floor PNG export batching; cantilevered-slab underside polish; 3D opening-drag on non-active floors (V5 scopes it out — select + inspector-edit only).
