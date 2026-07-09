import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createSampleRoom } from "#/lib/model";
import { RoomPreview } from "./room-preview";

describe("RoomPreview", () => {
	it("shows the floor area computed from the model, not a hardcoded string", () => {
		render(<RoomPreview room={createSampleRoom()} />);

		expect(screen.getByText("33.28 m² floor area")).toBeDefined();
	});

	it("renders a labeled symbol for every furniture item", () => {
		const room = createSampleRoom();
		render(<RoomPreview room={room} />);

		for (const label of [
			"DESK",
			"DESK CHAIR",
			"CREDENZA",
			"SHELF",
			"RUG",
			"PLANT",
		]) {
			expect(screen.getByText(label)).toBeDefined();
		}
		expect(room.furniture).toHaveLength(6);
	});

	it("renders nothing for a room without an outline", () => {
		const { container } = render(
			<RoomPreview room={{ outline: [], openings: [], furniture: [] }} />,
		);

		expect(container.firstChild).toBeNull();
	});
});
