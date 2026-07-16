# Wall Graph Implementation Plan (Phase 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-room closed outlines with a single planar wall graph — shared corners drag together, walls exist without closing a loop, rooms are derived faces with stored identity.

**Architecture:** Pure graph modules land first (normalization → face extraction → identity matching), then one "flip" task swaps the stored `Floor` to graph form behind a **derived-rooms bridge**: interior polygons of faces sit exactly where today's outlines sit (walls extrude outward by `WALL_THICKNESS`), so scenes keep consuming Room-shaped views while draw mode, direct scene rendering, and furniture policy convert task by task. Spec: `docs/superpowers/specs/2026-07-16-wall-graph-design.md`.

**Tech Stack:** TypeScript, Vitest, React 19 + R3F, TanStack Start. No new dependencies.

## Global Constraints

- Package manager: `pnpm`. Tests: `pnpm vitest run <file>`; full suite `pnpm test`; lint/format `pnpm check` (Biome: tab indentation, double quotes) — run before every commit.
- All lengths in meters; plan coords x right, **y down**; sample winding = positive shoelace sign (see `signedDoubleArea` in `src/lib/room-scene.ts:94`).
- `WALL_THICKNESS = 0.1` (import from `#/lib/room-scene`), `DRAW_GRID_STEP = 0.05`, new `NODE_MERGE_TOLERANCE = 0.03` (must stay **below** the 0.05 grid so grid-adjacent points never weld).
- Persistence: current `STORAGE_VERSION` is **5**; the graph payload is **v6**, `READABLE_VERSIONS = {6}` — older saves are discarded, **no migration code** (owner's explicit call; the spec's "v5" line was corrected to v6).
- Every mutation path into a graph-backed `Floor` must return the **same reference on no-ops** (existing contract, `src/lib/model/floor.ts:10-21`) and must end in `reconcileFloor` (defined in Task G4) so stored state is always normalized + identity-matched.
- Ids: `crypto.randomUUID()` at creation sites; pure functions that mint ids accept an optional id-factory parameter so tests stay deterministic.
- Per project rules (CLAUDE.md): after each task, verify headless with a self-launched Playwright script (`chromium.launch({ headless: true, channel: "chrome" })`, real `page.mouse`) against `pnpm build` + preview — see the `verify` skill for launch/seed patterns — then commit that task's files only.
- Check tasks off in `PROGRESS.md` (Phase 9 section) as they land. (The pre-existing "Phase 8 — Drawing against existing walls" is a different, superseded phase — don't touch its W1 entry.)

---

### Task G1: Graph core — types, normalization, opening re-homing

**Files:**
- Create: `src/lib/model/graph.ts`
- Test: `src/lib/model/graph.test.ts`

**Interfaces:**
- Consumes: `Point` from `./types`; nothing else.
- Produces (later tasks import these exact names):
  - `interface WallNode { id: string; x: number; y: number }`
  - `interface WallEdge { id: string; a: string; b: string }`
  - `interface GraphOpening { id: string; kind: "door" | "window"; edgeId: string; offset: number; width: number; hinge?: "start" | "end"; side: 1 | -1 }`
  - `interface GraphState { nodes: WallNode[]; edges: WallEdge[]; openings: GraphOpening[] }`
  - `const NODE_MERGE_TOLERANCE = 0.03`
  - `function normalizeGraph(state: GraphState, newId?: () => string): GraphState`
  - `function nodeById(state: GraphState, id: string): WallNode | undefined`
  - `function edgeLength(state: GraphState, edge: WallEdge): number`

- [ ] **Step 1: Write the failing tests**

`graph.test.ts` — build fixtures with a tiny helper so ids are readable:

```ts
import { describe, expect, it } from "vitest";
import {
	type GraphState,
	NODE_MERGE_TOLERANCE,
	normalizeGraph,
} from "./graph";

let counter = 0;
const nextId = () => `gen-${counter++}`;
const node = (id: string, x: number, y: number) => ({ id, x, y });
const edge = (id: string, a: string, b: string) => ({ id, a, b });
const state = (partial: Partial<GraphState>): GraphState => ({
	nodes: [],
	edges: [],
	openings: [],
	...partial,
});

describe("normalizeGraph", () => {
	it("welds nodes within tolerance and keeps grid-distinct nodes apart", () => {
		const g = normalizeGraph(
			state({
				nodes: [
					node("a", 0, 0),
					node("b", 0.02, 0), // 2 cm from a → welds
					node("c", 0.05, 1), // one grid step from d in x… (1 m away in y: stays)
					node("d", 0, 1.05),
				],
				edges: [edge("e1", "a", "c"), edge("e2", "b", "d")],
			}),
			nextId,
		);
		expect(g.nodes).toHaveLength(3);
		// Earlier node absorbs: "a" survives at its own position.
		expect(g.nodes.map((n) => n.id)).toContain("a");
		expect(g.nodes.map((n) => n.id)).not.toContain("b");
		expect(g.edges.map((e) => [e.a, e.b])).toContainEqual(["a", "d"]);
	});

	it("drops zero-length and duplicate edges, re-homing a reversed duplicate's opening", () => {
		const g = normalizeGraph(
			state({
				nodes: [node("a", 0, 0), node("b", 4, 0)],
				edges: [
					edge("e1", "a", "b"),
					edge("e2", "b", "a"), // reversed duplicate
					edge("e3", "a", "a"), // zero-length
				],
				openings: [
					// On the reversed edge: 1 m from b, 0.8 wide, swinging side +1.
					{ id: "o1", kind: "door", edgeId: "e2", offset: 1, width: 0.8, side: 1 },
				],
			}),
			nextId,
		);
		expect(g.edges).toHaveLength(1);
		const o = g.openings[0];
		expect(o.edgeId).toBe("e1");
		// Mirrored: offset from a = 4 - 1 - 0.8, side flips.
		expect(o.offset).toBeCloseTo(2.2);
		expect(o.side).toBe(-1);
	});

	it("splits an edge at a node on its interior (T-junction) and re-homes openings", () => {
		const g = normalizeGraph(
			state({
				nodes: [node("a", 0, 0), node("b", 6, 0), node("t", 4, 0.01), node("s", 4, 2)],
				edges: [edge("e1", "a", "b"), edge("stub", "t", "s")],
				openings: [
					{ id: "left", kind: "window", edgeId: "e1", offset: 1, width: 1, side: 1 },
					{ id: "right", kind: "door", edgeId: "e1", offset: 4.5, width: 0.9, side: 1 },
				],
			}),
			nextId,
		);
		// t snaps onto the line (y=0) and splits e1 into a→t and t→b.
		const horizontal = g.edges.filter((e) => e.id !== "stub");
		expect(horizontal).toHaveLength(2);
		const left = g.openings.find((o) => o.id === "left");
		const right = g.openings.find((o) => o.id === "right");
		expect(left?.offset).toBeCloseTo(1);
		expect(right?.offset).toBeCloseTo(0.5); // 4.5 - 4 on the t→b piece
	});

	it("splits two crossing edges at their intersection", () => {
		const g = normalizeGraph(
			state({
				nodes: [node("a", 0, 1), node("b", 4, 1), node("c", 2, 0), node("d", 2, 3)],
				edges: [edge("h", "a", "b"), edge("v", "c", "d")],
			}),
			nextId,
		);
		expect(g.nodes).toHaveLength(5);
		expect(g.edges).toHaveLength(4);
	});

	it("drops orphan nodes and openings that no longer fit their edge", () => {
		const g = normalizeGraph(
			state({
				nodes: [node("a", 0, 0), node("b", 0.5, 0), node("lonely", 9, 9)],
				edges: [edge("e1", "a", "b")],
				openings: [
					{ id: "big", kind: "door", edgeId: "e1", offset: 0, width: 0.9, side: 1 },
					{ id: "gone", kind: "door", edgeId: "dead", offset: 0, width: 0.9, side: 1 },
				],
			}),
			nextId,
		);
		expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
		expect(g.openings).toHaveLength(0); // 0.9 door can't fit a 0.5 wall
	});

	it("is idempotent", () => {
		const once = normalizeGraph(
			state({
				nodes: [node("a", 0, 0), node("b", 6, 0), node("t", 3, 0), node("u", 3, 2)],
				edges: [edge("e1", "a", "b"), edge("e2", "t", "u")],
			}),
			nextId,
		);
		const twice = normalizeGraph(once, nextId);
		expect(twice).toEqual(once);
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/model/graph.test.ts`
Expected: FAIL — module `./graph` not found.

- [ ] **Step 3: Implement `graph.ts`**

Skeleton (fill the marked passes exactly as described — each is a handful of lines):

```ts
import type { Point } from "./types";

export interface WallNode { id: string; x: number; y: number }
export interface WallEdge { id: string; a: string; b: string }
export interface GraphOpening {
	id: string;
	kind: "door" | "window";
	edgeId: string;
	/** Distance from node `a` to the opening's near edge, along a→b. */
	offset: number;
	width: number;
	hinge?: "start" | "end";
	/** Face the door swings toward / the mount faces: sign of the cross
	 * product (b-a) × (p-a) for a point p on that side (see `sideOfPoint`,
	 * faces.ts, Task G2). */
	side: 1 | -1;
}
export interface GraphState {
	nodes: WallNode[];
	edges: WallEdge[];
	openings: GraphOpening[];
}

/** Below DRAW_GRID_STEP (0.05) so grid-snapped neighbors never weld. */
export const NODE_MERGE_TOLERANCE = 0.03;
const EPS = 1e-6;
const MAX_PASSES = 32;

export function nodeById(state: GraphState, id: string): WallNode | undefined;
export function edgeLength(state: GraphState, edge: WallEdge): number;

export function normalizeGraph(
	state: GraphState,
	newId: () => string = () => crypto.randomUUID(),
): GraphState {
	// Loop the passes below until a full pass changes nothing (≤ MAX_PASSES):
	// 1. weldNodes: for each pair within NODE_MERGE_TOLERANCE (Euclidean),
	//    the earlier node in array order absorbs the later (keeps its own
	//    id AND position); rewrite edge endpoints.
	// 2. dropDegenerateEdges: edges with a === b, or endpoint distance < EPS.
	// 3. dedupeEdges: same unordered {a,b} pair — keep the first; re-home the
	//    dropped edge's openings onto the keeper. Same orientation: copy as
	//    is. Reversed: offset' = length - offset - width; side' = -side;
	//    hinge' = hinge flips "start"↔"end" (when present).
	// 4. splitAtNodes: node n (not an endpoint) whose distance to segment
	//    a→b < NODE_MERGE_TOLERANCE with projection t ∈ (EPS, len-EPS):
	//    replace the edge with a→n (new id via newId()) and n→b (new id);
	//    ALSO move n onto the line (n := projection point) so the graph is
	//    exactly planar. Openings re-home by center like splitOutlineWall
	//    (src/lib/outline-edit.ts:227): center = offset + width/2; center ≤ t
	//    → piece A with offset clamped into [0, t - width] (drop if width >
	//    t); else piece B with offset - t clamped into [0, (len-t) - width]
	//    (drop if it can't fit).
	// 5. splitCrossings: for each edge pair with a proper interior
	//    intersection (segment-segment, parameters in (EPS, 1-EPS) on both),
	//    add a node at the intersection (newId()) and split both edges as in
	//    pass 4.
	// 6. dropOrphanNodes: nodes referenced by no edge.
	// 7. fitOpenings: drop openings whose edgeId no longer exists; clamp
	//    offset into [0, edgeLength - width]; drop if width > edgeLength.
	// Return the input object itself (same reference) when nothing changed.
}
```

Round split-point coordinates to 1e-4 (`Math.round(v * 1e4) / 1e4`, the codebase convention — see `outline-edit.ts:169`).

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/model/graph.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Check + commit**

```bash
pnpm check && pnpm test
git add src/lib/model/graph.ts src/lib/model/graph.test.ts
git commit -m "G1: wall-graph core — nodes/edges/openings + normalization"
```

---

### Task G2: Faces — extraction, label point, interior inset, sidedness

**Files:**
- Create: `src/lib/model/faces.ts`
- Test: `src/lib/model/faces.test.ts`

**Interfaces:**
- Consumes: `WallNode`, `WallEdge`, `GraphState` from `./graph`; `Point`, `pointInOutline` from `./geometry`/`./types`.
- Produces:
  - `interface Face { nodeIds: string[]; edgeIds: string[]; polygon: Point[]; area: number }` — `edgeIds[i]` joins `nodeIds[i]` → `nodeIds[(i+1) % n]`; `polygon` is the centerline loop; `area` > 0 (m²).
  - `function extractFaces(state: { nodes: WallNode[]; edges: WallEdge[] }): Face[]`
  - `function faceLabelPoint(polygon: Point[]): Point`
  - `function insetPolygon(polygon: Point[], inset: number): Point[] | null` — null when the inset degenerates (no interior).
  - `function sideOfPoint(a: Point, b: Point, p: Point): 1 | -1` — sign of `(b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x)`, `+1` for positive cross (0 falls to `-1`; callers never ask about points on the line).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { extractFaces, faceLabelPoint, insetPolygon, sideOfPoint } from "./faces";

const node = (id: string, x: number, y: number) => ({ id, x, y });
const edge = (id: string, a: string, b: string) => ({ id, a, b });
const square = {
	nodes: [node("a", 0, 0), node("b", 5, 0), node("c", 5, 4), node("d", 0, 4)],
	edges: [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("cd", "c", "d"), edge("da", "d", "a")],
};

describe("extractFaces", () => {
	it("finds one interior face for a rectangle, positive area, sample winding", () => {
		const faces = extractFaces(square);
		expect(faces).toHaveLength(1);
		expect(faces[0].area).toBeCloseTo(20);
		expect(faces[0].nodeIds).toHaveLength(4);
		// Winding matches the sample convention: positive shoelace sign.
		const p = faces[0].polygon;
		let sum = 0;
		for (let i = 0; i < p.length; i++) {
			const q = p[(i + 1) % p.length];
			sum += p[i].x * q.y - q.x * p[i].y;
		}
		expect(sum).toBeGreaterThan(0);
	});

	it("finds two faces for two rectangles sharing an edge — the shared edge in both", () => {
		const g = {
			nodes: [...square.nodes, node("e", 9, 0), node("f", 9, 4)],
			edges: [
				edge("ab", "a", "b"), edge("bc", "b", "c"), edge("cd", "c", "d"),
				edge("da", "d", "a"), edge("be", "b", "e"), edge("ef", "e", "f"),
				edge("fc", "f", "c"),
			],
		};
		const faces = extractFaces(g);
		expect(faces).toHaveLength(2);
		expect(faces.every((f) => f.edgeIds.includes("bc"))).toBe(true);
		expect(faces.map((f) => f.area).sort()).toEqual([16, 20]);
	});

	it("yields no face for an open chain, one face for square-plus-dangling-edge", () => {
		expect(
			extractFaces({
				nodes: [node("a", 0, 0), node("b", 3, 0), node("c", 3, 2)],
				edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
			}),
		).toHaveLength(0);
		const g = {
			nodes: [...square.nodes, node("x", 8, 8)],
			edges: [...square.edges, edge("dx", "c", "x")],
		};
		expect(extractFaces(g)).toHaveLength(1);
	});

	it("handles a concave L-shape", () => {
		const g = {
			nodes: [
				node("a", 0, 0), node("b", 6, 0), node("c", 6, 2),
				node("d", 3, 2), node("e", 3, 5), node("f", 0, 5),
			],
			edges: [
				edge("1", "a", "b"), edge("2", "b", "c"), edge("3", "c", "d"),
				edge("4", "d", "e"), edge("5", "e", "f"), edge("6", "f", "a"),
			],
		};
		const faces = extractFaces(g);
		expect(faces).toHaveLength(1);
		expect(faces[0].area).toBeCloseTo(6 * 2 + 3 * 3);
	});
});

describe("insetPolygon", () => {
	it("insets a rectangle symmetrically", () => {
		const inset = insetPolygon(
			[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }],
			0.05,
		);
		expect(inset).toEqual([
			{ x: 0.05, y: 0.05 }, { x: 4.95, y: 0.05 },
			{ x: 4.95, y: 3.95 }, { x: 0.05, y: 3.95 },
		]);
	});

	it("returns null when the polygon is too thin to inset", () => {
		expect(
			insetPolygon(
				[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.08 }, { x: 0, y: 0.08 }],
				0.05,
			),
		).toBeNull();
	});
});

describe("faceLabelPoint / sideOfPoint", () => {
	it("label point lies inside a concave polygon", () => {
		const poly = [
			{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 },
			{ x: 3, y: 2 }, { x: 3, y: 5 }, { x: 0, y: 5 },
		];
		const p = faceLabelPoint(poly);
		// pointInOutline from ./geometry
		expect(p.x).toBeGreaterThan(0);
	});

	it("sideOfPoint is antisymmetric across the line", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 4, y: 0 };
		expect(sideOfPoint(a, b, { x: 2, y: 1 })).toBe(
			-sideOfPoint(a, b, { x: 2, y: -1 }) as 1 | -1,
		);
	});
});
```

In the label-point test, actually assert containment: `expect(pointInOutline(poly, p)).toBe(true)` (import from `./geometry`).

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/model/faces.test.ts` — FAIL, module missing.

- [ ] **Step 3: Implement `faces.ts`**

Face walk (half-edge traversal):

```ts
export function extractFaces(state: {
	nodes: WallNode[];
	edges: WallEdge[];
}): Face[] {
	// 1. Directed half-edges: every edge yields (a→b) and (b→a).
	// 2. At each node, sort outgoing half-edges by atan2(dy, dx) of their
	//    direction (ascending).
	// 3. successor(u→v): find (v→u) in v's sorted outgoing list; take the
	//    NEXT entry in ascending-angle order (wrapping). Trace cycles by
	//    following successors until back at the start half-edge, marking
	//    half-edges used (each belongs to exactly one cycle).
	// 4. For each cycle, compute the shoelace sum of its node polygon; keep
	//    cycles with sum > 0 (the sample-winding sign; in y-down coords the
	//    unique outer cycle of each component carries the opposite sign).
	//    NOTE: if the rectangle test finds the interior arriving with a
	//    NEGATIVE sum, flip step 3 to the PREVIOUS entry instead — the test
	//    pins the convention; both bugs cannot hide.
	// 5. Skip cycles with |sum|/2 < 1e-4 m² and cycles that revisit an edge
	//    twice in the same direction (degenerate stubs traced both ways are
	//    normal and appear as area ~0 — the area filter drops them).
}
```

`faceLabelPoint`: area centroid (standard polygon centroid); if `pointInOutline(polygon, centroid)` is false (concave), scan the bbox on a 0.2 m lattice and return the inside sample nearest the centroid. Always returns a point inside for any polygon with area ≥ the face minimum.

`insetPolygon`: determine winding sign (shoelace); inward normal of each edge = `-outward`, where outward = `{ x: dir.y * sign, y: -dir.x * sign }` (the `buildWallSolids` convention, `src/lib/room-scene.ts:130`). Offset each edge's line inward by `inset`; each output vertex = intersection of consecutive offset lines (near-parallel consecutive edges, |cross| < 1e-9: use the offset point directly). Return null if any output is non-finite, the result's winding sign flips, or its area ≤ 0.

`sideOfPoint`: as specified in Interfaces.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/model/faces.test.ts` — PASS (8 tests).

- [ ] **Step 5: Check + commit**

```bash
pnpm check && pnpm test
git add src/lib/model/faces.ts src/lib/model/faces.test.ts
git commit -m "G2: face extraction, interior inset, label points"
```

---

### Task G3: Room identity — records, anchor matching, dormancy

**Files:**
- Create: `src/lib/model/room-match.ts`
- Test: `src/lib/model/room-match.test.ts`

**Interfaces:**
- Consumes: `Face`, `faceLabelPoint` from `./faces`; `pointInOutline` from `./geometry`.
- Produces:
  - `interface RoomRecord { id: string; name?: string; wallHeight?: number; anchor: Point }`
  - `interface MatchedRoom { record: RoomRecord; face: Face }`
  - `interface RoomMatchResult { matched: MatchedRoom[]; records: RoomRecord[] }` — `records` is the full updated registry: matched records with re-centered anchors, dormant records unchanged, new records appended. `matched` is in registry order.
  - `function matchRooms(records: RoomRecord[], faces: Face[], newRecordId?: () => string): RoomMatchResult`
  - `function nextRoomNameFrom(taken: Iterable<string | undefined>): string` — "Room N" not already taken, N starting at (count+1) like `nextRoomName` (`src/lib/model/floor.ts:105`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { extractFaces } from "./faces";
import { matchRooms } from "./room-match";

const rect = (x0: number, x1: number, prefix: string) => ({
	nodes: [
		{ id: `${prefix}a`, x: x0, y: 0 }, { id: `${prefix}b`, x: x1, y: 0 },
		{ id: `${prefix}c`, x: x1, y: 4 }, { id: `${prefix}d`, x: x0, y: 4 },
	],
	edges: [
		{ id: `${prefix}1`, a: `${prefix}a`, b: `${prefix}b` },
		{ id: `${prefix}2`, a: `${prefix}b`, b: `${prefix}c` },
		{ id: `${prefix}3`, a: `${prefix}c`, b: `${prefix}d` },
		{ id: `${prefix}4`, a: `${prefix}d`, b: `${prefix}a` },
	],
});
const twoFaces = () => {
	const l = rect(0, 5, "l");
	const r = rect(5, 9, "r"); // separate square sharing the x=5 line? No —
	// distinct nodes; two disjoint loops is fine for matching tests.
	return extractFaces({
		nodes: [...l.nodes, ...r.nodes],
		edges: [...l.edges, ...r.edges],
	});
};
let n = 0;
const nextId = () => `new-${n++}`;

describe("matchRooms", () => {
	it("matches records to the faces containing their anchors, re-centering anchors", () => {
		const faces = twoFaces();
		const records = [
			{ id: "kitchen", name: "Kitchen", anchor: { x: 7, y: 2 } },
			{ id: "living", name: "Living room", anchor: { x: 2, y: 2 } },
		];
		const result = matchRooms(records, faces, nextId);
		expect(result.matched.map((m) => m.record.id)).toEqual(["kitchen", "living"]);
		expect(result.records).toHaveLength(2);
		const kitchen = result.matched[0];
		// Anchor re-centered into its face (the 5..9 rectangle).
		expect(kitchen.record.anchor.x).toBeGreaterThan(5);
	});

	it("creates auto-named records for unclaimed faces", () => {
		const result = matchRooms([], twoFaces(), nextId);
		expect(result.matched).toHaveLength(2);
		expect(result.records.map((r) => r.name)).toEqual(["Room 1", "Room 2"]);
	});

	it("keeps a record whose face vanished (dormant) and revives it on reclose", () => {
		const dormant = { id: "kitchen", name: "Kitchen", wallHeight: 3, anchor: { x: 7, y: 2 } };
		const gone = matchRooms([dormant], [], nextId);
		expect(gone.matched).toHaveLength(0);
		expect(gone.records).toEqual([dormant]);
		const back = matchRooms(gone.records, twoFaces(), nextId);
		const kitchen = back.matched.find((m) => m.record.id === "kitchen");
		expect(kitchen?.record.name).toBe("Kitchen");
		expect(kitchen?.record.wallHeight).toBe(3);
	});

	it("two anchors in one face: first in registry order wins, the other goes dormant", () => {
		const faces = extractFaces(rect(0, 5, "l"));
		const result = matchRooms(
			[
				{ id: "first", name: "First", anchor: { x: 1, y: 1 } },
				{ id: "second", name: "Second", anchor: { x: 4, y: 3 } },
			],
			faces,
			nextId,
		);
		expect(result.matched.map((m) => m.record.id)).toEqual(["first"]);
		expect(result.records.map((r) => r.id)).toEqual(["first", "second"]);
	});
});
```

- [ ] **Step 2: Run tests, verify they fail** — `pnpm vitest run src/lib/model/room-match.test.ts`, module missing.

- [ ] **Step 3: Implement `room-match.ts`**

```ts
export function matchRooms(
	records: RoomRecord[],
	faces: Face[],
	newRecordId: () => string = () => crypto.randomUUID(),
): RoomMatchResult {
	// Pass 1: for each record in order, claim the first unclaimed face whose
	// polygon contains its anchor (pointInOutline, tolerance 0).
	// Pass 2: each unclaimed face gets a new record:
	//   { id: newRecordId(), name: nextRoomNameFrom(all record names so far),
	//     anchor: faceLabelPoint(face.polygon) }.
	// Matched records: anchor := faceLabelPoint(face.polygon) (new object
	// only when it actually moved — preserve reference-equality no-ops).
	// records out: original order with updated anchors, dormant unchanged,
	// new records appended in face order. matched: registry order.
}
```

- [ ] **Step 4: Run tests, verify they pass** — 4 tests PASS.

- [ ] **Step 5: Check + commit**

```bash
pnpm check && pnpm test
git add src/lib/model/room-match.ts src/lib/model/room-match.test.ts
git commit -m "G3: room identity — anchor matching with dormancy"
```

---

### Task G4: The flip — graph-backed Floor, derived-rooms bridge, persistence v6, sample fixture

The compile-breaking swap. After this task the app renders and edits furniture/openings exactly as before (through the bridge), **draw-mode editing is disabled** (view-only; G5 rebuilds it — say so in the commit message). This is the biggest task; it is one session because it cannot be split without a broken build.

**Files:**
- Modify: `src/lib/model/types.ts` — new `Floor`, `Opening` → rename to `RoomOpening`, new edge-based `Opening`, new `WallMount`, `Room` keeps its shape (now a *derived* view type; update its doc comment).
- Create: `src/lib/model/derived.ts` + `src/lib/model/derived.test.ts`
- Modify: `src/lib/model/graph.ts`, `room-match.ts` — move `GraphOpening`/`RoomRecord` type definitions into `types.ts`, import back (single source of truth; `Opening = GraphOpening` collapses into one name).
- Modify: `src/lib/model/floor.ts` (+ its test) — helpers take derived rooms; `updateDerivedRoom` write-back; delete `reparentFurniture` and `addRoom`.
- Modify: `src/lib/model/sample-room.ts` (+ test) — graph fixture.
- Modify: `src/lib/model/wall-mount.ts`, `src/lib/mount-place.ts` (+ tests) — mounts go edge-based directly (no bridge): `WallMount { edgeId, offset, side, elevation }`.
- Modify: `src/lib/persistence.ts` (+ test) — v6.
- Modify: `src/routes/index.tsx`, `src/components/*` — consume `deriveFloor`; disable draw editing.
- Modify: `src/lib/model/index.ts` — export `graph`, `faces`, `room-match`, `derived`.

**Interfaces:**
- Consumes: everything from G1–G3.
- Produces:
  - `Floor { name?: string; nodes: WallNode[]; edges: WallEdge[]; openings: Opening[]; furniture: FurnitureItem[]; rooms: RoomRecord[] }` (types.ts)
  - `Opening` (edge-based, the former `GraphOpening` shape); `RoomOpening { id; kind; wallIndex: number; offset: number; width: number; hinge?: "start" | "end" }` (the old shape, now derived-only)
  - `WallMount { edgeId: string; offset: number; side: 1 | -1; elevation: number }`
  - derived.ts:
    - `interface WallRef { edgeId: string; side: 1 | -1 }`
    - `interface DerivedRoom extends Room { wallRefs: WallRef[]; face: Face }` — `outline` = interior polygon (`insetPolygon(face.polygon, WALL_THICKNESS / 2)`; faces whose inset is null are skipped), `openings: RoomOpening[]`, `furniture` partitioned by center containment.
    - `interface DerivedFloor { rooms: DerivedRoom[]; unassignedFurniture: FurnitureItem[]; faces: Face[] }`
    - `function deriveFloor(floor: Floor): DerivedFloor`
    - `function reconcileFloor(floor: Floor): Floor` — `normalizeGraph` over `{nodes, edges, openings}` + `matchRooms` writing the updated registry into `floor.rooms`; same reference when nothing changed. **Every mutation path ends here.**
    - `function updateDerivedRoom(floor: Floor, derived: DerivedFloor, roomId: string, fn: (room: Room) => Room): Floor` — write-back diff (below).
    - `function edgeOffsetOf(floor: Floor, ref: WallRef, room: DerivedRoom, wallIndex: number, wallOffset: number, width: number): number` — projects a wall-local opening span back onto the edge (project the opening's world near-edge point onto a→b; when the derived wall runs opposite to a→b, mirror: `edgeOffset = proj - width` adjusted so the span is `[min, min+width]`).

- [ ] **Step 1: Write the failing derived-bridge tests**

`derived.test.ts` — the load-bearing cases:

```ts
// Fixture: two rooms sharing a full-height edge (6 nodes, 7 edges):
// nodes A(-0.05,-0.05) B(6.4,-0.05) C(9.45,-0.05) D(9.45,5.25) E(6.4,5.25) F(-0.05,5.25)
// edges AB BC CD DE EF FA and the shared edge BE.
// records: living (anchor 3,2.5), kitchen (anchor 8,2.5).
// openings: door on BE (offset 3.65, width 0.95, side toward living),
//           window on AB (offset 3.55, width 2.1, side toward living).
// furniture: one desk at (2,2) in living, one plant at (8,4) in kitchen,
//           one stray stool at (20,20) (unassigned).
```

Tests:
1. `deriveFloor` yields 2 rooms; living `outline` equals `[{0,0},{6.35,0},{6.35,5.2},{0,5.2}]` (interior inset; shared wall at centerline 6.4 → interior 6.35). Kitchen outline `[{6.45,0},{9.4,0},{9.4,5.2},{6.45,5.2}]`.
2. Each room's `openings` carry `wallIndex`/`offset` mapped onto its outline: living door lands on the wall whose x ≈ 6.35, offset ≈ 3.6; window on the y=0 wall, offset ≈ 3.5. `wallRefs[wallIndex].edgeId` names the right edge.
3. Furniture partition: desk → living, plant → kitchen, stool → `unassignedFurniture`.
4. `updateDerivedRoom` furniture diff: `fn` = move the desk → `floor.furniture` updated, same ids elsewhere; `fn` = identity → **same floor reference**.
5. `updateDerivedRoom` opening diff: `fn` = `moveOpening(room, doorId, 2.0)` (from `./openings`) → the stored edge opening's `offset` changes accordingly (≈ 2.05 in edge coords).
6. `updateDerivedRoom` name/height: `fn` = `setRoomName(room, "Lounge")` → `floor.rooms` record renamed; `wallHeight` likewise.
7. `reconcileFloor` on a floor whose registry is empty creates records for both faces ("Room 1"/"Room 2"); on an already-reconciled floor returns the same reference.

Write these as real code against the fixture above (~120 lines); import the pure per-room setters (`moveOpening`, `setRoomName`) so the diffing is exercised through the exact functions the route uses.

- [ ] **Step 2: Run, verify they fail** — `pnpm vitest run src/lib/model/derived.test.ts`.

- [ ] **Step 3: Flip the types and implement `derived.ts`**

types.ts changes (exact):
- Rename `Opening` → `RoomOpening` (keep fields; drop nothing). Fix all imports (`pnpm check` + `tsc` drive the tour: openings.ts, opening-place.ts, plan-openings.tsx, persistence, scenes, tests).
- Move `GraphOpening` from graph.ts into types.ts under the name `Opening`; graph.ts re-imports (`import type { Opening } from "./types"`), keeps `GraphState`.
- Move `RoomRecord` into types.ts; room-match.ts imports it.
- Replace `WallMount` with the edge-based shape; replace `Floor` with the graph shape; update `Room`'s doc comment ("a derived view of one face — never stored; produced by `deriveFloor`").

`deriveFloor` implementation order: `extractFaces` → `matchRooms(floor.rooms, faces)` (matched only — do **not** write records here; unclaimed faces get fallback records `{ id: "face:" + face.nodeIds.join("|"), anchor: faceLabelPoint(...) }` so React keys stay stable even if a caller skipped reconcile) → per matched face: inset outline, wallRefs (`side = sideOfPoint(a, b, faceLabelPoint)` per boundary edge, oriented so `wallRefs[i]` pairs with outline wall `i`), openings mapped in (opening belongs to the room on its `side` of its edge; offset mapped by projecting the opening's world span onto the outline wall and clamping), furniture partition by `pointInOutline(outline, item.position)` — first containing room wins, else unassigned.

`updateDerivedRoom` diff rules:
- furniture: diff `next.furniture` vs `room.furniture` by id → apply to `floor.furniture` (replace changed — including `mount` (already edge-based) and `stack` — remove missing, append added).
- openings: diff `next.openings` vs `room.openings` by id. Changed offset/width/hinge → rewrite the stored opening via `edgeOffsetOf`; removed → drop from `floor.openings`; added → map through `wallRefs[opening.wallIndex]`, `side` = the wallRef's side.
- `name`/`wallHeight` → update the `RoomRecord` (delete the field when unset, matching `setRoomWallHeight` semantics).
- outline: ignored (post-G5 nothing mutates it through this path).
- Any change → finish with `reconcileFloor`; no change → same reference.

wall-mount.ts / mount-place.ts port (edge-based, no bridge):
- `wallFrames(outline)` (outline-based) survives for **derived** consumers that only render; but mounts now anchor to edges: rewrite `deriveMountTransform(mount, floor)` to read the edge's nodes, direction, and `side` normal — position = point at `offset + width/2` along a→b, pushed `WALL_THICKNESS/2 + depth/2` toward `side`; rotation faces away from the wall (port the existing math from `wall-mount.ts:94`, replacing the room-frame inputs with edge inputs).
- `mountAt(floor, point, footprint, elevation)`: candidates = every edge; choose nearest edge whose length fits the item width, `side` = `sideOfPoint(a, b, point)`; quantize offset like today. `mountAcrossRooms`/`reanchorMount` collapse into this (single graph — no cross-room variant needed); update `move-drag.tsx`/`placement` call sites and the tests to the new signatures.

persistence.ts: `STORAGE_VERSION = 6`, `READABLE_VERSIONS = new Set([6])`; delete all pre-v6 migration branches; validate: node ids unique + finite coords; edge ids unique, endpoints exist, `a !== b`; openings (edge exists, side ±1, `0 ≤ offset`, `offset + width ≤ edgeLength + 1e-6`); rooms (unique ids, finite anchor, `wallHeight` in range when present); furniture as today with the new mount shape. On read, finish with `reconcileFloor`.

sample-room.ts → the graph fixture from Step 1's comment block (nodes A–F + BE), all current furniture from both rooms concatenated into `floor.furniture` (nudge any item whose footprint now crosses an interior boundary — the fixture test asserts every item's center lands in a room and `overlappingFurnitureIds` is quiet), openings as listed, records named "Living room"/"Kitchen". Keep `createSampleFloor(): Floor`; delete `createSampleRoom`/`createSampleKitchen`. Update `sample-room.test.ts`: 2 faces, portal edge `BE` bounds both, window on an exterior edge, areas via `floorArea(derived outline)`.

Route + components sweep (mechanical; the compiler is the checklist):
- `src/routes/index.tsx`: `const derived = useMemo(() => deriveFloor(floor), [floor])`; every `floor.rooms` read → `derived.rooms`; `setRoom`/`previewRoom`/`nudgeSelected` wrappers → `updateDerivedRoom(floor, derived, roomId, fn)`; `roomById`/`roomAtPoint`/`roomOfFurniture`/`roomOfOpening` (floor.ts) change signature to take `rooms: Room[]` — pass `derived.rooms`; `nextRoomName(floor)` → `nextRoomNameFrom(floor.rooms.map((r) => r.name))`; settings popover name/height flow through `updateDerivedRoom`; "New room" resets to `reconcileFloor(emptyFloor())` where `emptyFloor()` = one empty graph + empty registry, then enters draw mode (which is view-only until G5 — acceptable for one task).
- Draw mode: keep the lens rendering derived outlines; stub the pointer handlers behind a `const DRAW_EDITING_DISABLED = true` guard with a `// G5 rebuilds these on the graph` comment; `emptyOutlineDraft`/draft state stay compiling but inert.
- seams/portals (`floorSeams(derived.rooms)`, `floorPortals`) keep working unchanged — derived outlines sit back-to-back (`gap = WALL_THICKNESS`) at shared edges, which `seams.ts` already renders as one wall.

- [ ] **Step 4: Full suite green**

Run: `pnpm test` then `pnpm check`. Update every test that constructed a `Floor`/`Opening`/`WallMount` literal (grep `wallIndex` outside derived/scene contexts). Expected: all suites PASS, Biome clean.

- [ ] **Step 5: Headless verification**

`pnpm build`, then a Playwright script (see the `verify` skill) asserting: fresh load renders both rooms + portal door + furniture (screenshot); click-select a desk in 2D and arrow-nudge it (inspector POS changes, one undo step); drag the shared-wall door along its wall; rename the room via settings → header updates; reload → v6 payload hydrates (localStorage `version === 6`); a seeded v5 payload is discarded (fresh sample loads); zero page errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib src/routes src/components
git commit -m "G4: graph-backed Floor behind a derived-rooms bridge (draw editing disabled until G5)"
```

---

### Task G5: Draw mode on the graph — the headline behaviors

**Files:**
- Create: `src/lib/graph-edit.ts` + `src/lib/graph-edit.test.ts`
- Modify: `src/components/draw-scene.tsx`, `src/components/draw-hint-bar.tsx`, `src/routes/index.tsx`
- Modify: `src/lib/draw.ts` (+ test) — snap targets come from the graph
- Delete: `src/lib/outline-edit.ts`, `src/lib/outline-edit.test.ts`

**Interfaces:**
- Consumes: G1–G4 exports; `History` preview/settle (`src/lib/history.ts`); `quantizeToStep`, `DRAW_GRID_STEP` from `./draw`.
- Produces (all pure, `Floor → Floor`, every one ending in `reconcileFloor`; unknown ids → same reference):
  - `moveNodePreview(floor: Floor, nodeId: string, point: Point): Floor` — raw move, **no** normalize (a mid-drag weld would be irreversible mid-gesture)
  - `settleNodeMove(floor: Floor, nodeId: string, point: Point): Floor` — move + reconcile (weld happens here); openings on touched edges re-fit by reconcile
  - `snapNodeDrag(floor: Floor, nodeId: string, cursor: Point, tolerance: number, snap: boolean): { point: Point; guides: { nodeId: string; axis: "x" | "y" }[] }` — port of `snapCornerDrag` (`outline-edit.ts:100`) against **all other nodes**, grid quantize on free axes, raw pass-through when `snap` is false
  - `addWallSegment(floor: Floor, from: Point, to: Point): Floor` — for each endpoint reuse a node within `NODE_MERGE_TOLERANCE` else create one; add the edge; reconcile (landing on an edge splits it)
  - `splitEdgeAt(floor: Floor, edgeId: string, point: Point): Floor` — projection quantized along the edge, refused within `SPLIT_CORNER_CLEARANCE = 0.25` of either end (port `splitPointOnWall`, `outline-edit.ts:148`)
  - `deleteEdge(floor: Floor, edgeId: string): Floor` — edge + its openings out; reconcile drops orphaned nodes
  - `deleteNode(floor: Floor, nodeId: string): Floor` — degree 2: replace both edges with one a→c, re-projecting their openings onto it by world center (port the `removeOutlineCorner` slide logic, `outline-edit.ts:285`, using `slideOpening`); any other degree: node + incident edges + their openings out
  - `setEdgeLength(floor: Floor, edgeId: string, length: number, fixed: "a" | "b"): Floor` — moves the free node along the edge direction; invalid/≤0 lengths → same reference

- [ ] **Step 1: Write the failing tests** — the contract cases, as real code against a two-rooms-sharing-an-edge fixture (reuse G4's test fixture via a shared `src/lib/model/test-fixtures.ts` helper, exported for tests only):

1. `settleNodeMove` on a shared node: **both** faces' derived outlines change; areas update; records keep their ids (identity stable through reshape).
2. `settleNodeMove` dragging node X onto node Y's position: nodes weld (count drops by 1), edges rewire, no duplicate edges.
3. `moveNodePreview` does not weld at the same position (count unchanged).
4. `addWallSegment` chain a→b→c→d→a (4 calls): one new face appears; a record is auto-created ("Room N").
5. `addWallSegment` ending on an existing edge's interior: that edge splits (T-junction).
6. `deleteEdge` on the shared edge: faces merge 2 → 1; the record whose anchor lies in the merged face survives as its identity; the other goes dormant (still in `floor.rooms`); the shared edge's door opening is gone.
7. `deleteNode` degree-2: two collinear edges merge, a window on the far edge keeps its world position (offset re-projected).
8. `setEdgeLength` moves the `b`-side node and drags the attached perpendicular wall's corner with it (assert the neighbor edge's far node unchanged, near node moved).
9. `snapNodeDrag` locks x to another node's x within tolerance and quantizes free y; `snap=false` passes the cursor through.

- [ ] **Step 2: Run, verify they fail** — `pnpm vitest run src/lib/graph-edit.test.ts`.

- [ ] **Step 3: Implement `graph-edit.ts`** — each op is 10–40 lines over G1 helpers; every mutation clones only what changes and finishes `reconcileFloor(next)`; preserve the same-reference no-op contract.

- [ ] **Step 4: Run tests, verify they pass** — then `pnpm test` for the suite.

- [ ] **Step 5: Rewire draw mode (route + draw-scene)**

Route (`src/routes/index.tsx`):
- Delete the `OutlineDraft` state, `applyDraft`, draft-seeding effects, and the `DRAW_EDITING_DISABLED` guard from G4. Delete the "history sits out draw mode" carve-outs (`src/routes/index.tsx:170-171` area): undo/redo now stay active in draw mode.
- New session state: `const [chainNode, setChainNode] = useState<string | null>(null)` (wall tool: the id of the chain's last node; null = no chain).
- Handlers wired into `draw-scene.tsx`:
  - **select tool, pointer-down on a node handle:** start a drag session — snapshot the floor; each move `previewHistory(floor → moveNodePreview(…, snapNodeDrag(…).point))`; release `settleHistory` after `settleNodeMove`; esc mid-drag restores the snapshot via preview + settle (no history step).
  - **select tool, click on an edge (not a node):** `commitHistory(splitEdgeAt(...))`, then immediately begin dragging the new node (match today's split-then-drag feel).
  - **wall tool, click:** no chain → snap the point (`snapDraftPoint` reworked, below), remember it; with a pending point/chain → `commitHistory(addWallSegment(floor, last, next))` (one undo step per wall), `setChainNode` to the landed node id (find it by proximity post-reconcile). Esc/⏎/double-click ends the chain (no-op on the floor).
  - **rect tool, two clicks:** compose the four `addWallSegment` calls into ONE floor value, single `commitHistory` (one undo step per rectangle). Reuse `rectangleOutline` (`src/lib/draw.ts:324`) for the corner math, then hand off to Select as today.
  - **length pill commit:** `commitHistory(setEdgeLength(floor, edgeId, value, fixedEnd))` where `fixedEnd` is the end nearer the pill's wall start (keep today's "the far corner moves" behavior).
  - **node delete** (keyboard delete with a node focused/hovered, matching the current corner-delete gesture in draw-scene): `commitHistory(deleteNode(...))`. Add **edge delete**: delete with an edge hovered and no node → `commitHistory(deleteEdge(...))`.
- `draw.ts`: replace `snapTargetsOf(rooms)` with `snapTargetsOfGraph(floor)` — corners = nodes, walls = edges (as `SnapWall`s with start/end from nodes); `snapDraftPoint`'s wall-slab attach logic keys off centerlines now (a new wall landing on an existing wall line should land **on** the centerline, not offset by `WALL_THICKNESS` — delete the outer-face push in `targetAxisCandidate`/`pointAlongWall` semantics; welding replaces attaching).
- `draw-scene.tsx`: render every edge as a centerline stroke + node handles + per-edge length pills; face labels/areas from `derived.rooms`; dangling edges render like any other (this lens is now the whole graph, honestly).
- `draw-hint-bar.tsx`: copy updates — "Click to chain walls · click a wall to split · drag corners anywhere · esc ends the chain".

- [ ] **Step 6: Headless verification (the acceptance test for the whole phase)**

`pnpm build` + Playwright script:
1. Fresh sample → draw mode → drag the shared corner E (6.4, 5.25): **both room outlines deform**, both area labels change, one ⌘Z restores both.
2. Drag a T-junction-free exterior corner: only its room reshapes.
3. Wall tool: three clicks in empty canvas → two walls exist, no new room label; reload → they persist.
4. Continue the chain to close a rectangle → a "Room 3" label with area appears the moment it closes.
5. Drag one open-chain endpoint onto an existing corner → weld (drag the welded corner: everything moves together).
6. Length pill on a shared wall → both rooms resize.
7. ⌘Z ×N walks each step back individually; zero page errors.

- [ ] **Step 7: Check + commit**

```bash
pnpm check && pnpm test
git add -A src/lib src/routes src/components
git commit -m "G5: draw mode edits the wall graph live — shared corners, open chains, weld"
```

---

### Task G6: Scenes read the graph — one solid per edge, dangling walls visible, seams deleted

**Files:**
- Modify: `src/lib/room-scene.ts` (+ test) — `buildWallSolids(room, …)` → `buildEdgeSolids(floor: Floor, derived: DerivedFloor): WallSolid[]`
- Modify: `src/components/room-scene.tsx`, `src/components/plan-scene.tsx`, `src/lib/plan-scene.ts` (+ tests), `src/components/plan-openings.tsx`, `src/lib/opening-place.ts` (+ test)
- Delete: `src/lib/seams.ts`, `src/lib/seams.test.ts`
- Modify: `src/routes/index.tsx` — portal label from edge faces; drop `floorSeams`/`floorPortals` imports

**Interfaces:**
- Consumes: `DerivedFloor` (faces per edge side), `WallSolid`/`WallPiece` shapes (kept — the renderer's contract).
- Produces:
  - `WallSolid` gains `edgeId: string` and loses seam fields; `line` start/end = the edge's nodes (centerline); `outward` = the normal toward the face-less side when exactly one side has a face, else the `+1` (`sideOfPoint`-positive) normal; solids are extruded `WALL_THICKNESS / 2` to **both** sides of the line (adjust `wallPieces`/mesh building accordingly — this replaces the outward-extrude + seam-halving arithmetic).
  - `buildEdgeSolids(floor, derived): WallSolid[]` — one solid per edge; holes = every opening on that edge (both sides) in edge-local offsets (doors full height, windows sill-to-head, exactly today's `cutHole` rules, `src/lib/room-scene.ts:139`); wall height = max `wallHeightOf` across the edge's adjacent rooms, `DEFAULT_WALL_HEIGHT` for none.
  - `stubSpans`/occlusion: an edge with **two** adjacent faces always stubs (it always occludes one of its rooms — replaces the seam-span rule); one/zero faces keep the camera-facing test.
  - `openingAt`/`offsetAlongWall` (opening-place.ts) read `WallSolid.edgeId` and return `{ edgeId, offset, width, side }` placements — the `RoomOpening` bridge mapping in `updateDerivedRoom` (G4) is **deleted**; opening mutations (move/resize/flip/place) now go through small floor-level setters added to `src/lib/model/openings.ts` (`moveFloorOpening`, `resizeFloorOpening`, `flipFloorOpeningHinge`, `flipFloorOpeningSide`, `removeFloorOpening`, `addFloorOpening` — each `Floor → Floor`, same-reference no-ops, `slideOpening` for gap logic).

- [ ] **Step 1: Write failing tests for `buildEdgeSolids` + stub rule** — shared edge yields ONE solid carrying the portal door hole; exterior edge yields a solid with its window; dangling edge yields a plain solid; two-face edge reports "always stub"; per-side heights: rooms at 2.5 and 3.2 → solid height 3.2.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement + rewire renderers** — `room-scene.tsx` iterates `buildEdgeSolids` output instead of per-room `buildWallSolids` (corner posts come from nodes: one post per node, covered-check against incident edges); floor slabs/labels/area cards already come from derived rooms (unchanged since G4); `plan-scene.tsx`/`plan-openings.tsx` draw wall rects per solid and door swings toward `opening.side`'s face; add the side-flip button next to flip-hinge in the opening chip (calls `flipFloorOpeningSide`; hidden when the edge has faces on both sides — a portal door swings into either room legitimately — actually **shown** exactly then, hidden when only one side has a room). Delete `seams.ts`; `portalLabel` reimplemented in derived.ts from edge face-adjacency ("Living room ↔ Kitchen" when an opening's edge has two rooms).

- [ ] **Step 4: Suite green** — `pnpm test`, `pnpm check`. The seams tests are deleted with the module; grep `floorSeamData|SeamSpan|NeighborWalls` to confirm nothing dangles.

- [ ] **Step 5: Headless verification** — 3D: open wall chain drawn in G5's flow is **visible as real walls** in 3D and 2D; shared wall renders once (no z-fighting, screenshot diff against G4 baseline is near-identical for the sample); portal door + stub behavior at two orbit angles; set kitchen ceiling 3.2 → shared wall renders tall side. Zero page errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib src/components src/routes
git commit -m "G6: scenes render the graph — one solid per edge, seams.ts retired"
```

---

### Task G7: Furniture policy, unassigned items, cleanup, PROGRESS

**Files:**
- Modify: `src/lib/collision.ts` (+ test), `src/lib/place.ts` (+ test), `src/components/room-scene.tsx`, `src/components/plan-scene.tsx`, `src/components/move-drag.tsx`, `src/components/inspector.tsx`, `src/components/status-bar.tsx`, `src/routes/index.tsx`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `DerivedFloor`, `buildEdgeSolids`.
- Produces:
  - `edgeWallObstacles(floor: Floor): Obstacle[]` (place.ts) — one obstacle slab per edge (centerline ± `WALL_THICKNESS/2`), replacing `outlineWallObstacles` in every placement/drag/nudge path.
  - `containFurniture`/`nudgeFurniture` (collision.ts): the outline clamp is replaced by wall-solid collision — an item may sit anywhere its footprint intersects no wall slab; dropping/nudging into un-roomed space is legal.

- [ ] **Step 1: Failing tests** — `nudgeFurniture` pushes an item up to a wall slab and stops (both from inside a room and in open space); an item nudged through a doorway gap passes (opening spans carry no slab at floor level for doors — windows keep theirs); placement drop outside every room succeeds and the item appears in `unassignedFurniture`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — scenes render `derived.rooms[*].furniture` **plus** `unassignedFurniture` (same meshes/footprints; selection, chip, inspector all work by item id already); inspector's room-name line reads derived membership ("—" when unassigned); status bar object count = `floor.furniture.length`. Remove the last `pointInOutline`-clamp branches from move/nudge/rotate paths (grep `containRoomFurniture` consumers; its re-contain semantic becomes wall-collision resolution: on collision, keep the pre-mutation position — same UX as today's clamp).

- [ ] **Step 4: Suite green + full check** — `pnpm test && pnpm check`.

- [ ] **Step 5: Final headless sweep** — drag a chair out through the sample's portal doorway into the kitchen (membership readout flips), then out into open canvas (renders, selectable, "—" room); draw a free wall and butt furniture against it (stops at the slab); full-phase regression: G4/G5/G6 verification scripts re-run green against the final build.

- [ ] **Step 6: Update PROGRESS.md** — mark Phase 9 complete (all boxes checked, verified date); the old Phase 8's W2/W3 already carry their "subsumed by Phase 9" strike-through from planning.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib src/components src/routes PROGRESS.md
git commit -m "G7: floor-level furniture with wall-solid collision; Phase 9 complete"
```
