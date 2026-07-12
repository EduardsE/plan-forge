import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createCameraReadoutStore } from "#/lib/camera";
import { createSampleRoom, type Floor } from "#/lib/model";
import { StatusBar } from "./status-bar";

// The shipping sample floor is a two-room flat (M6); these tests pin a
// one-room floor so the single-room readout stays covered.
const oneRoomFloor = (): Floor => ({ rooms: [createSampleRoom()] });

const twoRoomFloor = (): Floor => ({
  rooms: [
    createSampleRoom(),
    {
      id: "kitchen",
      name: "Kitchen",
      outline: [
        { x: 6.4, y: 0 },
        { x: 9.4, y: 0 },
        { x: 9.4, y: 3 },
        { x: 6.4, y: 3 },
      ],
      openings: [],
      furniture: [],
    },
  ],
});

function renderBar(props: Partial<Parameters<typeof StatusBar>[0]>) {
  return render(
    <StatusBar
      mode="3d"
      floor={oneRoomFloor()}
      cameraReadout={createCameraReadoutStore()}
      unit="m"
      onUnitChange={() => {}}
      gridVisible
      onToggleGrid={() => {}}
      snapEnabled
      onToggleSnap={() => {}}
      {...props}
    />,
  );
}

describe("StatusBar", () => {
  it("shows the computed floor area and room name", () => {
    renderBar({});

    expect(screen.getByText("33.28 m²")).toBeTruthy();
    expect(screen.getByText("Living room")).toBeTruthy();
  });

  it("reflects the grid/snap toggle state as aria-pressed", () => {
    renderBar({ gridVisible: true, snapEnabled: false });

    expect(
      screen
        .getByRole("button", { name: "Toggle grid" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Toggle snapping" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("fires the grid and snap callbacks on click", () => {
    const onToggleGrid = vi.fn();
    const onToggleSnap = vi.fn();
    renderBar({ onToggleGrid, onToggleSnap });

    fireEvent.click(screen.getByRole("button", { name: "Toggle grid" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle snapping" }));

    expect(onToggleGrid).toHaveBeenCalledOnce();
    expect(onToggleSnap).toHaveBeenCalledOnce();
  });

  it("marks the controlled unit active and reports switches", () => {
    const onUnitChange = vi.fn();
    renderBar({ unit: "m", onUnitChange });

    expect(
      screen.getByRole("button", { name: "m" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "cm" }));
    expect(onUnitChange).toHaveBeenCalledWith("cm");
  });

  it("renders the grid step in the active unit", () => {
    renderBar({ unit: "cm" });

    expect(screen.getByText(/Grid 50 cm/)).toBeTruthy();
  });

  it("describes the draw draft state", () => {
    renderBar({ mode: "draw", draftCornerCount: 3 });

    expect(screen.getByText("Drawing — 3 corners placed")).toBeTruthy();
  });

  it("counts placed objects in objects mode and names a live placement", () => {
    const { rerender } = renderBar({ mode: "objects" });
    expect(screen.getByText(/objects placed/)).toBeTruthy();

    rerender(
      <StatusBar
        mode="objects"
        floor={oneRoomFloor()}
        cameraReadout={createCameraReadoutStore()}
        unit="m"
        onUnitChange={() => {}}
        gridVisible
        onToggleGrid={() => {}}
        snapEnabled
        onToggleSnap={() => {}}
        placingName="Sofa · 2-seat"
      />,
    );
    expect(screen.getByText(/Placing “Sofa · 2-seat”/)).toBeTruthy();
  });

  it("shows floor totals and the containing room on a multi-room floor", () => {
    renderBar({ floor: twoRoomFloor(), selectedRoomName: "Kitchen" });

    // 33.28 + 9 summed across rooms.
    expect(screen.getByText("42.28 m²")).toBeTruthy();
    expect(screen.getByText("2 rooms · Kitchen")).toBeTruthy();
  });

  it("shows the room count alone with no selection", () => {
    renderBar({ floor: twoRoomFloor() });

    expect(screen.getByText("2 rooms")).toBeTruthy();
  });

  it("shows the live orbit readout without the zoom (that's the zoom pill's)", () => {
    const store = createCameraReadoutStore();
    store.publish({ kind: "orbit", azimuthDeg: 43, polarDeg: 43, zoom: 1 });
    renderBar({ cameraReadout: store });

    expect(screen.getByText("orbit 43° / 43°")).toBeTruthy();
  });
});
