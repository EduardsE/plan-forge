import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSampleRoom, type FurnitureItem } from "#/lib/model";
import { Inspector } from "./inspector";

const room = createSampleRoom();
const item = room.furniture.find((entry) => !entry.mount) as FurnitureItem;
const mounted = room.furniture.find((entry) => entry.mount) ?? null;

function renderInspector(props: Partial<Parameters<typeof Inspector>[0]>) {
  return render(
    <Inspector
      room={room}
      unit="m"
      mode="3d"
      selectedItem={null}
      onResize={() => {}}
      onRotateTo={() => {}}
      onElevate={() => {}}
      onMoveTo={() => {}}
      onRecolor={() => {}}
      onRotate90={() => {}}
      onClone={() => {}}
      onDelete={() => {}}
      {...props}
    />,
  );
}

describe("Inspector", () => {
  it("shows the room overview when nothing is selected", () => {
    renderInspector({});

    expect(screen.getByText("ROOM")).toBeTruthy();
    expect(screen.getByTestId("inspector-room-name").textContent).toBe(
      "Living room",
    );
    expect(screen.getByText(/objects ·/)).toBeTruthy();
  });

  it("always shows the floor / perimeter / ceiling stats", () => {
    renderInspector({});

    expect(screen.getByText("33.28 m²")).toBeTruthy();
    expect(screen.getByText("23.2 m")).toBeTruthy();
    expect(screen.getByText("2.50 m")).toBeTruthy();
  });

  it("shows the selected item with editable transform fields", () => {
    renderInspector({ selectedItem: item });

    expect(screen.getByText("SELECTION")).toBeTruthy();
    expect(
      (screen.getByLabelText("Width") as HTMLInputElement).value,
    ).toBeTruthy();
    expect(screen.getByLabelText("Rotation")).toBeTruthy();
    expect(screen.getByLabelText("Position X")).toBeTruthy();
  });

  it("commits a size edit on blur (meters in, footprint out)", () => {
    const onResize = vi.fn();
    renderInspector({ selectedItem: item, onResize });

    const width = screen.getByLabelText("Width") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "1.5" } });
    fireEvent.blur(width);

    expect(onResize).toHaveBeenCalledWith({ ...item.footprint, width: 1.5 });
  });

  it("does not commit an unchanged value", () => {
    const onResize = vi.fn();
    renderInspector({ selectedItem: item, onResize });

    const width = screen.getByLabelText("Width") as HTMLInputElement;
    fireEvent.blur(width);

    expect(onResize).not.toHaveBeenCalled();
  });

  it("commits a position edit", () => {
    const onMoveTo = vi.fn();
    renderInspector({ selectedItem: item, onMoveTo });

    const posX = screen.getByLabelText("Position X") as HTMLInputElement;
    fireEvent.change(posX, { target: { value: "2" } });
    fireEvent.blur(posX);

    expect(onMoveTo).toHaveBeenCalledWith({ ...item.position, x: 2 });
  });

  it("fires the arrange actions", () => {
    const onRotate90 = vi.fn();
    const onClone = vi.fn();
    const onDelete = vi.fn();
    renderInspector({ selectedItem: item, onRotate90, onClone, onDelete });

    fireEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onRotate90).toHaveBeenCalledOnce();
    expect(onClone).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("recolors via a material swatch (and clears back to default)", () => {
    const onRecolor = vi.fn();
    renderInspector({ selectedItem: item, onRecolor });

    expect(screen.getByText("MATERIAL")).toBeTruthy();
    // A non-default swatch sets an explicit colorway...
    const swatches = screen.getAllByRole("button", { name: /^Material / });
    fireEvent.click(swatches[0]);
    expect(onRecolor).toHaveBeenCalledWith(expect.stringMatching(/^#/));
    // ...and the default swatch clears the override.
    fireEvent.click(screen.getByRole("button", { name: "Default material" }));
    expect(onRecolor).toHaveBeenCalledWith(null);
  });

  it("swaps rotation for elevation on wall-mounted items and hides rotate", () => {
    if (!mounted) return; // sample room always mounts wall art; guard anyway
    renderInspector({ selectedItem: mounted });

    expect(screen.getByLabelText("Elevation")).toBeTruthy();
    expect(screen.queryByLabelText("Rotation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rotate 90°" })).toBeNull();
    expect(screen.queryByLabelText("Position X")).toBeNull();
  });

  it("shows the outline view in draw mode", () => {
    renderInspector({ mode: "draw", draftCornerCount: 4, draftClosed: true });

    expect(screen.getByText("OUTLINE")).toBeTruthy();
    expect(screen.getByText(/4 corners · closed/)).toBeTruthy();
  });
});
