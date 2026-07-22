import { Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  MAX_WALL_HEIGHT,
  MIN_WALL_HEIGHT,
  type Room,
  wallHeightOf,
} from "#/lib/model";
import { formatLengthValue, parseLength, type Unit } from "#/lib/units";

/**
 * The Settings rail button's destination: a small Paper popover beside the
 * rail with the room-level settings — the room name (feeding the header
 * breadcrumb and persistence) and the wall/ceiling height. Fields commit on
 * blur/⏎ (one history step each, via the pure room setters); esc reverts the
 * focused field first, then closes the popover; clicking anywhere outside
 * commits the focused field and closes.
 */

interface SettingFieldProps {
  label: string;
  ariaLabel: string;
  /** Unit hint inside the field's right edge; empty for the name field. */
  suffix: string;
  mono?: boolean;
  /** Canonical value; the field re-seeds from it when it changes. */
  value: string;
  /** Parse + apply the typed text; invalid input is the handler's to drop. */
  onCommit: (text: string) => void;
}

/** Caps label over an editable value — the inspector's field, popover-sized. */
function SettingField({
  label,
  ariaLabel,
  suffix,
  mono = false,
  value,
  onCommit,
}: SettingFieldProps) {
  const [text, setText] = useState(value);
  // Escape sets this so the blur it triggers reverts instead of committing.
  const cancelledRef = useRef(false);
  useEffect(() => setText(value), [value]);

  const handleBlur = () => {
    if (!cancelledRef.current && text !== value) onCommit(text);
    cancelledRef.current = false;
    // Snap back to canonical: a successful commit re-seeds via the effect,
    // an invalid or clamped-to-same one lands right here.
    setText(value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      cancelledRef.current = true;
      setText(value);
      event.currentTarget.blur();
    }
  };

  return (
    <label className="flex min-w-0 flex-col gap-[3px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] px-[11px] py-2 focus-within:border-[var(--blue)]">
      <span className="text-[10px] text-[var(--ink-400)] tracking-[0.05em]">
        {label}
      </span>
      <span className="flex items-baseline">
        <input
          type="text"
          inputMode={mono ? "decimal" : undefined}
          aria-label={ariaLabel}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={
            mono
              ? "w-full min-w-0 bg-transparent font-mono text-[14px] text-[var(--ink-900)] outline-none"
              : "w-full min-w-0 bg-transparent text-[14px] text-[var(--ink-900)] outline-none"
          }
        />
        {suffix && (
          <span className="font-mono text-[11px] text-[var(--ink-300)]">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

export interface SettingsPopoverProps {
  /** Every floor in the building, ground-first — each gets its own NAME +
   * Delete floor row, then a section per room on that floor. */
  floors: Array<{
    id: string;
    /** Raw stored name; empty when the floor has never been renamed. */
    name: string;
    /** The derived display name ("Ground floor" / "Floor 2"…), shown when
     * `name` is empty. */
    defaultName: string;
    rooms: Room[];
  }>;
  unit: Unit;
  /** A committed room rename; empty input never arrives (the field snaps
   * back). */
  onRenameRoom: (floorId: string, roomId: string, name: string) => void;
  /** A committed wall/ceiling height, meters (the setter clamps it). */
  onRoomWallHeight: (floorId: string, roomId: string, meters: number) => void;
  /** A committed floor rename; empty input never arrives. */
  onRenameFloor: (floorId: string, name: string) => void;
  /** Confirmed (the popover owns the `window.confirm` gate — it has the
   * floor's display name to word the copy). */
  onDeleteFloor: (floorId: string) => void;
  /** False when the building has just one floor — a building always keeps
   * at least one. */
  canDeleteFloor: boolean;
  onClose: () => void;
}

export function SettingsPopover({
  floors,
  unit,
  onRenameRoom,
  onRoomWallHeight,
  onRenameFloor,
  onDeleteFloor,
  canDeleteFloor,
  onClose,
}: SettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Esc closes — unless it lands in one of the fields, whose own handler
  // reverts the field first (the next esc closes). Capture phase, so the
  // stopPropagation keeps the close-esc away from the draw/tool listeners.
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof HTMLElement &&
        popoverRef.current?.contains(event.target) &&
        event.target.closest("input")
      ) {
        return;
      }
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  // A press anywhere outside closes; blurring first lets a mid-edit field
  // commit before the popover unmounts. The rail's Settings button is exempt
  // so its own click toggles instead of close-then-reopen.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest("[data-settings-anchor]")) return;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const commitRoomName =
    (floorId: string, roomId: string) => (text: string) => {
      const trimmed = text.trim();
      if (trimmed !== "") onRenameRoom(floorId, roomId, trimmed);
    };
  const commitRoomWallHeight =
    (floorId: string, roomId: string) => (text: string) => {
      const meters = parseLength(text, unit);
      if (meters !== null) onRoomWallHeight(floorId, roomId, meters);
    };
  const commitFloorName = (floorId: string) => (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== "") onRenameFloor(floorId, trimmed);
  };
  // The popover owns the confirm gate: it has the floor's effective display
  // name in hand for the copy, and `onDeleteFloor` only ever fires once the
  // user has confirmed.
  const handleDeleteFloor = (floorId: string, displayName: string) => {
    if (
      window.confirm(
        `Delete ${displayName}? Its rooms and furniture are removed; stairs rising to it from below are removed too.`,
      )
    ) {
      onDeleteFloor(floorId);
    }
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Room settings"
      className="fixed bottom-[14px] left-[72px] z-50 flex max-h-[70vh] w-[268px] flex-col gap-2.5 overflow-y-auto rounded-[12px] border border-[var(--hairline)] bg-[var(--frame)] p-[14px]"
      style={{ boxShadow: "0 14px 34px rgba(15, 27, 61, 0.14)" }}
    >
      <div className="font-semibold text-[11px] text-[var(--ink-400)] tracking-[0.11em]">
        ROOM SETTINGS
      </div>
      {floors.map((floor, floorIndex) => {
        const displayName = floor.name || floor.defaultName;
        const single = floor.rooms.length === 1;
        return (
          <div key={floor.id} className="flex flex-col gap-2.5">
            {floorIndex > 0 && <div className="h-px bg-[var(--hairline)]" />}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <SettingField
                  label="FLOOR NAME"
                  ariaLabel={`${floor.defaultName} name`}
                  suffix=""
                  value={displayName}
                  onCommit={commitFloorName(floor.id)}
                />
              </div>
              <button
                type="button"
                aria-label="Delete floor"
                disabled={!canDeleteFloor}
                onClick={() => handleDeleteFloor(floor.id, displayName)}
                className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--danger)_22%,transparent)] bg-[color-mix(in_srgb,var(--danger)_5%,transparent)] px-2.5 py-[9px] text-[12px] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[color-mix(in_srgb,var(--danger)_5%,transparent)]"
              >
                <Trash2 width={14} height={14} strokeWidth={1.6} />
                Delete floor
              </button>
            </div>
            {floor.rooms.map((room, roomIndex) => (
              <div key={room.id} className="flex flex-col gap-2.5">
                <SettingField
                  label="NAME"
                  ariaLabel={
                    single
                      ? `${floor.defaultName} room name`
                      : `${floor.defaultName} room ${roomIndex + 1} name`
                  }
                  suffix=""
                  value={room.name ?? "Untitled room"}
                  onCommit={commitRoomName(floor.id, room.id)}
                />
                <SettingField
                  label="CEILING HEIGHT"
                  ariaLabel={
                    single
                      ? `${floor.defaultName} room ceiling height`
                      : `${floor.defaultName} room ${roomIndex + 1} ceiling height`
                  }
                  suffix={unit}
                  mono
                  value={formatLengthValue(wallHeightOf(room), unit)}
                  onCommit={commitRoomWallHeight(floor.id, room.id)}
                />
              </div>
            ))}
          </div>
        );
      })}
      <div className="text-[11.5px] text-[var(--ink-400)] leading-relaxed">
        {formatLengthValue(MIN_WALL_HEIGHT, unit)}–
        {formatLengthValue(MAX_WALL_HEIGHT, unit)} {unit} — door and window
        heads stay below the ceiling.
      </div>
    </div>
  );
}
