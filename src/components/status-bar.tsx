import { Grid2x2, Magnet } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { CameraReadoutStore } from "#/lib/camera";
import { scaleDenominator } from "#/lib/camera";
import { type Floor, totalFloorArea } from "#/lib/model";
import type { Unit } from "#/lib/units";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface StatusBarProps {
  mode: ViewMode;
  floor: Floor;
  /** Name of the selected item's containing room (floor-wide selection). */
  selectedRoomName?: string | null;
  /** Live camera state for the right-edge readout. */
  cameraReadout: CameraReadoutStore;
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  /** Corners placed so far in the draw draft; drives the draw status text. */
  draftCornerCount?: number;
  /** Draw mode is editing the existing outline, not drawing a fresh one. */
  draftClosed?: boolean;
  /** Catalog item mid-placement; takes over the objects status text. */
  placingName?: string | null;
  /** Armed door/window tool on the 2D lens; takes over its status text. */
  openingTool?: "door" | "window" | null;
}

const noStore: Pick<CameraReadoutStore, "subscribe" | "getSnapshot"> = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

function drawStatusText(cornerCount: number, editing: boolean): string {
  if (editing) return `Editing room outline — ${cornerCount} corners`;
  if (cornerCount === 0) return "Click to place the first corner";
  const noun = cornerCount === 1 ? "corner" : "corners";
  return `Drawing — ${cornerCount} ${noun} placed`;
}

/** Snap label per mode, matching the 2b/2d status bars. */
const SNAP_LABEL: Record<ViewMode, string> = {
  "3d": "Snap",
  "2d": "Snap",
  draw: "Snap 90°",
  objects: "Snap · walls + objects",
};

/**
 * The 38px status bar (screens 2b/2d): quiet facts on the left (floor area,
 * room name or the current activity), quiet controls on the right (snap and
 * grid toggles, cm/m units, live camera readout). Toggles read lit in blue
 * when on, muted ink when off.
 */
export function StatusBar({
  mode,
  floor,
  selectedRoomName = null,
  cameraReadout,
  unit,
  onUnitChange,
  gridVisible,
  onToggleGrid,
  snapEnabled,
  onToggleSnap,
  draftCornerCount = 0,
  draftClosed = false,
  placingName = null,
  openingTool = null,
}: StatusBarProps) {
  const live = useSyncExternalStore(
    (cameraReadout ?? noStore).subscribe,
    (cameraReadout ?? noStore).getSnapshot,
    () => null,
  );

  // Floor totals: every room's area summed (null until an outline exists).
  const area = floor.rooms.some((room) => room.outline.length >= 3)
    ? totalFloorArea(floor)
    : null;
  const multiRoom = floor.rooms.length > 1;
  const objectCount = floor.rooms.reduce(
    (sum, room) => sum + room.furniture.length,
    0,
  );

  // Left side at rest: the room name (or the room count on a multi-room
  // floor, plus the selection's containing room); the current activity
  // takes over.
  let context: string = multiRoom
    ? `${floor.rooms.length} rooms${selectedRoomName ? ` · ${selectedRoomName}` : ""}`
    : (floor.rooms[0]?.name ?? "Untitled room");
  if (mode === "draw") {
    context = drawStatusText(draftCornerCount, draftClosed);
  } else if (mode === "2d" && openingTool) {
    context = `Placing a ${openingTool} — click a wall to insert it`;
  } else if (mode === "objects") {
    context = placingName
      ? `Placing “${placingName}” — drop to confirm`
      : `${objectCount} objects placed`;
  }

  // Right-edge camera readout: orbit angles under the perspective camera,
  // paper scale under the ortho one (zoom % lives in the canvas zoom pill).
  let readout: string | null = null;
  if (live?.kind === "orbit") {
    const azimuth = ((Math.round(live.azimuthDeg) % 360) + 360) % 360;
    readout = `orbit ${azimuth}° / ${Math.round(live.polarDeg)}°`;
  } else if (live?.kind === "plan") {
    readout = `1 : ${scaleDenominator(live.pxPerMeter)}`;
  }

  const gridStep = unit === "cm" ? "50 cm" : "0.5 m";

  return (
    <div
      className="flex items-center justify-between border-[var(--hairline)] border-t bg-[var(--frame)] px-[18px] text-[12px]"
      style={{ gridArea: "status" }}
    >
      <div className="flex min-w-0 items-center gap-3 text-[var(--ink-500)]">
        {area !== null && (
          <>
            <span className="font-mono text-[var(--ink-700)]">
              {area.toFixed(2)} m²
            </span>
            <span aria-hidden="true" className="text-[var(--ink-200)]">
              ·
            </span>
          </>
        )}
        <span className="truncate">{context}</span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-pressed={snapEnabled}
          aria-label="Toggle snapping"
          onClick={onToggleSnap}
          className={cn(
            "flex items-center gap-1.5",
            snapEnabled
              ? "text-[var(--ink-500)]"
              : "text-[var(--ink-300)] line-through",
          )}
        >
          <Magnet
            width={14}
            height={14}
            strokeWidth={1.6}
            style={{
              color: snapEnabled ? "var(--blue)" : "var(--ink-300)",
            }}
          />
          {SNAP_LABEL[mode]}
        </button>
        <button
          type="button"
          aria-pressed={gridVisible}
          aria-label="Toggle grid"
          onClick={onToggleGrid}
          className={cn(
            "flex items-center gap-1.5",
            gridVisible
              ? "text-[var(--ink-500)]"
              : "text-[var(--ink-300)] line-through",
          )}
        >
          <Grid2x2
            width={14}
            height={14}
            strokeWidth={1.6}
            style={{
              color: gridVisible ? "var(--blue)" : "var(--ink-300)",
            }}
          />
          Grid {gridStep}
        </button>
        <div className="flex items-center gap-px">
          {(["cm", "m"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === unit}
              onClick={() => onUnitChange(option)}
              className={cn(
                "rounded-[5px] px-1.5 py-0.5",
                option === unit
                  ? "bg-[var(--well)] font-semibold text-[var(--ink-700)]"
                  : "text-[var(--ink-300)] hover:text-[var(--ink-500)]",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {readout && (
          <>
            <span aria-hidden="true" className="text-[var(--ink-200)]">
              ·
            </span>
            <span className="font-mono text-[var(--ink-700)]">{readout}</span>
          </>
        )}
      </div>
    </div>
  );
}
