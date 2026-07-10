import type { Footprint, FurnitureItem, Room } from "./types";

/**
 * Pure furniture mutations for the selection toolbar. Every function returns
 * a new Room (and new furniture array) — callers hold rooms in React state,
 * so nothing here mutates in place. Unknown ids return the room unchanged.
 */

/** Plan offset applied to a duplicated item so the copy is visibly beside its source. */
export const DUPLICATE_OFFSET = 0.4;

function normalizeDeg(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

export function rotateFurniture(
	room: Room,
	id: string,
	deltaDeg: number,
): Room {
	return {
		...room,
		furniture: room.furniture.map((item) =>
			item.id === id
				? { ...item, rotation: normalizeDeg(item.rotation + deltaDeg) }
				: item,
		),
	};
}

export function duplicateFurniture(
	room: Room,
	id: string,
	newId: string,
): Room {
	const source = room.furniture.find((item) => item.id === id);
	if (!source) return room;
	const copy: FurnitureItem = {
		...source,
		id: newId,
		position: {
			x: source.position.x + DUPLICATE_OFFSET,
			y: source.position.y + DUPLICATE_OFFSET,
		},
	};
	return { ...room, furniture: [...room.furniture, copy] };
}

export function removeFurniture(room: Room, id: string): Room {
	return {
		...room,
		furniture: room.furniture.filter((item) => item.id !== id),
	};
}

/**
 * Display name derived from the catalog id ("desk-chair" → "Desk Chair").
 * The objects-panel task's real catalog data should replace this lookup.
 */
export function furnitureDisplayName(catalogId: string): string {
	return catalogId
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** Selection readout text, mockup format: "92 × 88 · H 45 cm". */
export function formatFootprintCm({ width, depth, height }: Footprint): string {
	const cm = (meters: number) => Math.round(meters * 100).toString();
	return `${cm(width)} × ${cm(depth)} · H ${cm(height)} cm`;
}
