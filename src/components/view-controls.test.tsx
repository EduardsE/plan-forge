import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewMode } from "#/lib/view-mode";
import { ViewControls } from "./view-controls";

describe("ViewControls", () => {
	it.each<[ViewMode, "2D" | "3D"]>([
		["2d", "2D"],
		["draw", "2D"],
		["3d", "3D"],
		["objects", "3D"],
	])("marks the %s segment active in %s view mode", (mode, activeLabel) => {
		render(<ViewControls viewMode={mode} onSelectMode={() => {}} />);

		expect(
			screen
				.getByRole("button", { name: activeLabel })
				.getAttribute("aria-pressed"),
		).toBe("true");
		const otherLabel = activeLabel === "2D" ? "3D" : "2D";
		expect(
			screen
				.getByRole("button", { name: otherLabel })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("calls onSelectMode with '2d' when the 2D segment is clicked", () => {
		const onSelectMode = vi.fn();
		render(<ViewControls viewMode="3d" onSelectMode={onSelectMode} />);

		fireEvent.click(screen.getByRole("button", { name: "2D" }));

		expect(onSelectMode).toHaveBeenCalledWith("2d");
	});

	it("calls onSelectMode with '3d' when the 3D segment is clicked", () => {
		const onSelectMode = vi.fn();
		render(<ViewControls viewMode="2d" onSelectMode={onSelectMode} />);

		fireEvent.click(screen.getByRole("button", { name: "3D" }));

		expect(onSelectMode).toHaveBeenCalledWith("3d");
	});
});
