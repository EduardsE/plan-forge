import type { FurnitureItem, Opening, Point, Room } from "#/lib/model";
import type { Unit } from "#/lib/units";

/**
 * localStorage autosave for the room model. The model is plain JSON already;
 * this module owns the storage payload — serialization, and the paranoid
 * deserialization that keeps a stale or hand-edited save from crashing the
 * scenes (anything malformed hydrates as "no save").
 */

export const STORAGE_KEY = "planforge.room";

/** Bumped whenever the payload shape changes; older saves are discarded. */
const STORAGE_VERSION = 1;

export interface SavedState {
	room: Room;
	/** Display unit the user last picked. */
	unit: Unit;
	/** Epoch ms of the write, so a reload reports "saved 5 min ago" honestly. */
	savedAt: number;
}

export function serializeSavedState(state: SavedState): string {
	return JSON.stringify({ version: STORAGE_VERSION, ...state });
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
	if (typeof value !== "object" || value === null) return false;
	const point = value as Record<string, unknown>;
	return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isOpening(value: unknown, wallCount: number): value is Opening {
	if (typeof value !== "object" || value === null) return false;
	const opening = value as Record<string, unknown>;
	return (
		typeof opening.id === "string" &&
		(opening.kind === "door" || opening.kind === "window") &&
		Number.isInteger(opening.wallIndex) &&
		(opening.wallIndex as number) >= 0 &&
		(opening.wallIndex as number) < wallCount &&
		isFiniteNumber(opening.offset) &&
		isFiniteNumber(opening.width) &&
		opening.width > 0 &&
		(opening.hinge === undefined ||
			opening.hinge === "start" ||
			opening.hinge === "end")
	);
}

function isFurnitureItem(value: unknown): value is FurnitureItem {
	if (typeof value !== "object" || value === null) return false;
	const item = value as Record<string, unknown>;
	const footprint = item.footprint as Record<string, unknown> | null;
	return (
		typeof item.id === "string" &&
		typeof item.catalogId === "string" &&
		isPoint(item.position) &&
		isFiniteNumber(item.rotation) &&
		typeof footprint === "object" &&
		footprint !== null &&
		isFiniteNumber(footprint.width) &&
		footprint.width > 0 &&
		isFiniteNumber(footprint.depth) &&
		footprint.depth > 0 &&
		isFiniteNumber(footprint.height) &&
		footprint.height > 0
	);
}

function isRoom(value: unknown): value is Room {
	if (typeof value !== "object" || value === null) return false;
	const room = value as Record<string, unknown>;
	if (room.name !== undefined && typeof room.name !== "string") return false;
	if (!Array.isArray(room.outline) || !room.outline.every(isPoint)) {
		return false;
	}
	// An empty outline is a legal room (a "new room" awaiting its first draw),
	// and it derives zero walls — so every stored wallIndex must be rejected.
	const wallCount = room.outline.length >= 2 ? room.outline.length : 0;
	return (
		Array.isArray(room.openings) &&
		room.openings.every((opening) => isOpening(opening, wallCount)) &&
		Array.isArray(room.furniture) &&
		room.furniture.every(isFurnitureItem)
	);
}

/**
 * Parse a raw localStorage payload back into saved state. Returns null —
 * meaning "start fresh" — for missing, unparsable, wrong-version, or
 * structurally invalid saves.
 */
export function deserializeSavedState(json: string | null): SavedState | null {
	if (json === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const state = parsed as Record<string, unknown>;
	if (state.version !== STORAGE_VERSION) return null;
	if (state.unit !== "cm" && state.unit !== "m") return null;
	if (!isFiniteNumber(state.savedAt)) return null;
	if (!isRoom(state.room)) return null;
	return { room: state.room, unit: state.unit, savedAt: state.savedAt };
}

/** "saved just now" → "saved 5 min ago" → "saved 3 h ago" → "saved 2 d ago". */
export function formatSavedStatus(savedAt: number, now: number): string {
	const seconds = Math.max(0, (now - savedAt) / 1000);
	if (seconds < 60) return "saved just now";
	if (seconds < 3600) return `saved ${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) return `saved ${Math.floor(seconds / 3600)} h ago`;
	return `saved ${Math.floor(seconds / 86400)} d ago`;
}
