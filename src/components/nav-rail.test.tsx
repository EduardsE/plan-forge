import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";

function renderRail(props: Partial<Parameters<typeof NavRail>[0]> = {}) {
  return render(
    <NavRail
      activeMode="3d"
      onSelectMode={() => {}}
      onFurnish={() => {}}
      settingsOpen={false}
      onToggleSettings={() => {}}
      {...props}
    />,
  );
}

describe("NavRail", () => {
  it("marks Draw as current in draw mode, Furnish otherwise", () => {
    renderRail({ activeMode: "draw" });

    expect(
      screen.getByRole("button", { name: "Draw" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("button", { name: "Furnish" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it.each([
    "2d",
    "3d",
  ] as const)("marks Furnish as current under the %s lens", (lens) => {
    renderRail({ activeMode: lens });

    expect(
      screen
        .getByRole("button", { name: "Furnish" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "Draw" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("selects draw mode from the Draw button", () => {
    const onSelectMode = vi.fn();
    renderRail({ onSelectMode });

    fireEvent.click(screen.getByRole("button", { name: "Draw" }));

    expect(onSelectMode).toHaveBeenCalledWith("draw");
  });

  it("fires onFurnish (not a mode change) from the Furnish button", () => {
    const onSelectMode = vi.fn();
    const onFurnish = vi.fn();
    renderRail({ onSelectMode, onFurnish });

    fireEvent.click(screen.getByRole("button", { name: "Furnish" }));

    expect(onFurnish).toHaveBeenCalledOnce();
    expect(onSelectMode).not.toHaveBeenCalled();
  });

  it("no longer renders the lens-alias Objects and Views items", () => {
    renderRail();

    expect(screen.queryByRole("button", { name: "Objects" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Views" })).toBeNull();
  });

  it("toggles the settings popover instead of selecting a mode", () => {
    const onSelectMode = vi.fn();
    const onToggleSettings = vi.fn();
    renderRail({ onSelectMode, onToggleSettings });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onToggleSettings).toHaveBeenCalledOnce();
    expect(onSelectMode).not.toHaveBeenCalled();
  });

  it("lights the Settings button while the popover is open", () => {
    renderRail({ settingsOpen: true });

    expect(
      screen
        .getByRole("button", { name: "Settings" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
