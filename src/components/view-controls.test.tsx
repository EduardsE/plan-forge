import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewMode } from "#/lib/view-mode";
import { ViewControls } from "./view-controls";

/** The three toggle/action props default to no-ops unless a test overrides. */
function renderControls(props: Partial<Parameters<typeof ViewControls>[0]>) {
	return render(
		<ViewControls
			viewMode="3d"
			onSelectMode={() => {}}
			gridVisible
			onToggleGrid={() => {}}
			snapEnabled
			onToggleSnap={() => {}}
			onFullscreen={() => {}}
			{...props}
		/>,
	);
}

describe("ViewControls", () => {
	it.each<[ViewMode, "2D" | "3D"]>([
		["2d", "2D"],
		["draw", "2D"],
		["3d", "3D"],
		["objects", "3D"],
	])("marks the %s segment active in %s view mode", (mode, activeLabel) => {
		renderControls({ viewMode: mode });

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
		renderControls({ viewMode: "3d", onSelectMode });

		fireEvent.click(screen.getByRole("button", { name: "2D" }));

		expect(onSelectMode).toHaveBeenCalledWith("2d");
	});

	it("calls onSelectMode with '3d' when the 3D segment is clicked", () => {
		const onSelectMode = vi.fn();
		renderControls({ viewMode: "2d", onSelectMode });

		fireEvent.click(screen.getByRole("button", { name: "3D" }));

		expect(onSelectMode).toHaveBeenCalledWith("3d");
	});

	it("reflects the grid/snap toggle state as aria-pressed", () => {
		renderControls({ gridVisible: true, snapEnabled: false });

		expect(
			screen
				.getByRole("button", { name: "Toggle grid" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "Toggle snapping" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("fires the grid, snap, and fullscreen callbacks on click", () => {
		const onToggleGrid = vi.fn();
		const onToggleSnap = vi.fn();
		const onFullscreen = vi.fn();
		renderControls({ onToggleGrid, onToggleSnap, onFullscreen });

		fireEvent.click(screen.getByRole("button", { name: "Toggle grid" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle snapping" }));
		fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

		expect(onToggleGrid).toHaveBeenCalledOnce();
		expect(onToggleSnap).toHaveBeenCalledOnce();
		expect(onFullscreen).toHaveBeenCalledOnce();
	});
});
