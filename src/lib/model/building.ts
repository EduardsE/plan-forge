import { deriveFloor } from "./derived";
import { DEFAULT_WALL_HEIGHT, wallHeightOf } from "./room";
import type { Building, Floor } from "./types";

/**
 * A `Building` stacks per-storey `Floor` graphs ground-up (`floors[0]` is the
 * ground floor). Elevation, storey height, and stair voids are all *derived*
 * here — nothing about a floor's position in the stack is stored on it.
 */

/** Thickness of the dollhouse floor platform between storeys, meters — the
 * single source of truth; `lib/room-scene.ts` re-exports this constant so the
 * rendered slab and the storey math never drift apart. */
export const SLAB_THICKNESS = 0.18;

/** A fresh, empty floor: no graph, no stairs. */
export function createFloor(id: string = crypto.randomUUID()): Floor {
  return {
    id,
    nodes: [],
    edges: [],
    openings: [],
    furniture: [],
    rooms: [],
    stairs: [],
  };
}

export function floorById(
  building: Building,
  floorId: string,
): Floor | undefined {
  return building.floors.find((f) => f.id === floorId);
}

export function floorIndexOf(building: Building, floorId: string): number {
  return building.floors.findIndex((f) => f.id === floorId);
}

/** The topmost storey — the one a freshly loaded building starts on, so the
 * 3D stack (which renders ground-up *through* the active floor) shows the
 * whole building rather than just its ground slice. */
export function topFloorOf(building: Building): Floor {
  return building.floors[building.floors.length - 1];
}

/** "Ground floor" for index 0, else the 1-based "Floor N" — or the floor's
 * own name when it has one. */
export function floorDisplayName(building: Building, index: number): string {
  return (
    building.floors[index]?.name ??
    (index === 0 ? "Ground floor" : `Floor ${index + 1}`)
  );
}

/** A floor's ceiling (tallest room, or the default) plus the slab above it —
 * the vertical space this storey occupies in the stack. */
export function storeyHeightOf(floor: Floor): number {
  const { rooms } = deriveFloor(floor);
  const ceiling = rooms.length
    ? Math.max(...rooms.map(wallHeightOf))
    : DEFAULT_WALL_HEIGHT;
  return ceiling + SLAB_THICKNESS;
}

/** Ground elevation of the floor at `index`: the summed storey heights of
 * every floor below it. */
export function storeyElevation(building: Building, index: number): number {
  let y = 0;
  for (let i = 0; i < index && i < building.floors.length; i++) {
    y += storeyHeightOf(building.floors[i]);
  }
  return y;
}

/**
 * Replace the floor `floorId` with `fn(floor)`. Same-reference building on an
 * unknown id or a no-op `fn` (the shared no-op-by-reference contract, one
 * level up from the per-floor mutators).
 */
export function updateFloorIn(
  building: Building,
  floorId: string,
  fn: (floor: Floor) => Floor,
): Building {
  const index = floorIndexOf(building, floorId);
  if (index === -1) return building;
  const next = fn(building.floors[index]);
  if (next === building.floors[index]) return building;
  const floors = building.floors.slice();
  floors[index] = next;
  return { floors };
}

/** Append a fresh empty floor on top of the stack. `newId` (default
 * `crypto.randomUUID`) lets tests stay deterministic. */
export function addFloorAbove(
  building: Building,
  newId: () => string = () => crypto.randomUUID(),
): Building {
  return { floors: [...building.floors, createFloor(newId())] };
}

/**
 * Remove a floor. No-ops (same reference) when it's the last floor or the id
 * is unknown — a building always has at least one floor. Otherwise re-
 * establishes the "top floor never holds stairs" invariant: if the new top
 * floor carries stairs (it climbed to the floor just removed), they're
 * cleared.
 */
export function removeFloor(building: Building, floorId: string): Building {
  if (building.floors.length <= 1) return building;
  const index = floorIndexOf(building, floorId);
  if (index === -1) return building;
  const floors = building.floors.filter((_, i) => i !== index);
  const topIndex = floors.length - 1;
  const top = floors[topIndex];
  if (top.stairs.length > 0) {
    floors[topIndex] = { ...top, stairs: [] };
  }
  return { floors };
}

/**
 * Rename a floor. The name is trimmed; an empty result clears the field
 * (falling back to the derived display name) rather than storing `""`.
 * No-ops by reference when the trimmed value matches the current name (both
 * absent counts as a match).
 */
export function renameFloor(
  building: Building,
  floorId: string,
  name: string,
): Building {
  return updateFloorIn(building, floorId, (floor) => {
    const trimmed = name.trim();
    if (trimmed === (floor.name ?? "")) return floor;
    if (trimmed === "") {
      const { name: _name, ...rest } = floor;
      return rest as Floor;
    }
    return { ...floor, name: trimmed };
  });
}

/** The floor owning the furniture item `itemId`, across every storey. */
export function floorOfItem(
  building: Building,
  itemId: string,
): Floor | undefined {
  return building.floors.find((f) =>
    f.furniture.some((item) => item.id === itemId),
  );
}

/** The floor owning the opening `openingId`, across every storey. */
export function floorOfOpening(
  building: Building,
  openingId: string,
): Floor | undefined {
  return building.floors.find((f) =>
    f.openings.some((o) => o.id === openingId),
  );
}

/** The floor owning the graph edge `edgeId`, across every storey. */
export function floorOfEdge(
  building: Building,
  edgeId: string,
): Floor | undefined {
  return building.floors.find((f) => f.edges.some((e) => e.id === edgeId));
}

/** The floor owning the stair `stairId`, across every storey. */
export function floorOfStair(
  building: Building,
  stairId: string,
): Floor | undefined {
  return building.floors.find((f) => f.stairs.some((s) => s.id === stairId));
}
