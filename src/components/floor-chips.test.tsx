import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloorChips } from "./floor-chips";

const floors = [
  { id: "f0", label: "G", name: "Ground floor" },
  { id: "f1", label: "2", name: "Floor 2" },
];

function renderChips(props: Partial<Parameters<typeof FloorChips>[0]> = {}) {
  return render(
    <FloorChips
      floors={floors}
      activeFloorId="f0"
      onSelect={() => {}}
      onAdd={() => {}}
      {...props}
    />,
  );
}

describe("FloorChips", () => {
  it("renders one button per floor, top-first, plus an add button", () => {
    renderChips();

    const buttons = screen.getAllByRole("button");
    // Add button first, then floors top-first (f1 "2" before f0 "G").
    expect(buttons.map((b) => b.textContent)).toEqual(["", "2", "G"]);
    expect(screen.getByLabelText("Add floor")).toBeTruthy();
  });

  it("marks the active chip aria-pressed", () => {
    renderChips({ activeFloorId: "f1" });

    expect(
      screen.getByRole("button", { name: "2" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "G" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("calls onSelect with the clicked floor's id", () => {
    const onSelect = vi.fn();
    renderChips({ onSelect });

    fireEvent.click(screen.getByRole("button", { name: "2" }));

    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("calls onAdd from the add button", () => {
    const onAdd = vi.fn();
    renderChips({ onAdd });

    fireEvent.click(screen.getByLabelText("Add floor"));

    expect(onAdd).toHaveBeenCalledOnce();
  });
});
