import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewMode } from "#/lib/view-mode";
import { WorkspaceHeader } from "./workspace-header";

function renderHeader(props: Partial<Parameters<typeof WorkspaceHeader>[0]>) {
  return render(
    <WorkspaceHeader
      mode="3d"
      roomName="Living Room"
      savedAt={null}
      onNewRoom={() => {}}
      onSelectMode={() => {}}
      onUndo={() => {}}
      onRedo={() => {}}
      canUndo
      canRedo
      onFullscreen={() => {}}
      {...props}
    />,
  );
}

describe("WorkspaceHeader", () => {
  it.each<[ViewMode, "2D" | "3D"]>([
    ["2d", "2D"],
    ["draw", "2D"],
    ["3d", "3D"],
    ["objects", "3D"],
  ])("marks the %s segment active in %s view mode", (mode, activeLabel) => {
    renderHeader({ mode });

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

  it("reports lens switches through onSelectMode", () => {
    const onSelectMode = vi.fn();
    renderHeader({ mode: "3d", onSelectMode });

    fireEvent.click(screen.getByRole("button", { name: "2D" }));

    expect(onSelectMode).toHaveBeenCalledWith("2d");
  });

  it("shows the room name as the breadcrumb leaf", () => {
    renderHeader({ roomName: "Studio" });

    expect(screen.getByRole("heading", { name: "Studio" })).toBeTruthy();
  });

  it("disables undo/redo when the history has no steps", () => {
    const onUndo = vi.fn();
    renderHeader({ canUndo: false, canRedo: false, onUndo });

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(true);
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("steps the history from the undo/redo group", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHeader({ onUndo, onRedo });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("wires New room and Present (fullscreen)", () => {
    const onNewRoom = vi.fn();
    const onFullscreen = vi.fn();
    renderHeader({ onNewRoom, onFullscreen });

    fireEvent.click(screen.getByRole("button", { name: /New room/ }));
    fireEvent.click(screen.getByRole("button", { name: /Present/ }));

    expect(onNewRoom).toHaveBeenCalledOnce();
    expect(onFullscreen).toHaveBeenCalledOnce();
  });

  it("shows Draft before the first save and Saved after", () => {
    const { rerender } = renderHeader({ savedAt: null });
    expect(screen.getByText("Draft")).toBeTruthy();

    rerender(
      <WorkspaceHeader
        mode="3d"
        roomName="Living Room"
        savedAt={Date.now()}
        onNewRoom={() => {}}
        onSelectMode={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo
        canRedo
        onFullscreen={() => {}}
      />,
    );
    expect(screen.getByText(/Saved just now/)).toBeTruthy();
  });

  it("announces activity on the status chip", () => {
    renderHeader({ mode: "draw" });
    expect(screen.getByText("Drawing")).toBeTruthy();
  });
});
