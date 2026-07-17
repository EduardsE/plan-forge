/**
 * Plain-data floor model. Rendering-agnostic: no three.js, no React, no DOM.
 *
 * Conventions:
 * - All lengths are in meters (the cm/m units toggle is a display concern).
 * - Points are 2D plan coordinates; heights are separate scalars.
 * - The floor is a planar **wall graph** — nodes (corners/T-junctions) joined
 *   by edges (wall runs) — plus edge-anchored openings and floor-level
 *   furniture. Rooms are *derived* as the graph's faces (`deriveFloor` in
 *   `model/derived.ts`); their names/ceiling heights live in anchor-matched
 *   `RoomRecord`s.
 */

import type { WallEdge, WallNode } from "./graph";

export interface Point {
  x: number;
  y: number;
}

/**
 * A wall segment derived from a room outline: from `corners[index]` to
 * `corners[(index + 1) % corners.length]`. Walls of a *derived* room outline;
 * derive them with `wallsOf`.
 */
export interface Wall {
  index: number;
  start: Point;
  end: Point;
}

export type OpeningKind = "door" | "window";

/**
 * A door or window cut into a graph **edge**, located along that edge's a→b
 * direction. The stored, floor-level opening shape — rendering and editing
 * read it directly in edge coordinates (`buildEdgeSolids`, the floor-level
 * setters in `model/openings.ts`); nothing converts it to a per-room shape.
 */
export interface Opening {
  id: string;
  kind: OpeningKind;
  /** Id of the host `WallEdge`. */
  edgeId: string;
  /** Distance from the edge's node `a` to the opening's near edge, along a→b. */
  offset: number;
  width: number;
  /**
   * Windows only: height of the hole's lower edge above the floor. Absent
   * means the default (`WINDOW_SILL`); doors always start at the floor.
   * Effective values come from `openingVerticals` (model/openings.ts).
   */
  sill?: number;
  /**
   * Height of the hole's upper edge above the floor. Absent means the default
   * (`DOOR_HEIGHT` / `WINDOW_HEAD`).
   */
  head?: number;
  /** Doors only: which edge carries the hinge (near edge = `"start"`). */
  hinge?: "start" | "end";
  /**
   * Face the door swings toward / the opening belongs to: the sign of the
   * cross product `(b-a) × (p-a)` for a point `p` on that side (see
   * `sideOfPoint`, faces.ts).
   */
  side: 1 | -1;
}

/**
 * A door or window on a *derived* room's outline wall — the shape the door/
 * window tools and scenes work with. Never stored: `deriveFloor` produces it
 * from a graph `Opening`, and `updateDerivedRoom` maps edits back onto the
 * edge.
 */
export interface RoomOpening {
  id: string;
  kind: OpeningKind;
  /** Index of the host wall (see `Wall.index`). */
  wallIndex: number;
  /** Distance from the host wall's start corner to the opening's near edge. */
  offset: number;
  width: number;
  /**
   * Doors only: which edge of the opening carries the hinge — the near edge
   * (`"start"`, the default) or the far edge. Doors always swing into the
   * room.
   */
  hinge?: "start" | "end";
}

/** Axis-aligned size of a furniture item before rotation. */
export interface Footprint {
  width: number;
  depth: number;
  height: number;
}

/**
 * A wall-mounted item's anchor (picture frames, clocks), anchored to a graph
 * **edge**: a near-edge `offset` along the edge's a→b direction, the `side`
 * of the edge it hangs on, and a vertical `elevation` for the mount's center.
 * When present on a `FurnitureItem`, the item's `position` and `rotation` are
 * *derived* from the edge (kept in sync by `deriveFloor`), so the footprint
 * sits flush against the wall's interior face; renderers hang the body at
 * `elevation`.
 */
export interface WallMount {
  /** Id of the host `WallEdge`. */
  edgeId: string;
  /** Distance from the edge's node `a` to the mount's near edge, along a→b. */
  offset: number;
  /** Which side of the edge the mount hangs on (`sideOfPoint` sign). */
  side: 1 | -1;
  /** Height of the item's center above the floor, meters. */
  elevation: number;
}

/**
 * A stacked item's anchor (table lamp on a desk, plant on the credenza): the
 * hosting item's id plus the rider's center offset from the host's center, in
 * the host's *unrotated* local frame. When present on a `FurnitureItem`, the
 * item's `position` is derived from the host (kept in sync by
 * `deriveStackPosition`), and renderers lift the body onto the host's top
 * surface. Hosts are floor-standing flat-topped items — a host is never
 * itself stacked or mounted, so stacks are one level deep.
 */
export interface Stack {
  /** Id of the hosting `FurnitureItem`. */
  hostId: string;
  /** Rider-center offset from the host center along the host's width axis. */
  dx: number;
  /** Rider-center offset from the host center along the host's depth axis. */
  dy: number;
}

export interface FurnitureItem {
  id: string;
  /** Reference into the furniture catalog (name, thumbnail, etc. live there). */
  catalogId: string;
  /** Center of the footprint on the floor plane. */
  position: Point;
  /** Rotation about the footprint center, in degrees counter-clockwise. */
  rotation: number;
  footprint: Footprint;
  /**
   * Wall anchor for wall-mounted items; absent for floor-standing furniture.
   * When set, `position`/`rotation` are derived from it and the edge.
   */
  mount?: WallMount;
  /**
   * Host anchor for items standing on top of other furniture; absent for
   * floor-standing items. When set, `position` is derived from the host.
   * Never combined with `mount`.
   */
  stack?: Stack;
  /**
   * Optional material override: a `#rrggbb` colorway replacing the item's
   * default body tone (the inspector's MATERIAL swatches). Absent = the
   * catalog default. Only the 3D lens tints the body from it.
   */
  colorway?: string;
}

/**
 * Persistent room identity, independent of the graph's current faces: a room's
 * name and ceiling height survive edits that don't change its shape, and a
 * record whose face momentarily disappears (mid-edit) goes dormant rather than
 * vanishing. `matchRooms` reconciles the registry against the current faces by
 * anchor containment.
 */
export interface RoomRecord {
  id: string;
  name?: string;
  wallHeight?: number;
  /** Point last known to lie inside this room's face; re-centered on every
   * successful match and used to find the room again next time. */
  anchor: Point;
}

/**
 * A **derived** view of one graph face — never stored; produced by
 * `deriveFloor`. Carries the interior outline (the face inset by half a wall
 * thickness, sitting exactly where per-room outlines used to), the openings
 * on its walls, and the furniture whose center it contains. The per-room pure
 * setters (`furniture.ts`, `openings.ts`, `room.ts`) operate on this shape;
 * `updateDerivedRoom` diffs their result back onto the graph.
 */
export interface Room {
  /**
   * Stable identity within the floor — the matched `RoomRecord.id` (or a
   * fallback `"face:…"` id for an unclaimed face). Selections and helpers
   * address a room by this id across mutations.
   */
  id: string;
  /** Display name, e.g. "Living room". */
  name?: string;
  /**
   * Wall/ceiling height in meters; absent means the default (see
   * `DEFAULT_WALL_HEIGHT` in `model/room.ts`). Kept within
   * [MIN_WALL_HEIGHT, MAX_WALL_HEIGHT] by `setRoomWallHeight`.
   */
  wallHeight?: number;
  /** Ordered corners of the closed (derived) room outline. */
  outline: Point[];
  openings: RoomOpening[];
  furniture: FurnitureItem[];
}

/**
 * A floor plan as a planar wall graph in one plan coordinate space. `nodes`
 * and `edges` are the wall runs; `openings` are edge-anchored; `furniture`
 * lives floor-level (partitioned into rooms by center containment on derive);
 * `rooms` is the identity registry (names/heights) matched to the graph's
 * faces. The floor is the unit of app state: history and persistence hold a
 * `Floor`; `deriveFloor` turns it into renderable rooms.
 */
export interface Floor {
  /** Display name, e.g. "Loft apartment". */
  name?: string;
  nodes: WallNode[];
  edges: WallEdge[];
  openings: Opening[];
  furniture: FurnitureItem[];
  rooms: RoomRecord[];
}

/** Axis-aligned bounding box of an outline. */
export interface Bounds {
  min: Point;
  max: Point;
  width: number;
  height: number;
}
