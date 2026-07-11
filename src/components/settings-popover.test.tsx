import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSampleRoom } from "#/lib/model";
import { SettingsPopover } from "./settings-popover";

function renderPopover(
  props: Partial<Parameters<typeof SettingsPopover>[0]> = {},
) {
  return render(
    <SettingsPopover
      room={createSampleRoom()}
      unit="m"
      onRename={() => {}}
      onWallHeightChange={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("SettingsPopover", () => {
  it("shows the room name and the effective ceiling height", () => {
    renderPopover({ room: { ...createSampleRoom(), wallHeight: 3.1 } });

    expect((screen.getByLabelText("Room name") as HTMLInputElement).value).toBe(
      "Living room",
    );
    expect(
      (screen.getByLabelText("Ceiling height") as HTMLInputElement).value,
    ).toBe("3.10");
  });

  it("falls back to the default ceiling height and honors the unit", () => {
    renderPopover({ unit: "cm" });

    expect(
      (screen.getByLabelText("Ceiling height") as HTMLInputElement).value,
    ).toBe("250");
  });

  it("commits a rename on blur, trimmed; empty input never commits", () => {
    const onRename = vi.fn();
    renderPopover({ onRename });

    const name = screen.getByLabelText("Room name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  Studio " } });
    fireEvent.blur(name);
    expect(onRename).toHaveBeenCalledWith("Studio");

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(onRename).toHaveBeenCalledOnce();
    // The field snaps back to the canonical name.
    expect(name.value).toBe("Living room");
  });

  it("commits a ceiling height in the active unit, in meters", () => {
    const onWallHeightChange = vi.fn();
    renderPopover({ unit: "cm", onWallHeightChange });

    const height = screen.getByLabelText("Ceiling height") as HTMLInputElement;
    fireEvent.change(height, { target: { value: "310" } });
    fireEvent.blur(height);

    expect(onWallHeightChange).toHaveBeenCalledWith(3.1);
  });

  it("drops unparsable height input and snaps the field back", () => {
    const onWallHeightChange = vi.fn();
    renderPopover({ onWallHeightChange });

    const height = screen.getByLabelText("Ceiling height") as HTMLInputElement;
    fireEvent.change(height, { target: { value: "tall" } });
    fireEvent.blur(height);

    expect(onWallHeightChange).not.toHaveBeenCalled();
    expect(height.value).toBe("2.50");
  });

  it("esc in a field reverts it without committing or closing", () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    renderPopover({ onRename, onClose });

    const name = screen.getByLabelText("Room name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Studio" } });
    fireEvent.keyDown(name, { key: "Escape" });
    fireEvent.blur(name);

    expect(name.value).toBe("Living room");
    expect(onRename).not.toHaveBeenCalled();
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
});
