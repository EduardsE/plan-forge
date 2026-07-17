import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FurnitureItem, Room } from "#/lib/model";
import { createSampleRoom } from "#/lib/model/test-fixtures";
import { Inspector } from "./inspector";

const room = createSampleRoom();
const rooms: Room[] = [room];
const item = room.furniture.find((entry) => !entry.mount) as FurnitureItem;
const mounted = room.furniture.find((entry) => entry.mount) ?? null;

const kitchen: Room = {
  id: "kitchen",
  name: "Kitchen",
  outline: [
    { x: 6.4, y: 0 },
    { x: 9.4, y: 0 },
    { x: 9.4, y: 3 },
    { x: 6.4, y: 3 },
  ],
  openings: [],
  furniture: [
    {
      id: "stool-1",
      catalogId: "desk-chair",
      position: { x: 7, y: 1 },
      rotation: 0,
      footprint: { width: 0.64, depth: 0.64, height: 1.04 },
    },
  ],
};
const twoRooms: Room[] = [room, kitchen];

function renderInspector(props: Partial<Parameters<typeof Inspector>[0]>) {
  return render(
    <Inspector
      rooms={rooms}
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

  it("shows the room's own ceiling height when set", () => {
    renderInspector({
      rooms: [{ ...room, wallHeight: 3.1 }],
    });

    expect(screen.getByText("3.10 m")).toBeTruthy();
  });

  it("shows floor totals, the room list, and the room count on a multi-room floor", () => {
    renderInspector({ rooms: twoRooms });

    // "FLOOR" is both the section header and the footer's area label.
    expect(screen.getAllByText("FLOOR")).toHaveLength(2);
    // Overview lists every room with its own area…
    expect(screen.getByText("Kitchen")).toBeTruthy();
    expect(screen.getByText("9.00 m²")).toBeTruthy();
    // …and the footer sums areas/perimeters and counts rooms.
    expect(screen.getByText("42.28 m²")).toBeTruthy();
    expect(screen.getByText("35.2 m")).toBeTruthy();
    expect(screen.getByText("ROOMS")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("names the containing room on a multi-room selection", () => {
    renderInspector({
      rooms: twoRooms,
      selectedRoomName: "Kitchen",
      selectedItem: kitchen.furniture[0],
    });

    expect(screen.getByText("SELECTION")).toBeTruthy();
    expect(screen.getByText(/· Kitchen/)).toBeTruthy();
  });

  it("reads membership as '—' when the selection sits in no room", () => {
    renderInspector({ selectedItem: item, selectedRoomName: "—" });

    expect(screen.getByText("SELECTION")).toBeTruthy();
    expect(screen.getByText(/· —/)).toBeTruthy();
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
    renderInspector({ mode: "draw", nodeCount: 4 });

    expect(screen.getByText("OUTLINE")).toBeTruthy();
    expect(screen.getByText(/4 corners/)).toBeTruthy();
  });
});
