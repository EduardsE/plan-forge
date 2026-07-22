import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ObjectsPanel } from "./objects-panel";

function renderPanel(placingId: string | null = null, stairsEnabled = true) {
  const onStartPlacing = vi.fn();
  const onClose = vi.fn();
  render(
    <ObjectsPanel
      placingId={placingId}
      stairsEnabled={stairsEnabled}
      onStartPlacing={onStartPlacing}
      onClose={onClose}
    />,
  );
  return { onStartPlacing, onClose };
}

describe("ObjectsPanel", () => {
  it("opens on the Seating category like the mockup", () => {
    renderPanel();
    expect(
      screen
        .getByRole("button", { name: "Seating" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Lounge Chair")).toBeDefined();
    expect(screen.getByText("Sofa · 2-seat")).toBeDefined();
    // "Desk" lives in Tables and must be filtered out.
    expect(screen.queryByText("Desk")).toBeNull();
  });

  it("switches categories and toggles the active chip off to show all", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getByText("Coffee Table")).toBeDefined();
    expect(screen.queryByText("Lounge Chair")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getByText("Coffee Table")).toBeDefined();
    expect(screen.getByText("Lounge Chair")).toBeDefined();
  });

  it("filters by the search query within the active category", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "sofa" },
    });
    expect(screen.getByText("Sofa · 2-seat")).toBeDefined();
    expect(screen.queryByText("Armchair")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "no such thing" },
    });
    expect(screen.getByText("No items match your search.")).toBeDefined();
  });

  it("starts placing on card pointerdown with the pointer origin", () => {
    const { onStartPlacing } = renderPanel();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /Sofa · 2-seat/ }),
      { isPrimary: true, button: 0, clientX: 120, clientY: 340 },
    );
    expect(onStartPlacing).toHaveBeenCalledTimes(1);
    const [item, origin] = onStartPlacing.mock.calls[0];
    expect(item.id).toBe("sofa-2");
    expect(origin).toEqual({ x: 120, y: 340 });
  });

  it("renders the placing card state instead of a draggable card", () => {
    renderPanel("sofa-2");
    expect(screen.getByText("placing…")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Sofa · 2-seat/ })).toBeNull();
  });

  it("closes via the header X", () => {
    const { onClose } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Close objects panel" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a disabled hint tile for stairs when stairsEnabled is false", () => {
    const { onStartPlacing } = renderPanel(null, false);
    fireEvent.click(screen.getByRole("button", { name: "Stairs" }));
    expect(screen.getByText("Straight stair")).toBeDefined();
    expect(screen.getByText("Add a floor above first")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Straight stair/ })).toBeNull();

    const tile = screen.getByText("Straight stair").closest("div");
    expect(tile).not.toBeNull();
    if (tile) {
      fireEvent.pointerDown(tile, {
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      });
    }
    expect(onStartPlacing).not.toHaveBeenCalled();
  });

  it("renders the stairs card as a normal draggable card when stairsEnabled is true", () => {
    const { onStartPlacing } = renderPanel(null, true);
    fireEvent.click(screen.getByRole("button", { name: "Stairs" }));
    expect(screen.queryByText("Add a floor above first")).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /Straight stair/ }),
      { isPrimary: true, button: 0, clientX: 10, clientY: 20 },
    );
    expect(onStartPlacing).toHaveBeenCalledTimes(1);
    expect(onStartPlacing.mock.calls[0][0].id).toBe("stairs");
  });
});
