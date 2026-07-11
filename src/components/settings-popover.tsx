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
  /** Every room on the floor — each gets its own name + ceiling fields. */
  rooms: Room[];
  unit: Unit;
  /** A committed rename; empty input never arrives (the field snaps back). */
  onRename: (roomId: string, name: string) => void;
  /** A committed wall/ceiling height, meters (the setter clamps it). */
  onWallHeightChange: (roomId: string, meters: number) => void;
  onClose: () => void;
}

export function SettingsPopover({
  rooms,
  unit,
  onRename,
  onWallHeightChange,
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

  const commitName = (roomId: string) => (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== "") onRename(roomId, trimmed);
  };
  const commitWallHeight = (roomId: string) => (text: string) => {
    const meters = parseLength(text, unit);
    if (meters !== null) onWallHeightChange(roomId, meters);
  };
  const single = rooms.length === 1;

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
      {rooms.map((room, index) => (
        <div key={room.id} className="flex flex-col gap-2.5">
          {index > 0 && <div className="h-px bg-[var(--hairline)]" />}
          <SettingField
            label="NAME"
            ariaLabel={single ? "Room name" : `Room ${index + 1} name`}
            suffix=""
            value={room.name ?? "Untitled room"}
            onCommit={commitName(room.id)}
          />
          <SettingField
            label="CEILING HEIGHT"
            ariaLabel={
              single ? "Ceiling height" : `Room ${index + 1} ceiling height`
            }
            suffix={unit}
            mono
            value={formatLengthValue(wallHeightOf(room), unit)}
            onCommit={commitWallHeight(room.id)}
          />
        </div>
      ))}
      <div className="text-[11.5px] text-[var(--ink-400)] leading-relaxed">
        {formatLengthValue(MIN_WALL_HEIGHT, unit)}–
        {formatLengthValue(MAX_WALL_HEIGHT, unit)} {unit} — door and window
        heads stay below the ceiling.
      </div>
    </div>
  );
}
