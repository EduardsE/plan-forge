import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FurnitureItem, Room, Stair } from "#/lib/model";
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

const stair: Stair = {
  id: "stair-1",
  position: { x: 2, y: 1.5 },
  rotation: 0,
  width: 0.9,
};

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

  it("renders the building summary instead of the room list when there are multiple floors", () => {
    renderInspector({
      floorSummaries: [
        {
          id: "f0",
          name: "Ground floor",
          area: 33.28,
          roomCount: 1,
          active: true,
        },
        { id: "f1", name: "Studio", area: 12.5, roomCount: 2, active: false },
      ],
    });

    const rows = screen.getAllByTestId("inspector-floor-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Ground floor")).toBeTruthy();
    expect(screen.getByText("Studio")).toBeTruthy();
    expect(screen.getByText(/33\.28 m²/)).toBeTruthy();
    expect(screen.getByText(/12\.50 m²/)).toBeTruthy();
    // Footer totals sum across floors and count them.
    expect(screen.getByText("45.78 m²")).toBeTruthy();
    expect(screen.getByText("FLOORS")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("does not show the building summary with a single floor", () => {
    renderInspector({
      floorSummaries: [
        {
          id: "f0",
          name: "Ground floor",
          area: 33.28,
          roomCount: 1,
          active: true,
        },
      ],
    });

    expect(screen.queryByTestId("inspector-floor-row")).toBeNull();
  });

  it("keeps the selection view even with multiple floors", () => {
    renderInspector({
      selectedItem: item,
      floorSummaries: [
        {
          id: "f0",
          name: "Ground floor",
          area: 33.28,
          roomCount: 1,
          active: true,
        },
        { id: "f1", name: "Studio", area: 12.5, roomCount: 2, active: false },
      ],
    });

    expect(screen.getByText("SELECTION")).toBeTruthy();
    expect(screen.queryByTestId("inspector-floor-row")).toBeNull();
  });

  it("shows a selected stair with editable transform fields and a rises line", () => {
    renderInspector({
      selectedStair: {
        stair,
        run: 3.75,
        rises: "Ground floor → Floor 2",
      },
    });

    expect(screen.getByText("SELECTION")).toBeTruthy();
    expect(screen.getByTestId("inspector-item-name").textContent).toBe("Stair");
    expect(
      (screen.getByLabelText("Width") as HTMLInputElement).value,
    ).toBeTruthy();
    expect(screen.getByLabelText("Rotation")).toBeTruthy();
    expect(screen.getByLabelText("Position X")).toBeTruthy();
    expect(screen.getByLabelText("Position Y")).toBeTruthy();
    expect(
      screen.getByText("Rises Ground floor → Floor 2 · 3.75 m run"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete stair" })).toBeTruthy();
  });

  it("commits a stair width edit on blur", () => {
    const onStairResize = vi.fn();
    renderInspector({
      selectedStair: { stair, run: 3.75, rises: "Ground floor → Floor 2" },
      onStairResize,
    });

    const width = screen.getByLabelText("Width") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "1.2" } });
    fireEvent.blur(width);

    expect(onStairResize).toHaveBeenCalledWith(1.2);
  });

  it("commits a stair rotation edit on blur", () => {
    const onStairRotateTo = vi.fn();
    renderInspector({
      selectedStair: { stair, run: 3.75, rises: "Ground floor → Floor 2" },
      onStairRotateTo,
    });

    const rotate = screen.getByLabelText("Rotation") as HTMLInputElement;
    fireEvent.change(rotate, { target: { value: "90" } });
    fireEvent.blur(rotate);

    expect(onStairRotateTo).toHaveBeenCalledWith(90);
  });

  it("commits a stair position edit", () => {
    const onStairMoveTo = vi.fn();
    renderInspector({
      selectedStair: { stair, run: 3.75, rises: "Ground floor → Floor 2" },
      onStairMoveTo,
    });

    const posX = screen.getByLabelText("Position X") as HTMLInputElement;
    fireEvent.change(posX, { target: { value: "3" } });
    fireEvent.blur(posX);

    expect(onStairMoveTo).toHaveBeenCalledWith({ ...stair.position, x: 3 });
  });

  it("fires the stair delete action", () => {
    const onStairDelete = vi.fn();
    renderInspector({
      selectedStair: { stair, run: 3.75, rises: "Ground floor → Floor 2" },
      onStairDelete,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete stair" }));

    expect(onStairDelete).toHaveBeenCalledOnce();
  });

  it("prefers a furniture/opening/wall selection over a stair selection", () => {
    renderInspector({
      selectedItem: item,
      selectedStair: { stair, run: 3.75, rises: "Ground floor → Floor 2" },
    });

    expect(screen.queryByTestId("inspector-item-name")?.textContent).not.toBe(
      "Stair",
    );
  });
});

describe("opening pane grid", () => {
  const windowSelection = {
    opening: {
      id: "w1",
      kind: "window" as const,
      edgeId: "AB",
      offset: 1,
      width: 1.2,
      side: 1 as const,
    },
    bottom: 0.36,
    top: 1.94,
    ceiling: 2.5,
    connects: null,
    twoFace: false,
    sillOverhang: 0.03,
    sillMaterial: "white" as const,
  };

  it("shows 2×2 defaults and commits a columns edit", () => {
    const onOpeningPaneGrid = vi.fn();
    renderInspector({ selectedOpening: windowSelection, onOpeningPaneGrid });
    const cols = screen.getByLabelText("Pane columns") as HTMLInputElement;
    expect(cols.value).toBe("2");
    expect((screen.getByLabelText("Pane rows") as HTMLInputElement).value).toBe(
      "2",
    );
    fireEvent.change(cols, { target: { value: "4" } });
    fireEvent.blur(cols);
    expect(onOpeningPaneGrid).toHaveBeenCalledWith({ cols: 4 });
  });

  it("drops invalid input without committing", () => {
    const onOpeningPaneGrid = vi.fn();
    renderInspector({ selectedOpening: windowSelection, onOpeningPaneGrid });
    const rows = screen.getByLabelText("Pane rows") as HTMLInputElement;
    fireEvent.change(rows, { target: { value: "lots" } });
    fireEvent.blur(rows);
    expect(onOpeningPaneGrid).not.toHaveBeenCalled();
    expect(rows.value).toBe("2");
  });

  it("hides the PANES section for doors", () => {
    renderInspector({
      selectedOpening: {
        ...windowSelection,
        opening: {
          ...windowSelection.opening,
          kind: "door" as const,
          hinge: "start" as const,
        },
      },
    });
    expect(screen.queryByText("PANES")).toBeNull();
    expect(screen.queryByLabelText("Pane columns")).toBeNull();
  });
});
