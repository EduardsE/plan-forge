import { describe, expect, it } from "vitest";
import { createSampleRoom } from "./model";
import {
	deserializeSavedState,
	formatSavedStatus,
	serializeSavedState,
} from "./persistence";

const sampleState = () => ({
	room: createSampleRoom(),
	unit: "cm" as const,
	savedAt: 1_750_000_000_000,
});

describe("serialize / deserialize round trip", () => {
	it("restores the room, unit, and savedAt exactly", () => {
		const state = sampleState();
		expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
	});

	it("accepts an empty room (a new room awaiting its first draw)", () => {
		const state = {
			room: { name: "Untitled room", outline: [], openings: [], furniture: [] },
			unit: "m" as const,
			savedAt: 1,
		};
		expect(deserializeSavedState(serializeSavedState(state))).toEqual(state);
	});
});

describe("deserializeSavedState rejection", () => {
	it("returns null for a missing or unparsable payload", () => {
		expect(deserializeSavedState(null)).toBeNull();
		expect(deserializeSavedState("not json {")).toBeNull();
		expect(deserializeSavedState('"a string"')).toBeNull();
	});

	it("rejects the wrong version", () => {
		const json = serializeSavedState(sampleState()).replace(
			'"version":1',
			'"version":2',
		);
		expect(deserializeSavedState(json)).toBeNull();
	});

	it("rejects a bad unit or savedAt", () => {
		const state = sampleState();
		expect(
			deserializeSavedState(
				serializeSavedState({ ...state, unit: "ft" as never }),
			),
		).toBeNull();
		expect(
			deserializeSavedState(
				serializeSavedState({ ...state, savedAt: Number.NaN }),
			),
		).toBeNull();
	});

	it("rejects malformed outline points and furniture", () => {
		const state = sampleState();
		const badOutline = {
			...state,
			room: { ...state.room, outline: [{ x: 0, y: "zero" }] },
		};
		expect(
			deserializeSavedState(serializeSavedState(badOutline as never)),
		).toBeNull();
		const badFurniture = {
			...state,
			room: {
				...state.room,
				furniture: [{ id: "x", catalogId: "desk" }],
			},
		};
		expect(
			deserializeSavedState(serializeSavedState(badFurniture as never)),
		).toBeNull();
	});

	it("rejects an opening whose wallIndex points past the outline's walls", () => {
		const state = sampleState();
		const room = state.room;
		room.openings[0].wallIndex = room.outline.length;
		expect(deserializeSavedState(serializeSavedState(state))).toBeNull();
	});
});

describe("formatSavedStatus", () => {
	const at = 1_000_000_000_000;
	it("steps from just now through minutes, hours, and days", () => {
		expect(formatSavedStatus(at, at)).toBe("saved just now");
		expect(formatSavedStatus(at, at + 59_000)).toBe("saved just now");
		expect(formatSavedStatus(at, at + 60_000)).toBe("saved 1 min ago");
		expect(formatSavedStatus(at, at + 59 * 60_000)).toBe("saved 59 min ago");
		expect(formatSavedStatus(at, at + 2 * 3_600_000)).toBe("saved 2 h ago");
		expect(formatSavedStatus(at, at + 3 * 86_400_000)).toBe("saved 3 d ago");
	});

	it("treats a save from the future as just now (clock skew)", () => {
		expect(formatSavedStatus(at + 5_000, at)).toBe("saved just now");
	});
});
