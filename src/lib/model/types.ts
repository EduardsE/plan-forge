/**
 * Plain-data room model. Rendering-agnostic: no three.js, no React, no DOM.
 *
 * Conventions:
 * - All lengths are in meters (the cm/m units toggle is a display concern).
 * - Points are 2D plan coordinates; heights are separate scalars.
 * - The room outline is a closed polygon given as an ordered corner list —
 *   the wall from the last corner back to the first is implied, never stored.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * A wall segment derived from the outline: from `corners[index]` to
 * `corners[(index + 1) % corners.length]`. Walls are never stored on the
 * room; derive them with `wallsOf`.
 */
export interface Wall {
  index: number;
  start: Point;
  end: Point;
}

export type OpeningKind = "door" | "window";

/** A door or window cut into a wall, located along that wall's direction. */
export interface Opening {
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
 * A wall-mounted item's anchor (picture frames, clocks). Located on a wall
 * like an `Opening` — host wall index plus a near-edge offset along it — with
 * a vertical `elevation` for the mount's center. When present on a
 * `FurnitureItem`, the item's `position` and `rotation` are *derived* from the
 * mount (kept in sync by `deriveMountTransform`) so the footprint sits flush
 * against the wall's interior face; renderers hang the body at `elevation`.
 */
export interface WallMount {
  /**
   * Id of the room whose wall hosts the mount. Always the room whose
   * furniture array holds the item — a mounted item belongs to the room it
   * hangs in — so reshapes re-anchor against the correct outline even when
   * another room's wall sits nearer (a party wall's far side).
   */
  roomId: string;
  /** Index of the host wall (see `Wall.index`). */
  wallIndex: number;
  /** Distance from the host wall's start corner to the mount's near edge. */
  offset: number;
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
   * When set, `position`/`rotation` are derived from it and the wall.
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

export interface Room {
  /**
   * Stable identity within the floor. Outlines reshape and rooms reorder;
   * the id never changes, so selections, mounts, and helpers can address a
   * room across mutations (see `model/floor.ts`).
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
  /** Ordered corners of the closed room outline. */
  outline: Point[];
  openings: Opening[];
  furniture: FurnitureItem[];
}

/**
 * A floor plan: one or more rooms sharing a single plan coordinate space —
 * every room's outline, openings, and furniture live directly in floor
 * coordinates (no per-room origin offset). The floor is the unit of app
 * state: history and persistence hold a `Floor`; room-scoped mutations
 * address a room by `Room.id` through `model/floor.ts`.
 */
export interface Floor {
  /** Display name, e.g. "Loft apartment". */
  name?: string;
  rooms: Room[];
}

/** Axis-aligned bounding box of an outline. */
export interface Bounds {
  min: Point;
  max: Point;
  width: number;
  height: number;
}
