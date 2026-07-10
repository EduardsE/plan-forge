import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnitsToggle } from "./units-toggle";

describe("UnitsToggle", () => {
	it("marks the controlled unit as the active segment", () => {
		render(<UnitsToggle unit="m" onUnitChange={() => {}} />);

		expect(
			screen.getByRole("button", { name: "m" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "cm" }).getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("reports a click on the inactive segment to the owner", () => {
		const onUnitChange = vi.fn();
		render(<UnitsToggle unit="m" onUnitChange={onUnitChange} />);

		fireEvent.click(screen.getByRole("button", { name: "cm" }));

		expect(onUnitChange).toHaveBeenCalledWith("cm");
	});
});
