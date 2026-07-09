import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";

describe("NavRail", () => {
	it("marks the nav item mapped to the active view mode as current", () => {
		render(<NavRail activeMode="draw" onSelectMode={() => {}} />);

		expect(screen.getByRole("button", { name: "Draw" }).getAttribute("aria-current")).toBe("page");
		expect(screen.getByRole("button", { name: "Furnish" }).getAttribute("aria-current")).toBeNull();
	});

	it("calls onSelectMode with the mapped mode when a mode-mapped item is clicked", () => {
		const onSelectMode = vi.fn();
		render(<NavRail activeMode="3d" onSelectMode={onSelectMode} />);

		fireEvent.click(screen.getByRole("button", { name: "Objects" }));

		expect(onSelectMode).toHaveBeenCalledWith("objects");
	});

	it("does not call onSelectMode when an unmapped item like Dashboard is clicked", () => {
		const onSelectMode = vi.fn();
		render(<NavRail activeMode="3d" onSelectMode={onSelectMode} />);

		fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));

		expect(onSelectMode).not.toHaveBeenCalled();
	});
});
