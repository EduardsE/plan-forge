# Window Pane Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-window pane grid — independent columns × rows (default 2×2, clamped 1–8) stored on the opening, edited from the inspector, rendered as muntin bars in the 3D frame.

**Architecture:** Two optional fields (`paneCols`/`paneRows`) on the stored `Opening`, absent meaning the default 2×2 (the codebase's "non-defaults only" convention). One pure setter in the model, carried through `WallHole` into a generalized `windowBars()` (moved from the component into `lib/room-scene.ts` so it's unit-testable), plus a PANES section in the inspector. No 2D changes, no storage-version bump.

**Tech Stack:** TypeScript, React 19, TanStack Start, Three.js/R3F, Vitest, Biome.

Spec: `docs/superpowers/specs/2026-07-24-window-pane-grid-design.md`

## Global Constraints

- Package manager is **pnpm**. Tests: `pnpm vitest run <file>`; full suite `pnpm test`.
- Biome enforces **tab indentation, double quotes**. Run `pnpm check` before every commit (`pnpm exec biome check --write src` fixes formatting).
- Constants (copied from the spec): `DEFAULT_PANE_COLS = 2`, `DEFAULT_PANE_ROWS = 2`, `MAX_PANE_DIVISIONS = 8`, min 1. Muntin bar thickness stays `0.06` m; frame border stays `WINDOW_FRAME_SIZE = 0.09` m.
- Model setters are pure `Floor → Floor`: same reference on no-op, defaults stored as **absent** fields, end in `reconcileFloor` (via the file-local `withOpenings` helper).
- Commit after each task (per project CLAUDE.md: commit on the current branch, only the task's files, don't push). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No `STORAGE_VERSION` bump in `src/lib/persistence.ts`.

---

### Task 1: Model — pane grid fields, resolver, setter

**Files:**
- Modify: `src/lib/model/types.ts` (Opening interface, ~line 66, after `sillMaterial`)
- Modify: `src/lib/model/openings.ts` (constants after line 32; resolver after `openingSill`; setter after `setOpeningSillMaterial`, ~line 302)
- Test: `src/lib/model/openings.test.ts`

**Interfaces:**
- Consumes: existing `Opening`, `Floor`, `withOpenings` (file-local, `openings.ts:316`).
- Produces (later tasks import these from `#/lib/model` — the barrel re-exports `./openings` and `./types`):
  - `Opening.paneCols?: number`, `Opening.paneRows?: number`
  - `DEFAULT_PANE_COLS: 2`, `DEFAULT_PANE_ROWS: 2`, `MAX_PANE_DIVISIONS: 8`
  - `openingPaneGrid(opening: Opening): { cols: number; rows: number }`
  - `setOpeningPaneGrid(floor: Floor, id: string, grid: { cols?: number; rows?: number }): Floor`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/model/openings.test.ts` (after the `"window sills"` describe). Add `openingPaneGrid` and `setOpeningPaneGrid` to the existing `import { ... } from "./openings"` block at the top (it already imports `setOpeningSillOverhang` etc.). The `makeFloor()` fixture (from `./test-fixtures`) has a window `"window-AB"` and a door `"door-BE"`.

```ts
describe("window pane grid", () => {
	it("resolves 2×2 defaults for an untouched window", () => {
		const floor = makeFloor();
		const window = floor.openings.find((o) => o.id === "window-AB");
		if (!window) throw new Error("fixture window missing");
		expect(openingPaneGrid(window)).toEqual({ cols: 2, rows: 2 });
	});

	it("stores a non-default grid, dropping fields back at the default", () => {
		const floor = setOpeningPaneGrid(makeFloor(), "window-AB", {
			cols: 4,
			rows: 3,
		});
		const window = floor.openings.find((o) => o.id === "window-AB");
		expect(window?.paneCols).toBe(4);
		expect(window?.paneRows).toBe(3);
		const back = setOpeningPaneGrid(floor, "window-AB", { cols: 2, rows: 2 });
		const reverted = back.openings.find((o) => o.id === "window-AB");
		expect(reverted?.paneCols).toBeUndefined();
		expect(reverted?.paneRows).toBeUndefined();
	});

	it("rounds and clamps into 1..MAX_PANE_DIVISIONS", () => {
		const wild = setOpeningPaneGrid(makeFloor(), "window-AB", {
			cols: 0,
			rows: 12,
		});
		const window = wild.openings.find((o) => o.id === "window-AB");
		expect(openingPaneGrid(window as Opening)).toEqual({ cols: 1, rows: 8 });
		const fraction = setOpeningPaneGrid(makeFloor(), "window-AB", {
			cols: 3.6,
		});
		expect(
			fraction.openings.find((o) => o.id === "window-AB")?.paneCols,
		).toBe(4);
	});

	it("leaves the unspecified axis untouched", () => {
		const floor = setOpeningPaneGrid(makeFloor(), "window-AB", { rows: 5 });
		const window = floor.openings.find((o) => o.id === "window-AB");
		expect(window?.paneCols).toBeUndefined();
		expect(window?.paneRows).toBe(5);
	});

	it("no-ops on doors, unknown ids, non-finite and same values", () => {
		const floor = makeFloor();
		expect(setOpeningPaneGrid(floor, "door-BE", { cols: 4 })).toBe(floor);
		expect(setOpeningPaneGrid(floor, "nope", { cols: 4 })).toBe(floor);
		expect(
			setOpeningPaneGrid(floor, "window-AB", { cols: Number.NaN }),
		).toBe(floor);
		expect(setOpeningPaneGrid(floor, "window-AB", {})).toBe(floor);
		expect(
			setOpeningPaneGrid(floor, "window-AB", { cols: 2, rows: 2 }),
		).toBe(floor);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/model/openings.test.ts`
Expected: FAIL — `openingPaneGrid` / `setOpeningPaneGrid` are not exported.

- [ ] **Step 3: Implement**

In `src/lib/model/types.ts`, inside `interface Opening`, after the `sillMaterial` member (line 66):

```ts
	/**
	 * Windows only: how many pane columns/rows the frame divides into.
	 * Absent means the default 2×2 (`DEFAULT_PANE_COLS`/`DEFAULT_PANE_ROWS`);
	 * effective values come from `openingPaneGrid` (model/openings.ts).
	 */
	paneCols?: number;
	paneRows?: number;
```

In `src/lib/model/openings.ts`, after the `MAX_SILL_OVERHANG` line (line 32):

```ts
/** Default pane grid of a window's frame (columns × rows). */
export const DEFAULT_PANE_COLS = 2;
export const DEFAULT_PANE_ROWS = 2;
/** Most pane columns or rows the setter allows. */
export const MAX_PANE_DIVISIONS = 8;
```

After `openingSill` (line 57):

```ts
/** Effective pane grid of a window's frame (defaults resolved). */
export function openingPaneGrid(opening: Opening): {
	cols: number;
	rows: number;
} {
	return {
		cols: opening.paneCols ?? DEFAULT_PANE_COLS,
		rows: opening.paneRows ?? DEFAULT_PANE_ROWS,
	};
}
```

After `setOpeningSillMaterial` (line 302):

```ts
/** Round a requested pane count to an integer in 1..MAX_PANE_DIVISIONS. */
function clampPaneCount(value: number): number {
	return Math.min(Math.max(Math.round(value), 1), MAX_PANE_DIVISIONS);
}

/**
 * Set a window frame's pane grid; either axis may be omitted to keep its
 * current value, and the 2×2 default stores as absent fields. Doors /
 * unknown ids / non-finite values no-op by reference.
 */
export function setOpeningPaneGrid(
	floor: Floor,
	id: string,
	grid: { cols?: number; rows?: number },
): Floor {
	const opening = floor.openings.find((o) => o.id === id);
	if (!opening || opening.kind !== "window") return floor;
	const current = openingPaneGrid(opening);
	const cols =
		grid.cols !== undefined && Number.isFinite(grid.cols)
			? clampPaneCount(grid.cols)
			: current.cols;
	const rows =
		grid.rows !== undefined && Number.isFinite(grid.rows)
			? clampPaneCount(grid.rows)
			: current.rows;
	if (cols === current.cols && rows === current.rows) return floor;
	return withOpenings(
		floor,
		floor.openings.map((o) => {
			if (o.id !== id) return o;
			const next = { ...o };
			if (cols === DEFAULT_PANE_COLS) delete next.paneCols;
			else next.paneCols = cols;
			if (rows === DEFAULT_PANE_ROWS) delete next.paneRows;
			else next.paneRows = rows;
			return next;
		}),
	);
}
```

No barrel change needed: `src/lib/model/index.ts` already has `export * from "./openings"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/model/openings.test.ts`
Expected: PASS (all describes, including the pre-existing ones).

- [ ] **Step 5: Check and commit**

```bash
pnpm check
git add src/lib/model/types.ts src/lib/model/openings.ts src/lib/model/openings.test.ts
git commit -m "Window openings carry an optional pane grid (cols × rows)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Persistence — validate the pane fields

**Files:**
- Modify: `src/lib/persistence.ts` (`areOpenings`, lines 124–174; the model import near the top of the file that already brings in `MAX_SILL_OVERHANG`)
- Test: `src/lib/persistence.test.ts` (extend the `"wall thickness + sill persistence"` describe, lines 344–406)

**Interfaces:**
- Consumes: `MAX_PANE_DIVISIONS`, `setOpeningPaneGrid` from `#/lib/model` (Task 1).
- Produces: saved states with `paneCols`/`paneRows` on windows round-trip; invalid values (non-integer, out of 1..8, or on a door) reject the whole save. No version bump — absent fields mean 2×2, old saves load unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/lib/persistence.test.ts`, add `setOpeningPaneGrid` to the existing `#/lib/model` import block, then add inside the `"wall thickness + sill persistence"` describe (it already provides the `save` helper at line 345 and the `tamper` helper inside the second `it`; add these two new `it` blocks after `"rejects out-of-range or wrong-kind values"`). Note `openings[0]` in `makeFloor()` is the door `"door-BE"`, `openings[1]` is the window `"window-AB"`.

```ts
	it("round-trips a window's pane grid", () => {
		let floor = reconcileFloor(makeFloor());
		floor = setOpeningPaneGrid(floor, "window-AB", { cols: 4, rows: 3 });
		const restored = deserializeSavedState(save(floor));
		const window = restored?.building.floors[0].openings.find(
			(o) => o.id === "window-AB",
		);
		expect(window?.paneCols).toBe(4);
		expect(window?.paneRows).toBe(3);
	});

	it("rejects pane fields on doors and out-of-range or fractional counts", () => {
		const base = reconcileFloor(makeFloor());
		const tamper = (
			mutate: (parsed: Record<string, unknown>) => void,
		): string => {
			const parsed = JSON.parse(save(base)) as Record<string, unknown>;
			mutate(parsed);
			return JSON.stringify(parsed);
		};
		const tamperOpening = (index: number, patch: Record<string, unknown>) =>
			tamper((p) => {
				const floor = floorAt(p);
				const openings = floor.openings as Record<string, unknown>[];
				openings[index] = { ...openings[index], ...patch };
			});
		expect(
			deserializeSavedState(tamperOpening(0, { paneCols: 3 })),
		).toBeNull();
		expect(
			deserializeSavedState(tamperOpening(1, { paneCols: 9 })),
		).toBeNull();
		expect(
			deserializeSavedState(tamperOpening(1, { paneRows: 0 })),
		).toBeNull();
		expect(
			deserializeSavedState(tamperOpening(1, { paneRows: 2.5 })),
		).toBeNull();
		expect(
			deserializeSavedState(tamperOpening(1, { paneCols: 4, paneRows: 4 })),
		).not.toBeNull();
	});
```

(`floorAt` is the file's existing helper used by the sibling rejection test at line 381.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/persistence.test.ts`
Expected: FAIL — the rejection assertions get non-null results (validator currently ignores unknown fields... if instead it already rejects unknown fields, the round-trip test fails). Either way at least one new test fails.

- [ ] **Step 3: Implement**

In `src/lib/persistence.ts`, add `MAX_PANE_DIVISIONS` to the model import that already contains `MAX_SILL_OVERHANG`. Then in `areOpenings`, after the `sillMaterial` check (line 164–170) and before `ids.add(o.id)`:

```ts
		// Optional pane grid: integer columns/rows, windows only.
		const isPaneCount = (v: unknown): boolean =>
			typeof v === "number" &&
			Number.isInteger(v) &&
			v >= 1 &&
			v <= MAX_PANE_DIVISIONS;
		if (
			o.paneCols !== undefined &&
			(o.kind !== "window" || !isPaneCount(o.paneCols))
		) {
			return false;
		}
		if (
			o.paneRows !== undefined &&
			(o.kind !== "window" || !isPaneCount(o.paneRows))
		) {
			return false;
		}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm check
git add src/lib/persistence.ts src/lib/persistence.test.ts
git commit -m "Persist and validate window pane grid fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Geometry — carry the grid into WallHole and generalize windowBars

**Files:**
- Modify: `src/lib/room-scene.ts` (`WallHole` interface lines 93–116; `cutHole` lines 183–209; new exported `windowBars` + `WINDOW_FRAME_SIZE` near `windowUnitDepth`/`sillBox`, ~line 325–383; extend the `#/lib/model` import)
- Modify: `src/components/room-scene.tsx` (delete local `windowBars` lines 502–532 and `const WINDOW_FRAME_SIZE = 0.09;` line 106; import both from `#/lib/room-scene` in the existing import block at lines 61–76)
- Test: `src/lib/room-scene.test.ts`

**Interfaces:**
- Consumes: `openingPaneGrid`, `DEFAULT_PANE_COLS`, `DEFAULT_PANE_ROWS` from `#/lib/model` (Task 1); existing `windowUnitDepth(solid)`.
- Produces:
  - `WallHole.paneCols?: number`, `WallHole.paneRows?: number` (windows only, resolved — always present on window holes built by `cutHole`)
  - `export const WINDOW_FRAME_SIZE = 0.09` from `#/lib/room-scene` (moved, value unchanged)
  - `export function windowBars(solid: WallSolid, hole: WallHole): Array<[string, number, number, number, number, number]>` — `[key, x, y, width, height, depth]`, wall-local; 4 frame bars + `cols−1` vertical + `rows−1` horizontal muntins.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/room-scene.test.ts`. Add `setOpeningPaneGrid` to the `#/lib/model` import block and `WINDOW_FRAME_SIZE`, `windowBars` to the `./room-scene` import block. The file already defines `solidsOf` (line 30) and a `WallSolid`-literal helper pattern (the `solid()` helper inside the `stubSpans` describe at line 155 — reuse its shape as below).

```ts
describe("windowBars", () => {
	const solid: WallSolid = {
		index: 0,
		edgeId: "e",
		start: { x: 0, y: 0 },
		dir: { x: 1, y: 0 },
		outward: { x: 0, y: -1 },
		length: 5.2,
		height: WALL_HEIGHT,
		thickness: WALL_THICKNESS,
		outwardShift: 0,
		outwardSign: 1,
		holes: [],
		faces: 1,
		faceSides: [1],
	};
	const win = (
		over: Partial<WallSolid["holes"][number]> = {},
	): WallSolid["holes"][number] => ({
		id: "w",
		kind: "window" as const,
		start: 1,
		width: 1.6,
		bottom: WINDOW_SILL,
		top: WINDOW_HEAD,
		side: 1 as const,
		...over,
	});
	const keys = (hole: WallSolid["holes"][number]) =>
		windowBars(solid, hole).map(([key]) => key);

	it("defaults to the 2×2 cross: frame plus one muntin each way", () => {
		expect(keys(win())).toEqual([
			"sill",
			"head",
			"jamb-l",
			"jamb-r",
			"muntin-v1",
			"muntin-h1",
		]);
		const bars = windowBars(solid, win());
		const v = bars.find(([key]) => key === "muntin-v1");
		const h = bars.find(([key]) => key === "muntin-h1");
		// The single muntins sit at the hole center, exactly the old cross.
		expect(v?.[1]).toBeCloseTo(1 + 1.6 / 2);
		expect(h?.[2]).toBeCloseTo((WINDOW_SILL + WINDOW_HEAD) / 2);
	});

	it("emits cols−1 vertical and rows−1 horizontal muntins, evenly spaced", () => {
		const bars = windowBars(solid, win({ paneCols: 4, paneRows: 3 }));
		const verticals = bars.filter(([key]) => key.startsWith("muntin-v"));
		const horizontals = bars.filter(([key]) => key.startsWith("muntin-h"));
		expect(verticals).toHaveLength(3);
		expect(horizontals).toHaveLength(2);
		const inner = 1.6 - 2 * WINDOW_FRAME_SIZE;
		verticals.forEach((bar, i) => {
			expect(bar[1]).toBeCloseTo(
				1 + WINDOW_FRAME_SIZE + (inner * (i + 1)) / 4,
			);
		});
	});

	it("renders 1×1 as a bare frame", () => {
		expect(keys(win({ paneCols: 1, paneRows: 1 }))).toEqual([
			"sill",
			"head",
			"jamb-l",
			"jamb-r",
		]);
	});
});

describe("pane grid flows into wall holes", () => {
	it("cutHole resolves the grid for windows and skips doors", () => {
		const floor = setOpeningPaneGrid(makeFloor(), "window-AB", {
			cols: 4,
			rows: 4,
		});
		const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
		const hole = ab?.holes.find((h) => h.id === "window-AB");
		expect(hole?.paneCols).toBe(4);
		expect(hole?.paneRows).toBe(4);
		const be = solidsOf(floor).find((s) => s.edgeId === "BE");
		const door = be?.holes.find((h) => h.id === "door-BE");
		expect(door?.paneCols).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: FAIL — `windowBars` / `WINDOW_FRAME_SIZE` are not exported from `./room-scene`.

- [ ] **Step 3: Implement the lib side**

In `src/lib/room-scene.ts`:

1. Add `openingPaneGrid`, `DEFAULT_PANE_COLS`, `DEFAULT_PANE_ROWS` to the `#/lib/model` import block (lines 3–16).

2. In `interface WallHole` after `sillMaterial` (line 115):

```ts
	/** Windows only: resolved pane columns of the frame grid. */
	paneCols?: number;
	/** Windows only: resolved pane rows of the frame grid. */
	paneRows?: number;
```

3. In `cutHole` (lines 183–209), next to the existing `sill` resolution:

```ts
	const sill = opening.kind === "window" ? openingSill(opening) : null;
	const grid = opening.kind === "window" ? openingPaneGrid(opening) : null;
	holes.push({
		id: opening.id,
		kind: opening.kind,
		start,
		width: end - start,
		bottom,
		top,
		...(opening.hinge ? { hinge: opening.hinge } : {}),
		side: opening.side,
		...(sill
			? { sillOverhang: sill.overhang, sillMaterial: sill.material }
			: {}),
		...(grid ? { paneCols: grid.cols, paneRows: grid.rows } : {}),
	});
```

4. After `windowUnitZ` (line 341), add the moved constant and the generalized bar layout (docstring carried over from the component):

```ts
/** Border frame bar size of a window unit, meters. */
export const WINDOW_FRAME_SIZE = 0.09;
/** Muntin (pane divider) bar thickness, meters. */
const MUNTIN_SIZE = 0.06;

/** The frame/muntin bar layout of one window hole (wall-local): [key, x, y,
 * width, height, depth]. Shared by the visible dressing and the shadow
 * proxy, so the muntin grid in the sun patch matches the drawn frame. The
 * hole's resolved pane grid decides the muntins: cols−1 vertical and
 * rows−1 horizontal bars, evenly spaced inside the border frame. */
export function windowBars(
	solid: WallSolid,
	hole: WallHole,
): Array<[string, number, number, number, number, number]> {
	const f = WINDOW_FRAME_SIZE;
	const cx = hole.start + hole.width / 2;
	const cy = (hole.bottom + hole.top) / 2;
	const height = hole.top - hole.bottom;
	const unit = windowUnitDepth(solid);
	const frameDepth = unit + 0.02;
	// Frame bars sit inside the hole, border-box style; the muntins stay
	// within the unit's depth.
	const bars: Array<[string, number, number, number, number, number]> = [
		["sill", cx, hole.bottom + f / 2, hole.width, f, frameDepth],
		["head", cx, hole.top - f / 2, hole.width, f, frameDepth],
		["jamb-l", hole.start + f / 2, cy, f, height - 2 * f, frameDepth],
		[
			"jamb-r",
			hole.start + hole.width - f / 2,
			cy,
			f,
			height - 2 * f,
			frameDepth,
		],
	];
	const cols = hole.paneCols ?? DEFAULT_PANE_COLS;
	const rows = hole.paneRows ?? DEFAULT_PANE_ROWS;
	const innerWidth = hole.width - 2 * f;
	const innerHeight = height - 2 * f;
	for (let i = 1; i < cols; i++) {
		const x = hole.start + f + (innerWidth * i) / cols;
		bars.push([`muntin-v${i}`, x, cy, MUNTIN_SIZE, innerHeight, unit]);
	}
	for (let j = 1; j < rows; j++) {
		const y = hole.bottom + f + (innerHeight * j) / rows;
		bars.push([`muntin-h${j}`, cx, y, innerWidth, MUNTIN_SIZE, unit]);
	}
	return bars;
}
```

(For the default 2×2 this reproduces the old cross exactly: one vertical at `start + f + innerWidth/2 = cx`, one horizontal at `cy`, same sizes.)

- [ ] **Step 4: Update the component to consume the moved function**

In `src/components/room-scene.tsx`:

1. Delete the local `windowBars` function (lines 502–532, including its docstring) and the `const WINDOW_FRAME_SIZE = 0.09;` line (106).
2. Add `WINDOW_FRAME_SIZE` and `windowBars` to the existing `#/lib/room-scene` import block (lines 61–76, alphabetical position: `WINDOW_FRAME_SIZE` after `WallSolid`, `windowBars` before `windowUnitDepth`).

No other component change: `WindowDressing` (line 563) and the shadow proxy in `WallMesh` (line 712) already call `windowBars(solid, hole)`, and both keep working since the signature is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm check
git add src/lib/room-scene.ts src/lib/room-scene.test.ts src/components/room-scene.tsx
git commit -m "Window frames render their pane grid, not a fixed 2×2 cross

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Inspector PANES section and route wiring

**Files:**
- Modify: `src/components/inspector.tsx` (imports line 5–20; `OpeningSectionProps` line 391; `OpeningSection` body — new section between TRANSFORM and SILL, ~line 509; `Inspector` props ~line 858, defaults ~line 899, pass-through ~line 1004)
- Modify: `src/routes/index.tsx` (model import block ~line 92; new callback after `setSelectedOpeningSillMaterial` ~line 603; prop at ~line 1690)
- Test: `src/components/inspector.test.tsx`

**Interfaces:**
- Consumes: `openingPaneGrid`, `setOpeningPaneGrid` from `#/lib/model` (Task 1); existing `Field`, `SectionLabel`, `OpeningSelection`, `commitFloor`, `floorOfOpening`, `buildingRef`, `selectedOpeningId` (all already in the touched files).
- Produces: `Inspector` prop `onOpeningPaneGrid?: (grid: { cols?: number; rows?: number }) => void`; `OpeningSection` prop `onPaneGrid` with the same signature. Field aria-labels: `"Pane columns"`, `"Pane rows"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/inspector.test.tsx` (top-level describe, following the file's `renderInspector` pattern). Add `Opening` alongside the existing `#/lib/model` type imports if needed for the fixture typing:

```tsx
describe("opening pane grid", () => {
	const windowSelection = {
		opening: {
			id: "w1",
			kind: "window" as const,
			edgeId: "AB",
			offset: 1,
			width: 1.2,
			side: 1 as const,
		},
		bottom: 0.36,
		top: 1.94,
		ceiling: 2.5,
		connects: null,
		twoFace: false,
		sillOverhang: 0.03,
		sillMaterial: "white" as const,
	};

	it("shows 2×2 defaults and commits a columns edit", () => {
		const onOpeningPaneGrid = vi.fn();
		renderInspector({ selectedOpening: windowSelection, onOpeningPaneGrid });
		const cols = screen.getByLabelText("Pane columns") as HTMLInputElement;
		expect(cols.value).toBe("2");
		expect(
			(screen.getByLabelText("Pane rows") as HTMLInputElement).value,
		).toBe("2");
		fireEvent.change(cols, { target: { value: "4" } });
		fireEvent.blur(cols);
		expect(onOpeningPaneGrid).toHaveBeenCalledWith({ cols: 4 });
	});

	it("drops invalid input without committing", () => {
		const onOpeningPaneGrid = vi.fn();
		renderInspector({ selectedOpening: windowSelection, onOpeningPaneGrid });
		const rows = screen.getByLabelText("Pane rows") as HTMLInputElement;
		fireEvent.change(rows, { target: { value: "lots" } });
		fireEvent.blur(rows);
		expect(onOpeningPaneGrid).not.toHaveBeenCalled();
		expect(rows.value).toBe("2");
	});

	it("hides the PANES section for doors", () => {
		renderInspector({
			selectedOpening: {
				...windowSelection,
				opening: {
					...windowSelection.opening,
					kind: "door" as const,
					hinge: "start" as const,
				},
			},
		});
		expect(screen.queryByText("PANES")).toBeNull();
		expect(screen.queryByLabelText("Pane columns")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/inspector.test.tsx`
Expected: FAIL — no element with aria-label "Pane columns".

- [ ] **Step 3: Implement the inspector side**

In `src/components/inspector.tsx`:

1. Add `openingPaneGrid` to the `#/lib/model` import block (lines 5–20).

2. In `interface OpeningSectionProps` (line 391), after `onSillMaterial`:

```ts
	/** A committed pane grid edit (windows only); omitted axes keep theirs. */
	onPaneGrid: (grid: { cols?: number; rows?: number }) => void;
```

3. In `OpeningSection`, add `onPaneGrid` to the destructured props, and next to `commitLength` (line 426) add:

```ts
	const paneGrid = openingPaneGrid(opening);
	const commitCount =
		(apply: (count: number) => void, current: number) => (text: string) => {
			const count = Number.parseInt(text, 10);
			if (!Number.isFinite(count)) return;
			if (count === current) return;
			apply(count);
		};
```

4. Between the TRANSFORM `</div>` (line 509) and the SILL block (line 511), insert:

```tsx
			{!isDoor && (
				<div className="flex flex-col gap-2.5">
					<SectionLabel>PANES</SectionLabel>
					<div className="grid grid-cols-2 gap-2">
						<Field
							label="COLS"
							ariaLabel="Pane columns"
							suffix=""
							value={String(paneGrid.cols)}
							onCommit={commitCount(
								(cols) => onPaneGrid({ cols }),
								paneGrid.cols,
							)}
						/>
						<Field
							label="ROWS"
							ariaLabel="Pane rows"
							suffix=""
							value={String(paneGrid.rows)}
							onCommit={commitCount(
								(rows) => onPaneGrid({ rows }),
								paneGrid.rows,
							)}
						/>
					</div>
				</div>
			)}
```

(Clamping is the model's; a value the model clamps or drops re-seeds the field to canonical via the existing `Field` blur/effect machinery.)

5. In the `Inspector` component: add prop `onOpeningPaneGrid?: (grid: { cols?: number; rows?: number }) => void;` next to `onOpeningSillOverhang` (line 858), default `onOpeningPaneGrid = () => {},` next to the other defaults (line 899), and pass `onPaneGrid={onOpeningPaneGrid}` where `<OpeningSection>` is rendered (next to `onSillOverhang`, line 1004).

- [ ] **Step 4: Implement the route side**

In `src/routes/index.tsx`:

1. Add `setOpeningPaneGrid` to the `#/lib/model` import block (alphabetically near `setOpeningSillMaterial`, line 92).

2. After `setSelectedOpeningSillMaterial` (line 603):

```ts
	const setSelectedOpeningPaneGrid = useCallback(
		(grid: { cols?: number; rows?: number }) => {
			if (!selectedOpeningId) return;
			const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
			if (!owner) return;
			commitFloor(owner.id, (floor) =>
				setOpeningPaneGrid(floor, selectedOpeningId, grid),
			);
		},
		[selectedOpeningId, commitFloor],
	);
```

3. Pass it to the inspector next to the sill props (line 1690):

```tsx
				onOpeningPaneGrid={setSelectedOpeningPaneGrid}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/inspector.test.tsx`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm check
git add src/components/inspector.tsx src/routes/index.tsx src/components/inspector.test.tsx
git commit -m "Inspector PANES section edits a window's pane grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite and in-app verification

**Files:**
- No source changes expected. A throwaway Playwright script goes in the session scratchpad, not the repo.

**Interfaces:**
- Consumes: everything above; the project's `verify` skill (invoke `Skill: verify` — it documents how to launch PlanForge headless, seed state, and drive the canvas with real mouse input).

- [ ] **Step 1: Run the full test suite and lints**

Run: `pnpm test`
Expected: all files PASS.

Run: `pnpm check`
Expected: no errors.

- [ ] **Step 2: Headless browser verification**

Invoke the project's `verify` skill and follow it to write a headless script (`chromium.launch({ headless: true, channel: "chrome" })`, per CLAUDE.md — do not use the headed Playwright MCP browser). The flow to drive:

1. Launch the app, wait for the 3D scene.
2. Click a window in the 3D view to select it (the seed apartment has several; the inspector should show "Window" with the PANES section reading COLS 2, ROWS 2).
3. Fill the "Pane columns" input with `4`, press Enter; same for "Pane rows".
4. Screenshot the 3D view — the selected window must show a 4×4 muntin grid; neighboring windows keep the 2×2 cross.
5. Set COLS and ROWS to `1`, screenshot — bare frame, no muntins.
6. Reload the page — the 4×4/1×1 setting must survive (localStorage autosave), confirming persistence end-to-end.
7. Press the undo shortcut (Cmd+Z) twice after a fresh edit to confirm each commit is one undo step (inspector values step back one at a time).

Expected: screenshots visually confirm the grids; reload keeps the setting; undo steps one field-commit at a time.

- [ ] **Step 3: Report**

No commit here unless verification exposed a fix. Summarize results (test counts, screenshot findings) and hand off per superpowers:finishing-a-development-branch.
