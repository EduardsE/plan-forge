import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";

function renderRail(props: Partial<Parameters<typeof NavRail>[0]> = {}) {
  return render(
    <NavRail
      activeMode="3d"
      onSelectMode={() => {}}
      settingsOpen={false}
      onToggleSettings={() => {}}
      {...props}
    />,
  );
}

describe("NavRail", () => {
  it("marks the nav item mapped to the active view mode as current", () => {
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

  it("calls onSelectMode with the mapped mode when a mode-mapped item is clicked", () => {
    const onSelectMode = vi.fn();
    renderRail({ onSelectMode });

    fireEvent.click(screen.getByRole("button", { name: "Objects" }));

    expect(onSelectMode).toHaveBeenCalledWith("objects");
  });

  it("does not render the dropped Dashboard button", () => {
    renderRail();

    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
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
