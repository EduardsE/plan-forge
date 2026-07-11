import { Minus, Plus } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Tooltip } from "#/components/tooltip";
import type { CameraReadoutStore } from "#/lib/camera";
import { scaleDenominator } from "#/lib/camera";

interface ZoomPillProps {
  cameraReadout: CameraReadoutStore;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
}

/**
 * Bottom-left zoom control (screen 2b): − / readout / +. The readout shows
 * the live zoom (orbit % relative to fit, or the plan's paper scale) and is
 * itself the fit-to-view button.
 */
export function ZoomPill({
  cameraReadout,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: ZoomPillProps) {
  const live = useSyncExternalStore(
    cameraReadout.subscribe,
    cameraReadout.getSnapshot,
    () => null,
  );
  let readout = "100%";
  if (live?.kind === "orbit") readout = `${Math.round(live.zoom * 100)}%`;
  else if (live?.kind === "plan")
    readout = `1:${scaleDenominator(live.pxPerMeter)}`;

  return (
    <div
      className="absolute bottom-5 left-5 flex items-center rounded-[9px] border border-[var(--control-border)] bg-[var(--frame)] p-[2px]"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <Tooltip label="Zoom out" side="top">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={onZoomOut}
          className="flex h-[30px] w-8 items-center justify-center rounded-[7px] text-[var(--ink-600)] hover:bg-[var(--well)]"
        >
          <Minus width={16} height={16} strokeWidth={1.7} />
        </button>
      </Tooltip>
      <Tooltip label="Fit to view" side="top">
        <button
          type="button"
          aria-label="Fit to view"
          onClick={onZoomToFit}
          className="min-w-11 rounded-[7px] px-2 text-center font-mono text-[12.5px] text-[var(--ink-700)] leading-[30px] hover:bg-[var(--well)]"
        >
          {readout}
        </button>
      </Tooltip>
      <Tooltip label="Zoom in" side="top">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={onZoomIn}
          className="flex h-[30px] w-8 items-center justify-center rounded-[7px] text-[var(--ink-600)] hover:bg-[var(--well)]"
        >
          <Plus width={16} height={16} strokeWidth={1.7} />
        </button>
      </Tooltip>
    </div>
  );
}
