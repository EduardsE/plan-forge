# Windowsills & Per-Wall Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every window gets an automatic windowsill (flush-recessed or overhanging-shelf, driven by one overhang field), and walls gain an optional per-edge thickness that grows outward on exterior walls — making the recessed look possible.

**Architecture:** The spec is `docs/superpowers/specs/2026-07-18-windowsills-wall-depth-design.md`. Thickness lives on `WallEdge` (sparse), sill fields on `Opening` (sparse). All effective-geometry resolution happens in `buildEdgeSolids` (`src/lib/room-scene.ts`), which gains `thickness`/`outwardShift`/`outwardSign` per solid — room interiors, furniture collision, and wall-mount math are untouched because interior faces never move. A third selection kind (wall) joins furniture and openings, with a new inspector section.

**Tech Stack:** TypeScript, React 19, react-three-fiber/drei, three.js, Vitest, Biome (tabs, double quotes), pnpm.

## Global Constraints

- All lengths in meters; sparse model fields (a default value is stored as an *absent* field).
- Every model setter is pure `Floor → Floor`, returns the **same reference** on a no-op, and ends in `reconcileFloor`.
- Thickness clamp: **0.05–0.60 m**; default `WALL_THICKNESS = 0.1`.
- Sill overhang clamp: **0–0.40 m**, default **0.03**; sill material `"white" | "wood"`, default `"white"`; sill board 0.04 m thick with 0.04 m ears.
- Effective thickness: edges with ≤ 1 room face use `thickness ?? WALL_THICKNESS`; edges with 2 faces always use `WALL_THICKNESS` (override goes dormant, never deleted).
- Exterior (1-face) walls grow **outward** — the interior face stays 5 cm off the centerline. Dangling (0-face) edges grow symmetrically.
- Run `pnpm check` before every commit; `pnpm vitest run <file>` for a single test file.
- Commit after each task (locally, current branch, only the task's files).
- Plan coordinates: x right, y down; in a wall's 3D local frame (rotation-y = `atan2(-dir.y, dir.x)`), local +z maps to `leftNormal(dir) = (-dir.y, dir.x)`.

## Sign conventions used throughout (read this first)

`WallSolid.outward` is a unit plan normal. New field `outwardSign` is +1 when `outward` equals `leftNormal(dir)`, −1 when it equals `rightNormal(dir)`. Therefore in the 3D wall-local frame, a leftNormal-coordinate `c` renders at local z = `c`, and an outward-coordinate `o` (what `wallPoint` in `lib/plan-scene.ts` takes) satisfies `c = outwardSign * o`. `WallHole.side` is leftNormal-signed (side +1 = the leftNormal side), which is why the door-swing code uses `hole.side === 1 ? leftNormal : rightNormal`.

---

### Task 1: Model — per-edge thickness field + `setEdgeThickness`

**Files:**
- Modify: `src/lib/model/graph.ts` (WallEdge type at line 22, `splitEdgeAt` at line 156)
- Create: `src/lib/model/walls.ts`
- Modify: `src/lib/model/index.ts`
- Modify: `src/lib/graph-edit.ts` (`deleteNode`'s merged edge at line 244)
- Test: `src/lib/model/walls.test.ts`

**Interfaces:**
- Consumes: `reconcileFloor`, `WALL_THICKNESS` (existing).
- Produces: `WallEdge.thickness?: number`; `MIN_WALL_THICKNESS = 0.05`; `MAX_WALL_THICKNESS = 0.6`; `setEdgeThickness(floor: Floor, edgeId: string, thickness: number): Floor`. All exported from `#/lib/model`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/model/walls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitEdgeAt } from "#/lib/graph-edit";
import { WALL_THICKNESS } from "./geometry";
import { makeFloor } from "./test-fixtures";
import { MAX_WALL_THICKNESS, MIN_WALL_THICKNESS, setEdgeThickness } from "./walls";

describe("setEdgeThickness", () => {
	it("stores a clamped thickness on the edge", () => {
		const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
		expect(floor.edges.find((e) => e.id === "AB")?.thickness).toBe(0.3);
	});

	it("clamps into [MIN, MAX]", () => {
		const thin = setEdgeThickness(makeFloor(), "AB", 0.001);
		expect(thin.edges.find((e) => e.id === "AB")?.thickness).toBe(
			MIN_WALL_THICKNESS,
		);
		const thick = setEdgeThickness(makeFloor(), "AB", 5);
		expect(thick.edges.find((e) => e.id === "AB")?.thickness).toBe(
			MAX_WALL_THICKNESS,
		);
	});

	it("stores the default as an absent field", () => {
		const floor = setEdgeThickness(
			setEdgeThickness(makeFloor(), "AB", 0.3),
			"AB",
			WALL_THICKNESS,
		);
		expect(floor.edges.find((e) => e.id === "AB")?.thickness).toBeUndefined();
	});

	it("no-ops by reference on unknown ids and non-finite values", () => {
		const floor = makeFloor();
		expect(setEdgeThickness(floor, "nope", 0.3)).toBe(floor);
		expect(setEdgeThickness(floor, "AB", Number.NaN)).toBe(floor);
		expect(setEdgeThickness(floor, "AB", WALL_THICKNESS)).toBe(floor);
	});

	it("survives an edge split (both halves inherit the thickness)", () => {
		const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
		const split = splitEdgeAt(floor, "AB", { x: 3.2, y: -0.05 });
		expect(split).not.toBe(floor);
		// AB (A(-0.05,-0.05) → B(6.4,-0.05)) is replaced by two new edges
		// spanning the same nodes through the split node; both carry 0.3.
		const halves = split.edges.filter(
			(e) => e.thickness !== undefined,
		);
		expect(halves).toHaveLength(2);
		expect(halves.every((e) => e.thickness === 0.3)).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/model/walls.test.ts`
Expected: FAIL — `walls.ts` does not exist / `thickness` not a known property.

- [ ] **Step 3: Add the field, the setter, and the split/merge carry-through**

In `src/lib/model/graph.ts`, extend `WallEdge` (line 22):

```ts
/** A wall run between two nodes. */
export interface WallEdge {
	id: string;
	a: string;
	b: string;
	/**
	 * Optional per-wall thickness override, meters (clamped by
	 * `setEdgeThickness`). Effective only while the edge borders at most one
	 * room face — on a shared wall it goes dormant (the wall renders at
	 * WALL_THICKNESS) and revives if the wall becomes exterior again.
	 */
	thickness?: number;
}
```

In the same file, make `splitEdgeAt`'s pieces (lines 165–166) inherit it:

```ts
	const carry =
		edge.thickness !== undefined ? { thickness: edge.thickness } : {};
	const pieceA: WallEdge = { id: newId(), a: edge.a, b: splitNodeId, ...carry };
	const pieceB: WallEdge = { id: newId(), a: splitNodeId, b: edge.b, ...carry };
```

In `src/lib/graph-edit.ts`, `deleteNode`'s degree-2 merge (line 244) — the merged edge keeps a thickness only when both halves agree:

```ts
			const merged: WallEdge = {
				id: mergedId,
				a: xId,
				b: yId,
				...(e1.thickness !== undefined && e1.thickness === e2.thickness
					? { thickness: e1.thickness }
					: {}),
			};
```

Create `src/lib/model/walls.ts`:

```ts
import { reconcileFloor } from "./derived";
import { WALL_THICKNESS } from "./geometry";
import type { Floor } from "./types";

/**
 * Pure wall-edge mutations. Thickness is a sparse per-edge override
 * (`WallEdge.thickness`): absent means the default `WALL_THICKNESS`, and the
 * override only takes effect while the edge borders at most one room face —
 * `buildEdgeSolids` (lib/room-scene.ts) resolves the effective value.
 */

export const MIN_WALL_THICKNESS = 0.05;
export const MAX_WALL_THICKNESS = 0.6;

const EPS = 1e-9;

/**
 * Set an edge's thickness override, clamped to
 * [MIN_WALL_THICKNESS, MAX_WALL_THICKNESS]. The default value is stored as an
 * absent field. Unknown ids / non-finite values / no-ops return the same
 * floor reference.
 */
export function setEdgeThickness(
	floor: Floor,
	edgeId: string,
	thickness: number,
): Floor {
	const edge = floor.edges.find((e) => e.id === edgeId);
	if (!edge || !Number.isFinite(thickness)) return floor;
	const clamped = Math.min(
		Math.max(thickness, MIN_WALL_THICKNESS),
		MAX_WALL_THICKNESS,
	);
	const isDefault = Math.abs(clamped - WALL_THICKNESS) < EPS;
	if (isDefault && edge.thickness === undefined) return floor;
	if (!isDefault && edge.thickness !== undefined) {
		if (Math.abs(clamped - edge.thickness) < EPS) return floor;
	}
	return reconcileFloor({
		...floor,
		edges: floor.edges.map((e) => {
			if (e.id !== edgeId) return e;
			if (isDefault) {
				const { thickness: _dropped, ...rest } = e;
				return rest;
			}
			return { ...e, thickness: clamped };
		}),
	});
}
```

Add to `src/lib/model/index.ts` (alphabetical position, after `./wall-mount`):

```ts
export * from "./walls";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/model/walls.test.ts`
Expected: PASS (5 tests). Also run the full suite once — `pnpm test` — to catch any `reconcileFloor` path that strips the field (the split test covers the known one).

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/lib/model/graph.ts src/lib/model/walls.ts src/lib/model/walls.test.ts src/lib/model/index.ts src/lib/graph-edit.ts
git commit -m "Per-edge wall thickness: sparse WallEdge.thickness + setEdgeThickness"
```

---

### Task 2: Model — sill fields on windows + setters

**Files:**
- Modify: `src/lib/model/types.ts` (Opening, after `head` at line 58)
- Modify: `src/lib/model/openings.ts`
- Test: `src/lib/model/openings.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `reconcileFloor`, existing openings module.
- Produces: `Opening.sillOverhang?: number`; `Opening.sillMaterial?: SillMaterial`; `type SillMaterial = "white" | "wood"`; `DEFAULT_SILL_OVERHANG = 0.03`; `MAX_SILL_OVERHANG = 0.4`; `openingSill(opening: Opening): { overhang: number; material: SillMaterial }`; `setOpeningSillOverhang(floor, id, overhang): Floor`; `setOpeningSillMaterial(floor, id, material): Floor`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/model/openings.test.ts`:

```ts
describe("window sills", () => {
	it("resolves defaults for an untouched window", () => {
		const floor = makeFloor();
		const window = floor.openings.find((o) => o.id === "window-AB");
		if (!window) throw new Error("fixture window missing");
		expect(openingSill(window)).toEqual({ overhang: 0.03, material: "white" });
	});

	it("stores a clamped overhang sparsely", () => {
		const floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0.18);
		const window = floor.openings.find((o) => o.id === "window-AB");
		expect(window?.sillOverhang).toBe(0.18);
		const back = setOpeningSillOverhang(floor, "window-AB", 0.03);
		expect(
			back.openings.find((o) => o.id === "window-AB")?.sillOverhang,
		).toBeUndefined();
		const wild = setOpeningSillOverhang(makeFloor(), "window-AB", 9);
		expect(wild.openings.find((o) => o.id === "window-AB")?.sillOverhang).toBe(
			0.4,
		);
	});

	it("stores material sparsely (white is the default)", () => {
		const floor = setOpeningSillMaterial(makeFloor(), "window-AB", "wood");
		expect(
			floor.openings.find((o) => o.id === "window-AB")?.sillMaterial,
		).toBe("wood");
		const back = setOpeningSillMaterial(floor, "window-AB", "white");
		expect(
			back.openings.find((o) => o.id === "window-AB")?.sillMaterial,
		).toBeUndefined();
	});

	it("no-ops on doors, unknown ids, and non-finite overhangs", () => {
		const floor = makeFloor();
		expect(setOpeningSillOverhang(floor, "door-BE", 0.2)).toBe(floor);
		expect(setOpeningSillMaterial(floor, "door-BE", "wood")).toBe(floor);
		expect(setOpeningSillOverhang(floor, "nope", 0.2)).toBe(floor);
		expect(setOpeningSillOverhang(floor, "window-AB", Number.NaN)).toBe(floor);
		expect(setOpeningSillOverhang(floor, "window-AB", 0.03)).toBe(floor);
	});
});
```

Add the needed imports to that file's existing import from `./openings`: `openingSill`, `setOpeningSillMaterial`, `setOpeningSillOverhang` (and `makeFloor` from `./test-fixtures` if not already imported).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/model/openings.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

In `src/lib/model/types.ts`, add to `Opening` after `head?: number;`:

```ts
	/**
	 * Windows only: how far the sill board protrudes past the interior wall
	 * face, meters. Absent means the default (`DEFAULT_SILL_OVERHANG`); 0 is
	 * the flush/recessed look.
	 */
	sillOverhang?: number;
	/** Windows only: sill board material. Absent means `"white"`. */
	sillMaterial?: "white" | "wood";
```

In `src/lib/model/openings.ts`, add near the top (after the existing constants):

```ts
export type SillMaterial = "white" | "wood";
/** Default sill protrusion past the interior wall face, meters. */
export const DEFAULT_SILL_OVERHANG = 0.03;
export const MAX_SILL_OVERHANG = 0.4;

/** Effective sill parameters of a window (defaults resolved). */
export function openingSill(opening: Opening): {
	overhang: number;
	material: SillMaterial;
} {
	return {
		overhang: opening.sillOverhang ?? DEFAULT_SILL_OVERHANG,
		material: opening.sillMaterial ?? "white",
	};
}

/**
 * Set a window's sill overhang, clamped to [0, MAX_SILL_OVERHANG]; the
 * default stores as an absent field. Doors / unknown ids / non-finite
 * values no-op by reference.
 */
export function setOpeningSillOverhang(
	floor: Floor,
	id: string,
	overhang: number,
): Floor {
	const opening = floor.openings.find((o) => o.id === id);
	if (!opening || opening.kind !== "window" || !Number.isFinite(overhang)) {
		return floor;
	}
	const clamped = Math.min(Math.max(overhang, 0), MAX_SILL_OVERHANG);
	const isDefault = Math.abs(clamped - DEFAULT_SILL_OVERHANG) < EPS;
	const current = opening.sillOverhang;
	if (isDefault && current === undefined) return floor;
	if (!isDefault && current !== undefined && Math.abs(clamped - current) < EPS) {
		return floor;
	}
	return withOpenings(
		floor,
		floor.openings.map((o) => {
			if (o.id !== id) return o;
			if (isDefault) {
				const { sillOverhang: _dropped, ...rest } = o;
				return rest;
			}
			return { ...o, sillOverhang: clamped };
		}),
	);
}

/** Set a window's sill material; `"white"` stores as an absent field. */
export function setOpeningSillMaterial(
	floor: Floor,
	id: string,
	material: SillMaterial,
): Floor {
	const opening = floor.openings.find((o) => o.id === id);
	if (!opening || opening.kind !== "window") return floor;
	if ((opening.sillMaterial ?? "white") === material) return floor;
	return withOpenings(
		floor,
		floor.openings.map((o) => {
			if (o.id !== id) return o;
			if (material === "white") {
				const { sillMaterial: _dropped, ...rest } = o;
				return rest;
			}
			return { ...o, sillMaterial: material };
		}),
	);
}
```

(`withOpenings` and `EPS` already exist in this module.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/model/openings.test.ts`
Expected: PASS.

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/lib/model/types.ts src/lib/model/openings.ts src/lib/model/openings.test.ts
git commit -m "Window sill model: sparse sillOverhang/sillMaterial + setters"
```

---

### Task 3: Persistence — validate the three new fields

**Files:**
- Modify: `src/lib/persistence.ts` (`areEdges` at line 73, `areOpenings` at line 102)
- Modify: `docs/superpowers/specs/2026-07-18-windowsills-wall-depth-design.md` (Part 5, one line)
- Test: `src/lib/persistence.test.ts` (append)

**Interfaces:**
- Consumes: `MIN_WALL_THICKNESS`, `MAX_WALL_THICKNESS`, `MAX_SILL_OVERHANG` from `#/lib/model`.
- Produces: v6 saves round-trip `edge.thickness`, `opening.sillOverhang`, `opening.sillMaterial`; malformed values reject the save (hydrate as "no save"), matching the module's existing all-or-nothing style. No version bump — the fields are additive/optional.

Note: the spec's Part 5 says invalid values are "dropped (field omitted)", but this module's existing style (see `sill`/`head` at lines 122–132) rejects the whole payload. Rejecting is what we implement; Step 3 amends the spec line to match.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/persistence.test.ts` (reusing its existing valid-state helper if one exists; otherwise build from `makeFloor()` + `reconcileFloor`, matching the file's current patterns):

```ts
describe("wall thickness + sill persistence", () => {
	const save = (floor: Floor): string =>
		serializeSavedState({ floor, unit: "m", savedAt: 1 });

	it("round-trips edge thickness and sill fields", () => {
		let floor = reconcileFloor(makeFloor());
		floor = setEdgeThickness(floor, "AB", 0.3);
		floor = setOpeningSillOverhang(floor, "window-AB", 0.18);
		floor = setOpeningSillMaterial(floor, "window-AB", "wood");
		const restored = deserializeSavedState(save(floor));
		expect(restored).not.toBeNull();
		expect(restored?.floor.edges.find((e) => e.id === "AB")?.thickness).toBe(
			0.3,
		);
		const window = restored?.floor.openings.find((o) => o.id === "window-AB");
		expect(window?.sillOverhang).toBe(0.18);
		expect(window?.sillMaterial).toBe("wood");
	});

	it("rejects out-of-range or wrong-kind values", () => {
		const base = reconcileFloor(makeFloor());
		const tamper = (mutate: (parsed: any) => void): string => {
			const parsed = JSON.parse(save(base));
			mutate(parsed);
			return JSON.stringify(parsed);
		};
		expect(
			deserializeSavedState(
				tamper((p) => {
					p.floor.edges[0].thickness = 3;
				}),
			),
		).toBeNull();
		expect(
			deserializeSavedState(
				tamper((p) => {
					p.floor.openings[0].sillOverhang = 0.1; // openings[0] is the door
				}),
			),
		).toBeNull();
		expect(
			deserializeSavedState(
				tamper((p) => {
					p.floor.openings[1].sillMaterial = "granite";
				}),
			),
		).toBeNull();
	});
});
```

Add imports as needed: `makeFloor` from `#/lib/model/test-fixtures`, `reconcileFloor`, `setEdgeThickness`, `setOpeningSillMaterial`, `setOpeningSillOverhang`, and `Floor` type from `#/lib/model`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/persistence.test.ts`
Expected: the round-trip test may already pass (extra JSON fields survive), but the reject cases FAIL (deserialize returns non-null).

- [ ] **Step 3: Implement validation + amend the spec line**

In `src/lib/persistence.ts`, import the clamps: add `MAX_SILL_OVERHANG, MAX_WALL_THICKNESS, MIN_WALL_THICKNESS` to the `#/lib/model` import. In `areEdges`, before `ids.add(edge.id);`:

```ts
		if (
			edge.thickness !== undefined &&
			(!isFiniteNumber(edge.thickness) ||
				edge.thickness < MIN_WALL_THICKNESS ||
				edge.thickness > MAX_WALL_THICKNESS)
		) {
			return false;
		}
```

In `areOpenings`, after the existing `head` check (line 129–132):

```ts
		if (
			o.sillOverhang !== undefined &&
			(o.kind !== "window" ||
				!isFiniteNumber(o.sillOverhang) ||
				o.sillOverhang < 0 ||
				o.sillOverhang > MAX_SILL_OVERHANG)
		) {
			return false;
		}
		if (
			o.sillMaterial !== undefined &&
			(o.kind !== "window" ||
				(o.sillMaterial !== "white" && o.sillMaterial !== "wood"))
		) {
			return false;
		}
```

In the spec's Part 5, replace the sentence "Non-finite / out-of-range / wrong-kind values are dropped (field omitted), matching existing validation style." with "Non-finite / out-of-range / wrong-kind values reject the save (hydrates as no-save), matching the module's existing all-or-nothing validation style."

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/lib/persistence.ts src/lib/persistence.test.ts docs/superpowers/specs/2026-07-18-windowsills-wall-depth-design.md
git commit -m "Persist per-edge thickness and window sill fields (v6, additive)"
```

---

### Task 4: Geometry — WallSolid thickness/outwardShift/outwardSign + helpers

**Files:**
- Modify: `src/lib/room-scene.ts`
- Test: `src/lib/room-scene.test.ts` (append)

**Interfaces:**
- Consumes: `WallEdge.thickness`, `openingSill` (Task 1–2).
- Produces on `WallSolid`: `thickness: number`, `outwardShift: number` (≥ 0, plan meters along `outward`), `outwardSign: 1 | -1`. On `WallHole` (windows): `sillOverhang: number`, `sillMaterial: SillMaterial` (resolved, not sparse). Helpers exported from `#/lib/room-scene`:
  - `wallBandRange(solid): { inner: number; outer: number }` — outward-coordinate extents of the body (`outwardShift ∓ thickness/2`), for `wallPoint`-based 2D code.
  - `faceOutwardOffset(solid, side: 1 | -1): number` — outward-coordinate of the face on leftNormal-signed `side` (`outwardShift + outwardSign * side * thickness/2`).
  - `wallZOffset(solid): number` — 3D local-z where the extrusion (0..thickness) starts (`outwardSign * outwardShift − thickness/2`).
  - `wallZCenter(solid): number` — 3D local-z of the body's mid-plane (`outwardSign * outwardShift`).
  - `windowUnitDepth(solid): number` — `min(WALL_THICKNESS, thickness)`.
  - `windowUnitZ(solid, hole): number` — 3D local-z of the window unit's center: the unit hugs the face *opposite* `hole.side` (the exterior), i.e. `wallZCenter − hole.side * thickness/2 + hole.side * windowUnitDepth/2`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/room-scene.test.ts` (it already imports `buildEdgeSolids`, `deriveFloor`-style fixtures — follow its existing setup; `makeFloor` comes from `#/lib/model/test-fixtures`, rooms from `deriveFloor(floor).rooms`):

```ts
describe("per-edge wall thickness", () => {
	const solidsOf = (floor: Floor) =>
		buildEdgeSolids(floor, deriveFloor(floor).rooms);

	it("defaults every solid to WALL_THICKNESS, centered", () => {
		for (const solid of solidsOf(makeFloor())) {
			expect(solid.thickness).toBe(WALL_THICKNESS);
			expect(solid.outwardShift).toBe(0);
		}
	});

	it("grows a 1-face wall outward, interior face pinned", () => {
		const floor = setEdgeThickness(makeFloor(), "AB", 0.3);
		const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
		expect(ab?.thickness).toBe(0.3);
		expect(ab?.outwardShift).toBeCloseTo(0.1, 9);
		// AB's single face is the living room on side +1, so outward is the
		// rightNormal → outwardSign −1, and the interior face stays at 5 cm:
		expect(ab?.outwardSign).toBe(-1);
		if (!ab) throw new Error("AB solid missing");
		expect(faceOutwardOffset(ab, 1)).toBeCloseTo(-0.05, 9);
		expect(faceOutwardOffset(ab, -1)).toBeCloseTo(0.25, 9);
		expect(wallZOffset(ab)).toBeCloseTo(-0.25, 9);
	});

	it("keeps a shared (2-face) wall at the default — override dormant", () => {
		const floor = setEdgeThickness(makeFloor(), "BE", 0.3);
		const be = solidsOf(floor).find((s) => s.edgeId === "BE");
		expect(be?.thickness).toBe(WALL_THICKNESS);
		expect(be?.outwardShift).toBe(0);
	});

	it("grows a dangling (0-face) edge symmetrically", () => {
		const base = makeFloor();
		const floor = setEdgeThickness(
			{
				...base,
				nodes: [...base.nodes, { id: "X", x: 20, y: 0 }, { id: "Y", x: 22, y: 0 }],
				edges: [...base.edges, { id: "XY", a: "X", b: "Y" }],
			},
			"XY",
			0.3,
		);
		const xy = solidsOf(floor).find((s) => s.edgeId === "XY");
		expect(xy?.thickness).toBe(0.3);
		expect(xy?.outwardShift).toBe(0);
	});

	it("resolves window sill fields onto the hole", () => {
		let floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0.18);
		floor = setOpeningSillMaterial(floor, "window-AB", "wood");
		const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
		const hole = ab?.holes.find((h) => h.id === "window-AB");
		expect(hole?.sillOverhang).toBe(0.18);
		expect(hole?.sillMaterial).toBe("wood");
		// Unit sits in the outer 10 cm; on a default wall that is centered:
		if (!ab || !hole) throw new Error("window hole missing");
		expect(windowUnitZ(ab, hole)).toBeCloseTo(0, 9);
	});
});
```

Add the new imports (`faceOutwardOffset`, `wallZOffset`, `windowUnitZ`, `setEdgeThickness`, `setOpeningSillMaterial`, `setOpeningSillOverhang`, `deriveFloor`, `makeFloor`, `Floor`) alongside the file's existing ones.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: FAIL — new fields/exports missing.

- [ ] **Step 3: Implement in `src/lib/room-scene.ts`**

Extend `WallHole` (windows only, resolved values):

```ts
	/** Windows only: resolved sill overhang past the interior face, meters. */
	sillOverhang?: number;
	/** Windows only: resolved sill board material. */
	sillMaterial?: "white" | "wood";
```

Extend `WallSolid` (after `height`):

```ts
	/** Effective wall thickness (per-edge override; shared walls stay default). */
	thickness: number;
	/**
	 * How far the body's mid-plane sits from the edge centerline along
	 * `outward`, meters (≥ 0). Non-zero only for a thickened 1-face wall,
	 * whose interior face stays pinned at WALL_THICKNESS / 2.
	 */
	outwardShift: number;
	/** +1 when `outward` is the leftNormal of `dir`, −1 for the rightNormal.
	 * Converts outward-coordinates to the 3D wall-local z axis (which is the
	 * leftNormal): localZ = outwardSign * outwardCoordinate. */
	outwardSign: 1 | -1;
```

In `cutHole`, resolve sill fields for windows — change the push to:

```ts
	const sill =
		opening.kind === "window" ? openingSill(opening) : null;
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
	});
```

(add `openingSill` to the `#/lib/model` import).

In `buildEdgeSolids`, before `solids.push`, compute:

```ts
		// Effective thickness: the override counts only while the edge borders
		// at most one room face (dormant on shared walls). A 1-face wall grows
		// outward — interior face pinned at WALL_THICKNESS / 2 — while a
		// dangling edge grows symmetrically (no defined interior side).
		const thickness =
			adj.length <= 1 ? (edge.thickness ?? WALL_THICKNESS) : WALL_THICKNESS;
		const outwardShift =
			adj.length === 1 ? (thickness - WALL_THICKNESS) / 2 : 0;
		const outwardSign: 1 | -1 =
			adj.length === 1 && faceSides[0] === 1 ? -1 : 1;
```

and add `thickness, outwardShift, outwardSign` to the pushed solid. (`edge.thickness` is already clamped by the setter; persistence rejects out-of-range values.)

Add the helpers (near `stubSpans`):

```ts
/** Outward-coordinate extents of a wall body (use with `wallPoint`). */
export function wallBandRange(solid: WallSolid): {
	inner: number;
	outer: number;
} {
	return {
		inner: solid.outwardShift - solid.thickness / 2,
		outer: solid.outwardShift + solid.thickness / 2,
	};
}

/** Outward-coordinate of the wall face on leftNormal-signed `side`. */
export function faceOutwardOffset(solid: WallSolid, side: 1 | -1): number {
	return solid.outwardShift + solid.outwardSign * side * (solid.thickness / 2);
}

/** 3D wall-local z where the extrusion (local 0..thickness) starts. */
export function wallZOffset(solid: WallSolid): number {
	return solid.outwardSign * solid.outwardShift - solid.thickness / 2;
}

/** 3D wall-local z of the body's mid-plane. */
export function wallZCenter(solid: WallSolid): number {
	return solid.outwardSign * solid.outwardShift;
}

/** Depth of the window unit (frame + glass) within the wall. */
export function windowUnitDepth(solid: WallSolid): number {
	return Math.min(WALL_THICKNESS, solid.thickness);
}

/**
 * 3D wall-local z of the window unit's center plane: the unit occupies the
 * outer `windowUnitDepth` of the wall — flush against the face opposite the
 * hole's room side — leaving the interior reveal for the sill. On a default
 * 10 cm wall this is the wall center (today's placement, unchanged).
 */
export function windowUnitZ(
	solid: WallSolid,
	hole: Pick<WallHole, "side">,
): number {
	const farFace = wallZCenter(solid) - hole.side * (solid.thickness / 2);
	return farFace + hole.side * (windowUnitDepth(solid) / 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/room-scene.test.ts` then `pnpm test` (nothing else should regress — the fields are additive).
Expected: PASS.

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/lib/room-scene.ts src/lib/room-scene.test.ts
git commit -m "Wall solids resolve per-edge thickness with outward growth"
```

---

### Task 5: Geometry — the sill box, pure and tested

**Files:**
- Modify: `src/lib/room-scene.ts`
- Test: `src/lib/room-scene.test.ts` (append)

**Interfaces:**
- Consumes: Task 4's fields/helpers.
- Produces: `SILL_THICKNESS = 0.04`; `SILL_EAR = 0.04`; `interface SillBox { x; y; z; width; height; depth; material }` (wall-local: x along the wall, y up, z on the local leftNormal axis); `sillBox(solid: WallSolid, hole: WallHole): SillBox | null` — null for doors and for degenerate depth (default wall + overhang 0).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/room-scene.test.ts`:

```ts
describe("sillBox", () => {
	const solidsOf = (floor: Floor) =>
		buildEdgeSolids(floor, deriveFloor(floor).rooms);
	const windowOn = (floor: Floor) => {
		const ab = solidsOf(floor).find((s) => s.edgeId === "AB");
		const hole = ab?.holes.find((h) => h.id === "window-AB");
		if (!ab || !hole) throw new Error("fixture window missing");
		return { ab, hole };
	};

	it("default wall + default overhang: a 3 cm ledge on the room side", () => {
		const { ab, hole } = windowOn(makeFloor());
		const sill = sillBox(ab, hole);
		expect(sill).not.toBeNull();
		if (!sill) return;
		expect(sill.width).toBeCloseTo(hole.width + 0.08, 9);
		expect(sill.height).toBe(0.04);
		expect(sill.y).toBeCloseTo(hole.bottom - 0.02, 9);
		expect(sill.depth).toBeCloseTo(0.03, 9);
		// Room is on side +1; the board spans interior face (+0.05) → +0.08.
		expect(sill.z).toBeCloseTo(0.065, 9);
		expect(sill.material).toBe("white");
	});

	it("thick wall + overhang 0: fills the reveal, flush at the face", () => {
		let floor = setEdgeThickness(makeFloor(), "AB", 0.3);
		floor = setOpeningSillOverhang(floor, "window-AB", 0);
		const { ab, hole } = windowOn(floor);
		const sill = sillBox(ab, hole);
		if (!sill) throw new Error("sill missing");
		// Reveal = 0.3 − 0.1 = 0.2, spanning local z −0.15 (unit's interior
		// face) → +0.05 (pinned interior wall face).
		expect(sill.depth).toBeCloseTo(0.2, 9);
		expect(sill.z).toBeCloseTo(-0.05, 9);
	});

	it("null for doors and for a zero-depth board", () => {
		const floor = setOpeningSillOverhang(makeFloor(), "window-AB", 0);
		const { ab, hole } = windowOn(floor);
		expect(sillBox(ab, hole)).toBeNull();
		const be = solidsOf(makeFloor()).find((s) => s.edgeId === "BE");
		const door = be?.holes.find((h) => h.id === "door-BE");
		if (!be || !door) throw new Error("fixture door missing");
		expect(sillBox(be, door)).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: FAIL — `sillBox` missing.

- [ ] **Step 3: Implement in `src/lib/room-scene.ts`**

```ts
/** Sill board thickness (drops below the hole bottom), meters. */
export const SILL_THICKNESS = 0.04;
/** How far the board extends past the hole on each side, meters. */
export const SILL_EAR = 0.04;

/** One window's sill board, in wall-local coordinates (x along the wall,
 * y up from the floor, z on the local leftNormal axis). */
export interface SillBox {
	x: number;
	y: number;
	z: number;
	width: number;
	height: number;
	depth: number;
	material: "white" | "wood";
}

/**
 * The sill board of a window hole: top face flush with `hole.bottom`, running
 * from the window unit's interior face to `sillOverhang` past the interior
 * wall face on the hole's room side (`hole.side`), with `SILL_EAR` ears. Null
 * for doors, and when the board would be zero-deep (default-thickness wall
 * with overhang 0 — no reveal, nothing to draw).
 */
export function sillBox(solid: WallSolid, hole: WallHole): SillBox | null {
	if (hole.kind !== "window") return null;
	const overhang = hole.sillOverhang ?? 0;
	const depth = solid.thickness - windowUnitDepth(solid) + overhang;
	if (depth < MIN_HOLE_SIZE) return null;
	const unitInterior =
		windowUnitZ(solid, hole) + hole.side * (windowUnitDepth(solid) / 2);
	return {
		x: hole.start + hole.width / 2,
		y: hole.bottom - SILL_THICKNESS / 2,
		z: unitInterior + hole.side * (depth / 2),
		width: hole.width + 2 * SILL_EAR,
		height: SILL_THICKNESS,
		depth,
		material: hole.sillMaterial ?? "white",
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/lib/room-scene.ts src/lib/room-scene.test.ts
git commit -m "sillBox: pure sill-board geometry (reveal fill + overhang + ears)"
```

---

### Task 6: 3D renderer — asymmetric walls, repositioned window unit, sill mesh

**Files:**
- Modify: `src/components/room-scene.tsx`

**Interfaces:**
- Consumes: Task 4–5 helpers (`wallZOffset`, `wallZCenter`, `windowUnitDepth`, `windowUnitZ`, `sillBox`, `SILL_THICKNESS`) — add them to the `#/lib/room-scene` import.
- Produces: walls extrude at `solid.thickness` offset by `wallZOffset(solid)`; window frame/pane/muntins sit at `windowUnitZ`; a sill mesh per window; shadow-proxy bars follow the unit placement so sun patches stay correct. No API changes.

- [ ] **Step 1: Reposition the wall extrusion**

In `WallMesh` (line ~503): both `ExtrudeGeometry` calls change `depth: WALL_THICKNESS` → `depth: solid.thickness`, and the offset (line 545) becomes:

```ts
	const zOffset = wallZOffset(solid);
```

The threshold mesh (line 628) keeps `WALL_THICKNESS` semantics but should read the solid: change its `boxGeometry` depth to `solid.thickness` (two-face edges are always default, so this is a no-op today and stays correct if that ever changes).

- [ ] **Step 2: Move the window unit to the outer band**

Change `windowBars` to take the solid (both call sites pass it):

```ts
function windowBars(
	solid: WallSolid,
	hole: WallSolid["holes"][number],
): Array<[string, number, number, number, number, number]> {
	const f = WINDOW_FRAME_SIZE;
	const cx = hole.start + hole.width / 2;
	const cy = (hole.bottom + hole.top) / 2;
	const height = hole.top - hole.bottom;
	const unit = windowUnitDepth(solid);
	const frameDepth = unit + 0.02;
	// Frame bars sit inside the hole, border-box style; the muntin cross
	// stays within the unit's depth.
	return [
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
		["muntin-v", cx, cy, 0.06, height - 2 * f, unit],
		["muntin-h", cx, cy, hole.width - 2 * f, 0.06, unit],
	];
}
```

In `WindowDressing`, replace the `zCenter` prop with the solid (the caller at line 602 currently passes `zCenter={0}`): props become `{ solid, hole, lighting }`, and inside:

```ts
	const z = windowUnitZ(solid, hole);
```

Update the comment: the unit hugs the exterior face (outer `windowUnitDepth`), which on a default wall is the old centered placement. `windowBars(hole)` call becomes `windowBars(solid, hole)`.

In `WallMesh`'s shadow-proxy group (lines 581–593), the bars' mesh position changes from `[x, y, 0]` to `[x, y, windowUnitZ(solid, hole)]` and the call becomes `windowBars(solid, hole)`.

- [ ] **Step 3: Add the sill mesh**

Add a wood tone next to `WINDOW_FRAME_COLOR` (line 92):

```ts
const SILL_WOOD_COLOR = "#b98a5f";
```

In `WindowDressing`, after the frame bars map, render the sill:

```tsx
			{(() => {
				const sill = sillBox(solid, hole);
				if (!sill) return null;
				return (
					<mesh position={[sill.x, sill.y, sill.z]} raycast={noRaycast}>
						<boxGeometry args={[sill.width, sill.height, sill.depth]} />
						<meshLambertMaterial
							color={
								sill.material === "wood" ? SILL_WOOD_COLOR : WINDOW_FRAME_COLOR
							}
						/>
					</mesh>
				);
			})()}
```

(The sill casts no proxy shadow — accepted in the spec.)

- [ ] **Step 4: Verify by eye + tests**

Run: `pnpm test` and `pnpm dev`, then in the browser: default room renders identically (walls centered, frames centered); nothing else changes yet (no UI to thicken walls). Confirm no console errors.

- [ ] **Step 5: Check + commit**

```bash
pnpm check
git add src/components/room-scene.tsx
git commit -m "3D lens: asymmetric wall extrusion, outer-band window unit, sill board"
```

---

### Task 7: Corner posts cover thick walls (polygon posts)

**Files:**
- Modify: `src/lib/room-scene.ts` (`NodePost`, `nodePosts`)
- Modify: `src/components/room-scene.tsx` (`Walls` post rendering)
- Modify: `src/components/plan-scene.tsx` (`WallLayer` post shapes)
- Test: `src/lib/room-scene.test.ts` (append)

**Interfaces:**
- Consumes: `wallBandRange` (Task 4).
- Produces: `NodePost` gains `corners: Point[]` (a 4-corner plan-coordinate polygon covering interior-face corner → exterior-face corner). `center`, `edgeIndices`, `height` stay.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/room-scene.test.ts`:

```ts
describe("nodePosts corners", () => {
	const postsOf = (floor: Floor) => {
		const solids = buildEdgeSolids(floor, deriveFloor(floor).rooms);
		return nodePosts(floor, solids);
	};
	const sortedCorners = (post: { corners: Point[] }) =>
		[...post.corners].sort((a, b) => a.x - b.x || a.y - b.y);

	it("default corner: the old 10 cm square", () => {
		const post = postsOf(makeFloor()).find((p) => p.nodeId === "A");
		if (!post) throw new Error("post at A missing");
		expect(sortedCorners(post)).toEqual([
			{ x: -0.1, y: -0.1 },
			{ x: -0.1, y: 0 },
			{ x: 0, y: -0.1 },
			{ x: 0, y: 0 },
		]);
	});

	it("thickened wall widens its axis of the corner post", () => {
		// AB (horizontal, outward −y) thickened to 0.3: the post at A spans
		// y from the pinned interior face (0) to the bulked exterior (−0.3),
		// while FA's axis (x) keeps the default 0.1 span.
		const post = postsOf(setEdgeThickness(makeFloor(), "AB", 0.3)).find(
			(p) => p.nodeId === "A",
		);
		if (!post) throw new Error("post at A missing");
		expect(sortedCorners(post)).toEqual([
			{ x: -0.1, y: -0.3 },
			{ x: -0.1, y: 0 },
			{ x: 0, y: -0.3 },
			{ x: 0, y: 0 },
		]);
	});
});
```

Expected values derive from node A at (−0.05, −0.05): AB has outward (0, −1) (living room on side +1 → rightNormal), band range [−0.05, +0.05] default → y ∈ A.y + {−(0.05), +(0.05)}·(−1)… i.e. y ∈ {−0.1, 0}; FA runs F→A (downward, dir (0,1)), its single face is also the living room; its outward is (−1, 0), x ∈ {−0.1, 0}. With AB at 0.3: band range [−0.05, 0.25] → y ∈ {A.y − 0.25·1 = −0.3 … A.y + 0.05 = 0}. If the run reveals a differing but *correct* orientation (e.g. FA's outward sign), fix the expectation to the derived faces — the invariant to assert is: interior corner at (0, 0) (the pinned faces) and exterior extents matching each wall's own band range.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/room-scene.test.ts`
Expected: FAIL — `corners` missing on `NodePost`.

- [ ] **Step 3: Implement `corners` in `nodePosts`**

Extend `NodePost`:

```ts
	/** Plan-coordinate polygon (4 corners) the post fills: the span of each
	 * principal incident wall's band (interior face → exterior face), so a
	 * thickened wall's corner is covered; exterior overshoot is acceptable. */
	corners: Point[];
```

`nodePosts` already receives `solids` and builds `incident` per node from edge dirs; extend the incident entries to carry the solid, then compute corners per post. Replace the post-building loop body (after the collinear check) with:

```ts
		// Principal axes: the first incident wall, and the first whose outward
		// is not parallel to it. Ranges start as each wall's own band and are
		// widened by any further incident wall on the nearer axis.
		const a = list[0].solid;
		const b =
			list.find(
				(entry) =>
					Math.abs(
						entry.solid.outward.x * a.outward.y -
							entry.solid.outward.y * a.outward.x,
					) > 1e-6,
			)?.solid ?? null;
		const axisA = a.outward;
		const axisB = b ? b.outward : { x: -a.outward.y, y: a.outward.x };
		const bandA = wallBandRange(a);
		const rangeA = { lo: bandA.inner, hi: bandA.outer };
		const rangeB = b
			? { lo: wallBandRange(b).inner, hi: wallBandRange(b).outer }
			: { lo: -WALL_THICKNESS / 2, hi: WALL_THICKNESS / 2 };
		for (const entry of list) {
			if (entry.solid === a || entry.solid === b) continue;
			const band = wallBandRange(entry.solid);
			const dotA =
				entry.solid.outward.x * axisA.x + entry.solid.outward.y * axisA.y;
			const dotB =
				entry.solid.outward.x * axisB.x + entry.solid.outward.y * axisB.y;
			const [axisDot, range] =
				Math.abs(dotA) >= Math.abs(dotB) ? [dotA, rangeA] : [dotB, rangeB];
			const mapped = [band.inner * axisDot, band.outer * axisDot];
			range.lo = Math.min(range.lo, ...mapped);
			range.hi = Math.max(range.hi, ...mapped);
		}
		const corner = (u: number, v: number): Point => ({
			x: node.x + axisA.x * u + axisB.x * v,
			y: node.y + axisA.y * u + axisB.y * v,
		});
		posts.push({
			nodeId,
			center: { x: node.x, y: node.y },
			corners: [
				corner(rangeA.lo, rangeB.lo),
				corner(rangeA.hi, rangeB.lo),
				corner(rangeA.hi, rangeB.hi),
				corner(rangeA.lo, rangeB.hi),
			],
			edgeIndices: list.map((entry) => entry.index),
			height: Math.max(...list.map((entry) => entry.height)),
		});
```

To make `list[0].solid` available, change the `incident` map's entry type to `Array<{ dir: Point; index: number; height: number; solid: WallSolid }>` and pass the solid in both `add` calls.

- [ ] **Step 4: Render polygon posts in both lenses**

`src/components/room-scene.tsx`, `Walls` (lines 708–746): replace the three fixed `boxGeometry` post meshes with extrusions of the polygon (pattern of `Platform`):

```tsx
			{posts.map((post, i) => {
				const shape = planShape(post.corners);
				return (
					<group key={post.nodeId}>
						<mesh
							material={shadowOnlyMaterial}
							rotation-x={-Math.PI / 2}
							raycast={noRaycast}
							castShadow
						>
							<extrudeGeometry args={[shape, { depth: post.height, bevelEnabled: false }]} />
						</mesh>
						<mesh
							ref={(mesh) => {
								postFullRefs.current[i] = mesh;
							}}
							rotation-x={-Math.PI / 2}
							raycast={noRaycast}
							receiveShadow
						>
							<extrudeGeometry args={[shape, { depth: post.height, bevelEnabled: false }]} />
							<meshLambertMaterial color={WALL_EDGE_COLOR} />
						</mesh>
						<mesh
							ref={(mesh) => {
								postStubRefs.current[i] = mesh;
							}}
							rotation-x={-Math.PI / 2}
							raycast={noRaycast}
							visible={false}
							receiveShadow
						>
							<extrudeGeometry args={[shape, { depth: STUB_WALL_HEIGHT, bevelEnabled: false }]} />
							<meshLambertMaterial color={WALL_EDGE_COLOR} />
						</mesh>
					</group>
				);
			})}
```

Memoize `planShape(post.corners)` per post if the linter complains about per-render allocation (a `useMemo` keyed on `posts` producing the shape array is fine). Note the extrusion runs *up* from y=0 after the −π/2 rotation exactly as `Platform` does — no `position-y` needed (extrude depth runs along +y after rotation; `Platform` sinks because its cap must land at floor level, posts start at 0).

**Verify the direction at runtime** — if posts extrude downward, add `position-y={post.height}` (full/shadow) / `position-y={STUB_WALL_HEIGHT}` (stub) as `Platform`'s sinking implies.

`src/components/plan-scene.tsx`, `WallLayer` (lines 723–733): replace the half-square push with:

```ts
		for (const post of posts) {
			shapes.push(shapeFromPoints(post.corners));
		}
```

(delete the now-unused `const half = WALL_THICKNESS / 2;`).

- [ ] **Step 5: Run tests + eyeball, check, commit**

Run: `pnpm vitest run src/lib/room-scene.test.ts`, `pnpm test`, `pnpm dev` (corners look unchanged on the default floor in both lenses).

```bash
pnpm check
git add src/lib/room-scene.ts src/lib/room-scene.test.ts src/components/room-scene.tsx src/components/plan-scene.tsx
git commit -m "Polygon corner posts sized to each incident wall's band"
```

---

### Task 8: 2D plan + pick surfaces follow per-edge thickness; plan sill stool

**Files:**
- Modify: `src/components/plan-scene.tsx` (`bandRect`, `WindowSymbol`, `WallOpenings`)
- Modify: `src/components/plan-openings.tsx` (pick/highlight/halo rects, chip anchor)
- Modify: `src/components/room-openings.tsx` (pick volume depth/center, vertical-guide offset)
- Modify: `src/components/opening-ghost.tsx` (band depth/center)

**Interfaces:**
- Consumes: `wallBandRange`, `faceOutwardOffset`, `wallZCenter`, `SILL_EAR` from `#/lib/room-scene` (Task 4–5).
- Produces: no API changes — geometry only.

- [ ] **Step 1: plan-scene.tsx**

`bandRect` (line 194) uses the solid's band:

```ts
function bandRect(solid: WallSolid, span: Span): [Point, Point, Point, Point] {
	const { inner, outer } = wallBandRange(solid);
	return [
		wallPoint(solid, span.start, inner),
		wallPoint(solid, span.end, inner),
		wallPoint(solid, span.end, outer),
		wallPoint(solid, span.start, outer),
	];
}
```

`WindowSymbol` (line 316) spans the band:

```ts
	const inset = 0.02;
	const { inner, outer } = wallBandRange(solid);
	const lines: Array<{ offset: number; width: number }> = [
		{ offset: inner + inset, width: 3 },
		{ offset: solid.outwardShift, width: 2 },
		{ offset: outer - inset, width: 3 },
	];
```

Sill stool: in `WallOpenings`, render for every window hole with a positive overhang a hairline rectangle protruding into the room on `hole.side`. Add inside the returned group (after the symbols map):

```tsx
			{solid.holes.map((hole) => {
				const overhang = hole.sillOverhang ?? 0;
				if (hole.kind !== "window" || overhang <= 0) return null;
				// Outward-coordinate of the room-side face, then `overhang`
				// further toward the room (leftNormal side × outwardSign).
				const face = faceOutwardOffset(solid, hole.side);
				const step = solid.outwardSign * hole.side * overhang;
				const rect = [
					wallPoint(solid, hole.start - SILL_EAR, face),
					wallPoint(solid, hole.start + hole.width + SILL_EAR, face),
					wallPoint(solid, hole.start + hole.width + SILL_EAR, face + step),
					wallPoint(solid, hole.start - SILL_EAR, face + step),
				];
				return (
					<Line
						key={`sill-${hole.id}`}
						points={[...rect, rect[0]].map((p) => v3(p, LINE_Y))}
						color={SYMBOL_COLOR}
						lineWidth={1.5}
						alphaToCoverage={false}
					/>
				);
			})}
```

Sign note: the protrusion must go *toward the room*, which is the leftNormal-signed `hole.side`; in outward coordinates that is `outwardSign * hole.side`. On a default 1-face wall `hole.side === -outwardSign`, so `step` is negative — inward, away from `outward` — which is correct. Keep the expression exactly as written; the Task 5 tests pin the equivalent 3D math.

Also `PlanScene`'s `dimensionOffset` (line 971) may now sit inside a thickened outer face; widen it to the floor's thickest band: `const dimensionOffset = Math.max(WALL_THICKNESS, ...solids.map((s) => wallBandRange(s).outer)) + DIMENSION_GAP;`. `PlanShadow`'s fixed margins can stay (cosmetic).

- [ ] **Step 2: plan-openings.tsx**

Imports: add `wallBandRange` (from `#/lib/room-scene`). In `OpeningTarget` replace the three rect computations:

- pick (line 133): `wallRect(solid, hole.start, end, wallBandRange(solid).inner - PICK_PAD, wallBandRange(solid).outer + PICK_PAD)` (hoist `const band = wallBandRange(solid);` in the memo).
- highlight (line 138–144): offsets `band.inner - HIGHLIGHT_PAD` / `band.outer + HIGHLIGHT_PAD`.
- halo (line 147–154): offsets `band.inner - HALO_PAD` / `band.outer + HALO_PAD`.

Chip anchor (line 289): `wallPoint(solid, hole.start + hole.width / 2, solid.outwardShift)`.

- [ ] **Step 3: room-openings.tsx**

Imports: add `faceOutwardOffset`, `wallZCenter` to the `#/lib/room-scene` import. In `OpeningVolume`, the group centers on the wall body: `<group position={[cx, cy, wallZCenter(solid)]}>`, and both `boxGeometry` depths become `solid.thickness + PICK_PAD * 2` (pick) and `solid.thickness + 0.03` (highlight band).

In `WallVerticalGuides` (line 184), the guide stands just past the face on the hole's side. `off` multiplies the leftNormal `(−dir.y, dir.x)` below, so it needs the leftNormal-signed distance:

```ts
	const off =
		(faceOutwardOffset(solid, hole.side) * solid.outwardSign + 0.02 * 1) *
		hole.side;
```

Careful: `faceOutwardOffset * outwardSign` converts to a leftNormal coordinate, which already carries the face's sign; standing on the `hole.side` face means the leftNormal coordinate of the face plus `0.02 * hole.side`. Replace with the direct form:

```ts
	// LeftNormal coordinate of the face on the hole's side, nudged 0.02 m
	// further toward that side. (Default wall: ±0.07, exactly the old value.)
	const off =
		solid.outwardSign * faceOutwardOffset(solid, hole.side) +
		0.02 * hole.side;
```

and keep the existing `at` computation (it applies `off` along `(−dir.y, dir.x)`, the leftNormal).

- [ ] **Step 4: opening-ghost.tsx**

The band mesh (lines 110–128): center it on the wall body and match its depth. Replace:

```ts
	const mid = offset + width / 2;
	const center = wallPoint(solid, mid, solid.outwardShift);
```

and the box depth `WALL_THICKNESS + 0.02` → `solid.thickness + 0.02`. (`WALL_THICKNESS` import may then be unused — remove it if so.)

- [ ] **Step 5: Tests + eyeball, check, commit**

Run: `pnpm test` (all existing suites must stay green), `pnpm dev` — 2D plan renders identically for the default floor; thicken an edge in devtools-free fashion by temporarily hardcoding is NOT needed (Task 9 adds the UI; visual confirmation of thick walls happens in Task 11's verification).

```bash
pnpm check
git add src/components/plan-scene.tsx src/components/plan-openings.tsx src/components/room-openings.tsx src/components/opening-ghost.tsx
git commit -m "2D plan, pick targets and ghost follow per-edge wall bands; plan sill stool"
```

---

### Task 9: Wall selection — third selection kind with pick surfaces in both lenses

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/components/planner-canvas.tsx`
- Modify: `src/components/room-scene.tsx` (`RoomSceneProps`, `Walls`, `WallMesh`)
- Modify: `src/components/plan-scene.tsx` (`PlanSceneProps`, `WallLayer`)

**Interfaces:**
- Consumes: existing selection plumbing patterns (furniture + opening).
- Produces:
  - Route state: `selectedEdgeId: string | null`; handler `setWallThickness(meters: number)` (used by Task 10's inspector).
  - `PlannerCanvasProps` gains `selectedEdgeId: string | null; onSelectedEdgeIdChange: (id: string | null) => void;`.
  - `RoomSceneProps` / `PlanSceneProps` gain `selectedEdgeId: string | null; onSelectWall: (edgeId: string) => void;`.
  - Selecting a wall clears furniture/opening selections and vice versa; Esc and empty-canvas click clear it; entering draw mode clears it.

- [ ] **Step 1: Route state (`src/routes/index.tsx`)**

After the `selectedOpeningId` state (line 231):

```ts
	// The wall selection (either furnish lens): a graph edge picked by
	// clicking its body. Mutually exclusive with the furniture and opening
	// selections; the inspector edits its thickness.
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const selectedWall = useMemo(() => {
		if (!selectedEdgeId || viewMode === "draw") return null;
		const edge = floor.edges.find((e) => e.id === selectedEdgeId);
		if (!edge) return null;
		const a = floor.nodes.find((n) => n.id === edge.a);
		const b = floor.nodes.find((n) => n.id === edge.b);
		if (!a || !b) return null;
		const faces = derived.rooms.filter((r) =>
			r.wallRefs.some((ref) => ref.edgeId === edge.id),
		).length;
		const twoFace = faces === 2;
		return {
			edgeId: edge.id,
			length: Math.hypot(b.x - a.x, b.y - a.y),
			thickness: twoFace
				? WALL_THICKNESS
				: (edge.thickness ?? WALL_THICKNESS),
			twoFace,
		};
	}, [selectedEdgeId, viewMode, floor, derived]);
	const setWallThickness = useCallback(
		(meters: number) => {
			if (!selectedEdgeId) return;
			setFloor(setEdgeThickness(floorRef.current, selectedEdgeId, meters));
		},
		[selectedEdgeId, setFloor],
	);
```

Imports: add `setEdgeThickness` and `WALL_THICKNESS` to the `#/lib/model` import block.

Keyboard (mirror the opening effect at line 828): a new effect active when `selectedEdgeId && !selectedId && !selectedOpeningId && viewMode !== "draw" && !sceneDragActive`, handling only `Escape` → `if (!settingsOpen) setSelectedEdgeId(null)` (same input-skipping guards).

Pass to `PlannerCanvas`: `selectedEdgeId={selectedEdgeId}` and `onSelectedEdgeIdChange={setSelectedEdgeId}`. (Inspector wiring lands in Task 10.)

- [ ] **Step 2: Canvas plumbing (`src/components/planner-canvas.tsx`)**

Add the two props to `PlannerCanvasProps` and destructure (`onSelectedEdgeIdChange: setSelectedEdgeId`). Extend the two existing select callbacks and add the third:

```ts
	const selectItem = useCallback(
		(id: string) => {
			setSelectedId(id);
			setSelectedOpeningId(null);
			setSelectedEdgeId(null);
		},
		[setSelectedId, setSelectedOpeningId, setSelectedEdgeId],
	);
	const selectOpening = useCallback(
		(id: string) => {
			setSelectedOpeningId(id);
			setSelectedId(null);
			setSelectedEdgeId(null);
		},
		[setSelectedId, setSelectedOpeningId, setSelectedEdgeId],
	);
	const selectWall = useCallback(
		(edgeId: string) => {
			setSelectedEdgeId(edgeId);
			setSelectedId(null);
			setSelectedOpeningId(null);
		},
		[setSelectedId, setSelectedOpeningId, setSelectedEdgeId],
	);
```

`onPointerMissed` (line 911) additionally calls `setSelectedEdgeId(null)`. The placement-drag effect (line 809) clears it too. Pass `selectedEdgeId={selectedEdgeId}` and `onSelectWall={selectWall}` to both `PlanScene` and `RoomScene`.

- [ ] **Step 3: 3D pick + highlight (`src/components/room-scene.tsx`)**

`RoomSceneProps` gains `selectedEdgeId: string | null;` and `onSelectWall: (edgeId: string) => void;`; thread through `RoomScene` → `Walls` → `WallMesh` (props `selected: boolean`, `onSelectWall`).

In `WallMesh`: declare hover state at the top of the component (`const [hovered, setHovered] = useState(false); useCursor(hovered);` — add `useState` and drei's `useCursor` to the file's imports if `WallMesh` doesn't have them in scope), then add pick meshes **inside the existing display groups** (so the cutaway's visibility toggling governs them), using the same invisible-material pattern as `OpeningVolume`. Inside the `display.full` group, alongside `wallMesh(geometry.full)`:

```tsx
				{/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
				<mesh
					geometry={geometry.full}
					position-z={zOffset}
					onClick={(event) => {
						if (event.delta > CLICK_SLOP_PX) return;
						// The cutaway may have swapped this group out this frame.
						if (display.full && !display.full.visible) return;
						event.stopPropagation();
						onSelectWall(solid.edgeId);
					}}
					onPointerOver={(event) => {
						event.stopPropagation();
						setHovered(true);
					}}
					onPointerOut={() => setHovered(false)}
				>
					<meshBasicMaterial transparent opacity={0} depthWrite={false} />
				</mesh>
```

and a mirrored one inside `display.stub` using `geometry.stub` (guard `geometry.stub &&`, visibility check against `display.stub`). Import `CLICK_SLOP_PX` from `#/components/move-drag` (already imported at line 25).

Highlight (hovered or selected): a translucent accent shell over the wall body, sibling of the pick meshes inside `display.full` (and a stub-height copy inside `display.stub`):

```tsx
				{(hovered || selected) && (
					<mesh
						position={[
							solid.length / 2,
							solid.height / 2,
							wallZCenter(solid),
						]}
						raycast={noRaycast}
					>
						<boxGeometry
							args={[
								solid.length + 0.03,
								solid.height + 0.03,
								solid.thickness + 0.03,
							]}
						/>
						<meshBasicMaterial
							color={SELECTION_COLOR}
							transparent
							opacity={selected ? 0.25 : 0.12}
							depthWrite={false}
						/>
					</mesh>
				)}
```

(stub copy: height `STUB_WALL_HEIGHT`, y `STUB_WALL_HEIGHT / 2`.) Note openings keep priority naturally: their pick volumes bulge `PICK_PAD` past the wall faces, so they are the nearest hit over a hole.

- [ ] **Step 4: 2D pick + highlight (`src/components/plan-scene.tsx`)**

`PlanSceneProps` gains the same two props; `PlanScene` passes them to `WallLayer`, whose props become `{ solids, posts, selectedEdgeId, onSelectWall }`. In `WallLayer`, render per-solid pick meshes and a selected outline after the `FlatShape` walls:

```tsx
			{solids.map((solid) => (
				<WallPickTarget
					key={`pick-${solid.edgeId}`}
					solid={solid}
					selected={solid.edgeId === selectedEdgeId}
					onSelect={onSelectWall}
				/>
			))}
```

with a new component in the same file:

```tsx
/** Invisible pick area over a wall's solid spans (openings keep their own
 * nearer targets), with the accent outline while hovered/selected. */
function WallPickTarget({
	solid,
	selected,
	onSelect,
}: {
	solid: WallSolid;
	selected: boolean;
	onSelect: (edgeId: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	useCursor(hovered);
	const shapes = useMemo(
		() =>
			solidSpans(solid).map((span) => shapeFromPoints(bandRect(solid, span))),
		[solid],
	);
	const outline = useMemo(() => {
		const { inner, outer } = wallBandRange(solid);
		const rect = [
			wallPoint(solid, 0, inner - 0.03),
			wallPoint(solid, solid.length, inner - 0.03),
			wallPoint(solid, solid.length, outer + 0.03),
			wallPoint(solid, 0, outer + 0.03),
		];
		return [...rect, rect[0]];
	}, [solid]);
	if (shapes.length === 0) return null;
	return (
		<group>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
			<mesh
				rotation-x={-Math.PI / 2}
				position-y={WALL_Y + 0.001}
				onClick={(event) => {
					if (event.delta > CLICK_SLOP_PX) return;
					event.stopPropagation();
					onSelect(solid.edgeId);
				}}
				onPointerOver={(event) => {
					event.stopPropagation();
					setHovered(true);
				}}
				onPointerOut={() => setHovered(false)}
			>
				<shapeGeometry args={[shapes]} />
				<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			</mesh>
			{(hovered || selected) && (
				<Line
					points={outline.map((p) => v3(p, LINE_Y))}
					color={SELECTION_COLOR}
					lineWidth={selected ? 2.5 : 2}
					alphaToCoverage={false}
					raycast={noRaycast}
				/>
			)}
		</group>
	);
}
```

The pick mesh sits at `WALL_Y + 0.001` — *below* the opening pick layer (`PICK_Y = 0.02` in plan-openings.tsx), so opening targets win where they overlap. Imports to add in plan-scene.tsx: `wallBandRange` (from `#/lib/room-scene`), `wallPoint` and `solidSpans` are already imported.

- [ ] **Step 5: Manual verify, tests, check, commit**

`pnpm dev`: click a wall in 2D → accent outline; click a wall face in 3D → accent shell; clicking furniture/opening swaps selection kinds; Esc and empty-canvas click clear; cutaway (stub) walls still let clicks reach furniture behind them where the stub is low **when the stub pick mesh is the only one present** — verify by orbiting so a wall stubs and clicking furniture behind it. Then:

```bash
pnpm test && pnpm check
git add src/routes/index.tsx src/components/planner-canvas.tsx src/components/room-scene.tsx src/components/plan-scene.tsx
git commit -m "Wall selection: pick a wall in either lens (third selection kind)"
```

---

### Task 10: Inspector — wall section + sill controls

**Files:**
- Modify: `src/components/inspector.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: Task 9's `selectedWall` route memo + `setWallThickness`; Task 2's `openingSill`, `setOpeningSillOverhang`, `setOpeningSillMaterial`, `SillMaterial`, `MAX_SILL_OVERHANG`.
- Produces:
  - `export interface WallSelection { edgeId: string; length: number; thickness: number; twoFace: boolean }` in inspector.tsx.
  - `InspectorProps` gains `selectedWall?: WallSelection | null;` and `onWallThickness?: (meters: number) => void;`.
  - `OpeningSelection` gains `sillOverhang: number; sillMaterial: SillMaterial;`.
  - `InspectorProps` gains `onOpeningSillOverhang?: (meters: number) => void;` and `onOpeningSillMaterial?: (material: SillMaterial) => void;`.

- [ ] **Step 1: Inspector wall section**

In `src/components/inspector.tsx` add after `OpeningSection`:

```tsx
/** The route-resolved selected wall (a graph edge picked in either lens). */
export interface WallSelection {
	edgeId: string;
	/** Centerline length, meters (read-only here — draw mode edits lengths). */
	length: number;
	/** Effective thickness (a shared wall reads the dormant default). */
	thickness: number;
	/** The wall borders two rooms — thickness is locked to the default. */
	twoFace: boolean;
}

function WallSection({
	selection,
	unit,
	onThickness,
}: {
	selection: WallSelection;
	unit: Unit;
	onThickness: (meters: number) => void;
}) {
	const commitThickness = (text: string) => {
		const meters = parseLength(text, unit);
		if (meters === null) return;
		if (Math.abs(meters - selection.thickness) < SAME_EPSILON) return;
		onThickness(meters);
	};
	return (
		<>
			<div className="min-w-0">
				<div
					className="truncate font-semibold text-[15px] text-[var(--ink-900)]"
					data-testid="inspector-item-name"
				>
					Wall
				</div>
				<div className="mt-[2px] truncate text-[12.5px] text-[var(--ink-400)]">
					{selection.twoFace ? "Shared between two rooms" : "Exterior wall"}
				</div>
			</div>
			<div className="flex flex-col gap-2.5">
				<SectionLabel>TRANSFORM</SectionLabel>
				<div className="grid grid-cols-2 gap-2">
					<div className="flex min-w-0 flex-col gap-[3px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] px-[11px] py-2">
						<span className="text-[10px] text-[var(--ink-400)] tracking-[0.05em]">
							LENGTH
						</span>
						<span className="flex items-baseline">
							<span className="w-full min-w-0 font-mono text-[14px] text-[var(--ink-900)]">
								{formatLengthValue(selection.length, unit)}
							</span>
							<span className="font-mono text-[11px] text-[var(--ink-300)]">
								{unit}
							</span>
						</span>
					</div>
					{selection.twoFace ? (
						<div className="flex min-w-0 flex-col gap-[3px] rounded-[8px] border border-[var(--control-border)] bg-[var(--well)] px-[11px] py-2 opacity-70">
							<span className="text-[10px] text-[var(--ink-400)] tracking-[0.05em]">
								THICKNESS
							</span>
							<span className="flex items-baseline">
								<span className="w-full min-w-0 font-mono text-[14px] text-[var(--ink-500)]">
									{formatLengthValue(selection.thickness, unit)}
								</span>
								<span className="font-mono text-[11px] text-[var(--ink-300)]">
									{unit}
								</span>
							</span>
						</div>
					) : (
						<Field
							label="THICKNESS"
							ariaLabel="Wall thickness"
							suffix={unit}
							value={formatLengthValue(selection.thickness, unit)}
							onCommit={commitThickness}
						/>
					)}
				</div>
				{selection.twoFace && (
					<div className="text-[12.5px] text-[var(--ink-400)] leading-relaxed">
						Shared walls use the standard{" "}
						{formatLengthValue(0.1, unit)} {unit} thickness.
					</div>
				)}
			</div>
		</>
	);
}
```

Wire into `Inspector`: props `selectedWall = null` and `onWallThickness = () => {}` with the types above; view logic becomes:

```ts
	const showSelection = selectedItem !== null && !drawing;
	const showOpening = !showSelection && selectedOpening !== null && !drawing;
	const showWall =
		!showSelection && !showOpening && selectedWall !== null && !drawing;
	const header = drawing
		? "OUTLINE"
		: showSelection || showOpening || showWall
			? "SELECTION"
			: multiRoom
				? "FLOOR"
				: "ROOM";
```

and in the body chain, after the `showOpening` branch:

```tsx
				) : showWall ? (
					<WallSection
						selection={selectedWall}
						unit={unit}
						onThickness={onWallThickness}
					/>
```

- [ ] **Step 2: Inspector sill controls**

`OpeningSelection` gains:

```ts
	/** Effective sill parameters (windows; doors carry the defaults unused). */
	sillOverhang: number;
	sillMaterial: SillMaterial;
```

(import `SillMaterial` type from `#/lib/model`). `OpeningSectionProps` gains `onSillOverhang: (meters: number) => void;` and `onSillMaterial: (material: SillMaterial) => void;` — and `Inspector` props `onOpeningSillOverhang = () => {}` / `onOpeningSillMaterial = () => {}` passed through. In `OpeningSection`, after the TRANSFORM block, for windows only:

```tsx
			{!isDoor && (
				<div className="flex flex-col gap-2.5">
					<SectionLabel>SILL</SectionLabel>
					<div className="grid grid-cols-2 gap-2">
						{lengthField(
							"OVERHANG",
							"Sill overhang",
							selection.sillOverhang,
							commitLength(onSillOverhang, selection.sillOverhang),
						)}
						<div className="flex items-center gap-2">
							{(["white", "wood"] as const).map((material) => (
								<button
									key={material}
									type="button"
									aria-label={`Sill material ${material}`}
									aria-pressed={selection.sillMaterial === material}
									onClick={() => onSillMaterial(material)}
									className={cn(
										"flex-1 rounded-[8px] border py-[9px] text-[12px] capitalize",
										selection.sillMaterial === material
											? "border-[var(--blue)] text-[var(--ink-900)] ring-1 ring-[var(--blue)]"
											: "border-[var(--control-border)] bg-[var(--frame)] text-[var(--ink-500)] hover:bg-[var(--well)]",
									)}
								>
									{material}
								</button>
							))}
						</div>
					</div>
				</div>
			)}
```

- [ ] **Step 3: Route wiring (`src/routes/index.tsx`)**

`selectedOpening` memo adds the resolved sill (import `openingSill`):

```ts
		const sill = openingSill(opening);
		return {
			opening,
			bottom,
			top,
			sillOverhang: sill.overhang,
			sillMaterial: sill.material,
			ceiling: edgeCeiling(derived.rooms, opening.edgeId),
			...
```

New commit handlers next to the other opening commits (imports `setOpeningSillOverhang`, `setOpeningSillMaterial`, `SillMaterial` type):

```ts
	const setSelectedOpeningSillOverhang = useCallback(
		(meters: number) => {
			if (!selectedOpeningId) return;
			setFloor(
				setOpeningSillOverhang(floorRef.current, selectedOpeningId, meters),
			);
		},
		[selectedOpeningId, setFloor],
	);
	const setSelectedOpeningSillMaterial = useCallback(
		(material: SillMaterial) => {
			if (!selectedOpeningId) return;
			setFloor(
				setOpeningSillMaterial(floorRef.current, selectedOpeningId, material),
			);
		},
		[selectedOpeningId, setFloor],
	);
```

Pass everything to `<Inspector>`: `selectedWall={selectedWall}`, `onWallThickness={setWallThickness}`, `onOpeningSillOverhang={setSelectedOpeningSillOverhang}`, `onOpeningSillMaterial={setSelectedOpeningSillMaterial}`.

- [ ] **Step 4: Manual verify, tests, check, commit**

`pnpm dev`: select a wall → SELECTION shows Wall with LENGTH readout + THICKNESS field; type `30` (cm mode) or `0.3` → 3D wall bulks outward, room floor doesn't move, undo reverts in one step; select the shared wall → THICKNESS card disabled with hint. Select a window → SILL group; overhang `0` on the thick wall → flush recessed sill; `0.18` → shelf; Wood → oak tone; each commit is one undo step.

```bash
pnpm test && pnpm check
git add src/components/inspector.tsx src/routes/index.tsx
git commit -m "Inspector: wall thickness section + window sill controls"
```

---

### Task 11: Headless verification + PROGRESS entry

**Files:**
- Create: a throwaway Playwright script in the session scratchpad, per the project's `verify` skill (do not commit it)
- Modify: `PROGRESS.md`

**Interfaces:** none — verification + documentation.

- [ ] **Step 1: Full suites**

Run: `pnpm test` → all green. `pnpm check` → clean.

- [ ] **Step 2: Headless browser verification**

Invoke the project's `verify` skill for the launch/seed patterns (production build: `pnpm build && pnpm preview`, port 4173; kill leftovers by port first: `lsof -tnP -iTCP:4173 -sTCP:LISTEN | xargs kill`). Script the flow with real `page.mouse` input, asserting via `localStorage["planforge.room"]`:

1. Load the sample floor; switch to 2D; click the window wall's band (away from the window) → inspector shows "Wall".
2. Commit THICKNESS `0.3` → parse localStorage: the clicked edge has `thickness: 0.3`; floor area figure in the footer unchanged from before the commit.
3. Switch to 3D; screenshot → wall visibly thicker outward; window frame sits at the outer band with a visible interior reveal + sill.
4. Select the window; commit SILL OVERHANG `0.18` and material Wood → localStorage opening has `sillOverhang: 0.18`, `sillMaterial: "wood"`; screenshot shows the shelf.
5. Drag the window along and up the wall (press-wait-release per the PROGRESS gotcha) → still slides/rides normally.
6. Single ⌘Z steps: material → overhang → thickness, each reverting one commit.
7. Esc / empty-canvas click deselects the wall; reload → everything persists.
8. Zero page errors throughout.

- [ ] **Step 3: PROGRESS.md entry + final commit**

Append a dated History entry (2026-07-18) in the file's established voice, covering: sparse `WallEdge.thickness` + `setEdgeThickness` (split/merge carry-through), sill fields + setters, `buildEdgeSolids`' `thickness`/`outwardShift`/`outwardSign` with interior faces pinned (rooms/collision/mounts untouched), the outer-band window unit + `sillBox`, polygon corner posts, per-band 2D geometry + plan stool, the wall selection kind, inspector sections, and the verification results.

```bash
git add PROGRESS.md
git commit -m "PROGRESS: windowsills + per-wall depth"
```

---

## Self-review notes (already applied)

- **Spec coverage:** Part 1 → Tasks 1–2; Part 2 → Tasks 4–7; Part 3 → Task 8; Part 4 → Tasks 9–10; Part 5 → Task 3; Part 6 → tests within each task + Task 11. Spec's "dropped field" persistence wording amended in Task 3 to the module's actual reject style.
- **Known risk areas called out in-task:** edge-field survival through `normalizeGraph`/split/merge (Task 1 tests it); post extrusion direction after the −π/2 rotation (Task 7 step 4 verify note); cutaway-vs-pick-mesh visibility (Task 9 uses display-group membership + a visibility guard, verified in step 5).
- **Type consistency:** `wallBandRange`/`faceOutwardOffset`/`wallZOffset`/`wallZCenter`/`windowUnitDepth`/`windowUnitZ`/`sillBox` are defined once in Task 4–5 and consumed by name in Tasks 6–9; `WallSelection`/`SillMaterial` defined in Tasks 10/2 and used consistently.
