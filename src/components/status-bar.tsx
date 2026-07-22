import { Grid2x2, Magnet } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { CameraReadoutStore } from "#/lib/camera";
import { scaleDenominator } from "#/lib/camera";
import { type Room, totalFloorArea } from "#/lib/model";
import type { Unit } from "#/lib/units";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface StatusBarProps {
  mode: ViewMode;
  /** The objects library is docked — the left context counts placed objects. */
  libraryOpen?: boolean;
  /** The floor's derived rooms (area total, room name/count). */
  rooms: Room[];
  /** Total placed objects on the floor (`floor.furniture.length`) — includes
   * the unassigned/open-canvas items, so it counts everything, not just what
   * landed in a room. */
  objectCount?: number;
  /** Name of the selected item's containing room, or "—" when unassigned. */
  selectedRoomName?: string | null;
  /** Live camera state for the right-edge readout. */
  cameraReadout: CameraReadoutStore;
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  /** Number of graph nodes (corners) — drives the draw status text. */
  nodeCount?: number;
  /** Catalog item mid-placement; takes over the objects status text. */
  placingName?: string | null;
  /** The selected opening is a portal — "Door connects Living ↔ Kitchen"
   * (derived from wall abutment, never stored); takes over the context. */
  portalStatus?: string | null;
  /** The active floor's display name ("Ground floor" / "Floor 2"…) on a
   * multi-floor building; null/absent on a one-floor building, where the
   * floor is never worth naming out loud. Rendered leading, ahead of the
   * area. */
  floorName?: string | null;
}

const noStore: Pick<CameraReadoutStore, "subscribe" | "getSnapshot"> = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

function drawStatusText(nodeCount: number): string {
  if (nodeCount === 0) return "Draw walls to start a room";
  const noun = nodeCount === 1 ? "corner" : "corners";
  return `Editing walls — ${nodeCount} ${noun}`;
}

/** Snap label per mode, matching the 2b/2d status bars (a live placement
 * drag upgrades it to the 2d screen's "walls + objects" wording). */
const SNAP_LABEL: Record<ViewMode, string> = {
  "3d": "Snap",
  "2d": "Snap",
  draw: "Snap 90°",
};

/**
 * The 38px status bar (screens 2b/2d): quiet facts on the left (floor area,
 * room name or the current activity), quiet controls on the right (snap and
 * grid toggles, cm/m units, live camera readout). Toggles read lit in blue
 * when on, muted ink when off.
 */
export function StatusBar({
  mode,
  libraryOpen = false,
  rooms,
  objectCount = 0,
  selectedRoomName = null,
  cameraReadout,
  unit,
  onUnitChange,
  gridVisible,
  onToggleGrid,
  snapEnabled,
  onToggleSnap,
  nodeCount = 0,
  placingName = null,
  portalStatus = null,
  floorName = null,
}: StatusBarProps) {
  const live = useSyncExternalStore(
    (cameraReadout ?? noStore).subscribe,
    (cameraReadout ?? noStore).getSnapshot,
    () => null,
  );

  // Floor totals: every room's area summed (null until an outline exists).
  const area = rooms.some((room) => room.outline.length >= 3)
    ? totalFloorArea(rooms)
    : null;
  const multiRoom = rooms.length > 1;

  // Left side at rest: the room name (or the room count on a multi-room
  // floor, plus the selection's containing room); the current activity
  // takes over.
  let context: string = multiRoom
    ? `${rooms.length} rooms${selectedRoomName ? ` · ${selectedRoomName}` : ""}`
    : (rooms[0]?.name ?? "Untitled room");
  if (mode === "draw") {
    context = drawStatusText(nodeCount);
  } else if (placingName) {
    context = `Placing “${placingName}” — drop to confirm`;
  } else if (portalStatus) {
    context = portalStatus;
  } else if (libraryOpen) {
    context = `${objectCount} objects placed`;
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
        {floorName != null && (
          <>
            <span className="text-[var(--ink-700)]">{floorName}</span>
            <span aria-hidden="true" className="text-[var(--ink-200)]">
              ·
            </span>
          </>
        )}
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
          {placingName ? "Snap · walls + objects" : SNAP_LABEL[mode]}
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
