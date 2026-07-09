import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitsToggle } from "./units-toggle";

describe("UnitsToggle", () => {
	it("defaults to 'm' active, matching the mockup", () => {
		render(<UnitsToggle />);

		expect(
			screen.getByRole("button", { name: "m" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "cm" }).getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("switches the active segment to 'cm' when clicked", () => {
		render(<UnitsToggle />);

		fireEvent.click(screen.getByRole("button", { name: "cm" }));

		expect(
			screen.getByRole("button", { name: "cm" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "m" }).getAttribute("aria-pressed"),
		).toBe("false");
	});
});
