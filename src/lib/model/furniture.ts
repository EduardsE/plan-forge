import { catalogItemById } from "./catalog";
import type { Footprint, FurnitureItem, Point, Room, WallMount } from "./types";
import { deriveMountTransform, wallFrames } from "./wall-mount";

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
	// A wall-mounted copy shifts along its host wall (staying on the wall)
	// instead of floating out into the room like a floor copy.
	if (source.mount) {
		const frame = wallFrames(room.outline).find(
			(f) => f.index === source.mount?.wallIndex,
		);
		if (frame) {
			const maxOffset = Math.max(0, frame.length - source.footprint.width);
			const offset = Math.min(
				source.mount.offset + DUPLICATE_OFFSET,
				maxOffset,
			);
			const { position, rotation } = deriveMountTransform(
				frame,
				offset,
				source.footprint,
			);
			const mounted: FurnitureItem = {
				...source,
				id: newId,
				position,
				rotation,
				mount: { ...source.mount, offset },
			};
			return { ...room, furniture: [...room.furniture, mounted] };
		}
	}
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

/** A move-drag update: the snapped center, plus (for a wall item) the new
 * derived rotation and mount. `mount` absent leaves the item's mount as-is. */
export interface FurnitureUpdate {
	position: Point;
	rotation?: number;
	mount?: WallMount;
}

/** Apply a move-drag update to one item (absolute reposition, plan coords). */
export function updateFurniture(
	room: Room,
	id: string,
	update: FurnitureUpdate,
): Room {
	return {
		...room,
		furniture: room.furniture.map((item) =>
			item.id === id
				? {
						...item,
						position: update.position,
						rotation: update.rotation ?? item.rotation,
						...(update.mount !== undefined ? { mount: update.mount } : {}),
					}
				: item,
		),
	};
}

/** Smallest editable footprint dimension (meters) — the properties card's floor. */
export const MIN_FOOTPRINT_SIZE = 0.1;

/** Clamp an edited dimension to the minimum; an untouched one passes through
 * as-is, so e.g. a rug's 0.01 m height survives a width edit. */
function clampDimension(value: number, current: number): number {
	if (value === current) return value;
	return Math.max(value, MIN_FOOTPRINT_SIZE);
}

/**
 * Replace an item's footprint (the properties card's size fields). `position`
 * is the footprint center, so a floor item scales about its center for free.
 * A wall-mounted item stays flush on its host wall: width clamps to the wall,
 * the near-edge offset re-clamps so the item still fits, position/rotation
 * re-derive from the mount, and the elevation lifts if the new height would
 * dip the body below the floor. Unknown ids return the room unchanged.
 */
export function setFurnitureFootprint(
	room: Room,
	id: string,
	footprint: Footprint,
): Room {
	const item = room.furniture.find((entry) => entry.id === id);
	if (!item) return room;
	let next: FurnitureItem = {
		...item,
		footprint: {
			width: clampDimension(footprint.width, item.footprint.width),
			depth: clampDimension(footprint.depth, item.footprint.depth),
			height: clampDimension(footprint.height, item.footprint.height),
		},
	};
	if (item.mount) {
		const frame = wallFrames(room.outline).find(
			(f) => f.index === item.mount?.wallIndex,
		);
		if (frame) {
			const resized = {
				...next.footprint,
				width: Math.min(next.footprint.width, frame.length),
			};
			const offset = Math.min(
				Math.max(item.mount.offset, 0),
				frame.length - resized.width,
			);
			const elevation = Math.max(item.mount.elevation, resized.height / 2);
			const { position, rotation } = deriveMountTransform(
				frame,
				offset,
				resized,
			);
			next = {
				...next,
				footprint: resized,
				position,
				rotation,
				mount: { wallIndex: frame.index, offset, elevation },
			};
		}
	}
	return {
		...room,
		furniture: room.furniture.map((entry) => (entry.id === id ? next : entry)),
	};
}

/**
 * Set an item's rotation to an absolute angle (the properties card's degrees
 * field), normalized to [0, 360). Mounted items (rotation is derived from the
 * wall), unknown ids and no-op angles return the room unchanged.
 */
export function setFurnitureRotation(
	room: Room,
	id: string,
	deg: number,
): Room {
	const item = room.furniture.find((entry) => entry.id === id);
	if (!item || item.mount || !Number.isFinite(deg)) return room;
	const rotation = normalizeDeg(deg);
	if (rotation === item.rotation) return room;
	return {
		...room,
		furniture: room.furniture.map((entry) =>
			entry.id === id ? { ...entry, rotation } : entry,
		),
	};
}

/**
 * Set a wall-mounted item's center elevation, clamped so the body stays above
 * the floor. The ceiling clamp is the caller's — wall height is a rendering
 * constant, not model data. Floor items and unknown ids return the room
 * unchanged.
 */
export function setMountElevation(
	room: Room,
	id: string,
	elevation: number,
): Room {
	const item = room.furniture.find((entry) => entry.id === id);
	if (!item?.mount || !Number.isFinite(elevation)) return room;
	const clamped = Math.max(elevation, item.footprint.height / 2);
	if (clamped === item.mount.elevation) return room;
	const mount = { ...item.mount, elevation: clamped };
	return {
		...room,
		furniture: room.furniture.map((entry) =>
			entry.id === id ? { ...entry, mount } : entry,
		),
	};
}

export function removeFurniture(room: Room, id: string): Room {
	return {
		...room,
		furniture: room.furniture.filter((item) => item.id !== id),
	};
}

/** A dropped catalog item joining the room (objects-panel placement). */
export function addFurniture(room: Room, item: FurnitureItem): Room {
	return { ...room, furniture: [...room.furniture, item] };
}

/**
 * Plan positions of the rotated footprint's four corners. The rotation
 * matches the renderers' `rotation-y` (degrees about world up; plan y points
 * down, so a positive turn takes +x toward -y).
 */
export function footprintCorners(item: FurnitureItem): Point[] {
	const rad = (item.rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const hw = item.footprint.width / 2;
	const hd = item.footprint.depth / 2;
	const offsets: Array<[number, number]> = [
		[-hw, -hd],
		[hw, -hd],
		[hw, hd],
		[-hw, hd],
	];
	return offsets.map(([ox, oy]) => ({
		x: item.position.x + ox * cos + oy * sin,
		y: item.position.y - ox * sin + oy * cos,
	}));
}

/**
 * Display name from the catalog ("sofa-2" → "Sofa · 2-seat"); ids missing
 * from the catalog fall back to a title-cased slug.
 */
export function furnitureDisplayName(catalogId: string): string {
	const entry = catalogItemById(catalogId);
	if (entry) return entry.name;
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
