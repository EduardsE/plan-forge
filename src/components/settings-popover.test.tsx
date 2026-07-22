import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSampleRoom } from "#/lib/model/test-fixtures";
import { SettingsPopover } from "./settings-popover";

function renderPopover(
  props: Partial<Parameters<typeof SettingsPopover>[0]> = {},
) {
  return render(
    <SettingsPopover
      floors={[
        {
          id: "floor-1",
          name: "",
          defaultName: "Ground floor",
          rooms: [createSampleRoom()],
        },
      ]}
      unit="m"
      onRenameRoom={() => {}}
      onRoomWallHeight={() => {}}
      onRenameFloor={() => {}}
      onDeleteFloor={() => {}}
      canDeleteFloor={false}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("SettingsPopover", () => {
  it("shows the room name and the effective ceiling height", () => {
    renderPopover({
      floors: [
        {
          id: "floor-1",
          name: "",
          defaultName: "Ground floor",
          rooms: [{ ...createSampleRoom(), wallHeight: 3.1 }],
        },
      ],
    });

    expect((screen.getByLabelText("Room name") as HTMLInputElement).value).toBe(
      "Living room",
    );
    expect(
      (screen.getByLabelText("Ceiling height") as HTMLInputElement).value,
    ).toBe("3.10");
  });

  it("renders a section per room and commits against the edited room's and floor's ids", () => {
    const onRenameRoom = vi.fn();
    const kitchen = {
      ...createSampleRoom(),
      id: "kitchen",
      name: "Kitchen",
      wallHeight: 2.8,
    };
    renderPopover({
      floors: [
        {
          id: "floor-1",
          name: "",
          defaultName: "Ground floor",
          rooms: [createSampleRoom(), kitchen],
        },
      ],
      onRenameRoom,
    });

    expect(
      (screen.getByLabelText("Room 1 name") as HTMLInputElement).value,
    ).toBe("Living room");
    const kitchenName = screen.getByLabelText(
      "Room 2 name",
    ) as HTMLInputElement;
    expect(kitchenName.value).toBe("Kitchen");
    expect(
      (screen.getByLabelText("Room 2 ceiling height") as HTMLInputElement)
        .value,
    ).toBe("2.80");

    fireEvent.change(kitchenName, { target: { value: "Pantry" } });
    fireEvent.blur(kitchenName);
    expect(onRenameRoom).toHaveBeenCalledWith("floor-1", "kitchen", "Pantry");
  });

  it("falls back to the default ceiling height and honors the unit", () => {
    renderPopover({ unit: "cm" });

    expect(
      (screen.getByLabelText("Ceiling height") as HTMLInputElement).value,
    ).toBe("250");
  });

  it("commits a room rename on blur, trimmed; empty input never commits", () => {
    const onRenameRoom = vi.fn();
    renderPopover({ onRenameRoom });

    const name = screen.getByLabelText("Room name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  Studio " } });
    fireEvent.blur(name);
    expect(onRenameRoom).toHaveBeenCalledWith(
      "floor-1",
      "living-room",
      "Studio",
    );

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(onRenameRoom).toHaveBeenCalledOnce();
    // The field snaps back to the canonical name.
    expect(name.value).toBe("Living room");
  });

  it("commits a ceiling height in the active unit, in meters", () => {
    const onRoomWallHeight = vi.fn();
    renderPopover({ unit: "cm", onRoomWallHeight });

    const height = screen.getByLabelText("Ceiling height") as HTMLInputElement;
    fireEvent.change(height, { target: { value: "310" } });
    fireEvent.blur(height);

    expect(onRoomWallHeight).toHaveBeenCalledWith(
      "floor-1",
      "living-room",
      3.1,
    );
  });

  it("drops unparsable height input and snaps the field back", () => {
    const onRoomWallHeight = vi.fn();
    renderPopover({ onRoomWallHeight });

    const height = screen.getByLabelText("Ceiling height") as HTMLInputElement;
    fireEvent.change(height, { target: { value: "tall" } });
    fireEvent.blur(height);

    expect(onRoomWallHeight).not.toHaveBeenCalled();
    expect(height.value).toBe("2.50");
  });

  it("esc in a field reverts it without committing or closing", () => {
    const onRenameRoom = vi.fn();
    const onClose = vi.fn();
    renderPopover({ onRenameRoom, onClose });

    const name = screen.getByLabelText("Room name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Studio" } });
    fireEvent.keyDown(name, { key: "Escape" });
    fireEvent.blur(name);

    expect(name.value).toBe("Living room");
    expect(onRenameRoom).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("esc outside a field closes the popover", () => {
    const onClose = vi.fn();
    renderPopover({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a pointerdown outside closes; inside or on the rail anchor stays open", () => {
    const onClose = vi.fn();
    renderPopover({ onClose });
    const anchor = document.createElement("button");
    anchor.setAttribute("data-settings-anchor", "");
    document.body.appendChild(anchor);

    fireEvent.pointerDown(screen.getByLabelText("Room name"));
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    anchor.remove();
  });

  it("renders a floor NAME field and a Delete floor button per floor", () => {
    renderPopover({
      floors: [
        {
          id: "floor-1",
          name: "",
          defaultName: "Ground floor",
          rooms: [createSampleRoom()],
        },
        {
          id: "floor-2",
          name: "Studio",
          defaultName: "Floor 2",
          rooms: [],
        },
      ],
      canDeleteFloor: true,
    });

    expect(
      (screen.getByLabelText("Ground floor name") as HTMLInputElement).value,
    ).toBe("Ground floor");
    expect(
      (screen.getByLabelText("Floor 2 name") as HTMLInputElement).value,
    ).toBe("Studio");
    expect(
      screen.getAllByRole("button", { name: "Delete floor" }),
    ).toHaveLength(2);
  });

  it("disables Delete floor when canDeleteFloor is false", () => {
    renderPopover({ canDeleteFloor: false });

    expect(
      screen
        .getByRole("button", { name: "Delete floor" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("commits a floor rename on blur, keyed by floor id", () => {
    const onRenameFloor = vi.fn();
    renderPopover({ onRenameFloor });

    const name = screen.getByLabelText("Ground floor name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Studio" } });
    fireEvent.blur(name);

    expect(onRenameFloor).toHaveBeenCalledWith("floor-1", "Studio");
  });

  it("confirms before deleting a floor, with the removal copy, and calls onDeleteFloor", () => {
    const onDeleteFloor = vi.fn();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    renderPopover({ onDeleteFloor, canDeleteFloor: true });

    fireEvent.click(screen.getByRole("button", { name: "Delete floor" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete Ground floor? Its rooms and furniture are removed; stairs rising to it from below are removed too.",
    );
    expect(onDeleteFloor).toHaveBeenCalledWith("floor-1");
    confirmSpy.mockRestore();
  });

  it("does not delete when the confirm is dismissed", () => {
    const onDeleteFloor = vi.fn();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    renderPopover({ onDeleteFloor, canDeleteFloor: true });

    fireEvent.click(screen.getByRole("button", { name: "Delete floor" }));

    expect(onDeleteFloor).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
