import { SunDial } from "#/components/sun-dial";
import type { CameraReadoutStore } from "#/lib/camera";
import { LIGHTING, TIME_OF_DAY_ORDER, type TimeOfDay } from "#/lib/lighting";
import { cn } from "#/lib/utils";

interface TimeOfDayControlProps {
  value: TimeOfDay;
  onChange: (value: TimeOfDay) => void;
  /** Effective world sun azimuth in degrees (anchor + preset rake). */
  sunAzimuthDeg: number;
  /** True when the user has aimed the sun manually. */
  sunOverridden: boolean;
  /** Live camera state for the view-aligned dial. */
  readout: CameraReadoutStore;
  onAimSun: (sunAzimuthDeg: number) => void;
  onResetSun: () => void;
}

/**
 * Floating lighting cluster, 3D lens only: the sun-direction dial plus a
 * segmented Dawn·Day·Golden·Dusk that drives the sun (height/colour/
 * brightness), the ambient fill and the studio-pool warmth. Styled like the
 * header's 2D|3D switch, wrapped in the zoom pill's floating frame so it
 * reads over the studio pool. Bottom-centre, clear of the bottom-left zoom
 * pill.
 */
export function TimeOfDayControl({
  value,
  onChange,
  sunAzimuthDeg,
  sunOverridden,
  readout,
  onAimSun,
  onResetSun,
}: TimeOfDayControlProps) {
  return (
    <div
      className="-translate-x-1/2 absolute bottom-5 left-1/2 flex items-center gap-1.5 rounded-[9px] border border-[var(--control-border)] bg-[var(--frame)] p-[3px]"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <SunDial
        sunAzimuthDeg={sunAzimuthDeg}
        overridden={sunOverridden}
        readout={readout}
        onAim={onAimSun}
        onReset={onResetSun}
      />
      <div className="flex gap-0.5 rounded-[7px] bg-[var(--well)] p-[3px]">
        {TIME_OF_DAY_ORDER.map((key) => {
          const isActive = key === value;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(key)}
              className={cn(
                "rounded-[6px] px-3 py-1 text-[12.5px]",
                isActive
                  ? "bg-[var(--frame)] font-semibold text-[var(--ink-900)]"
                  : "font-medium text-[var(--ink-500)] hover:text-[var(--ink-700)]",
              )}
              style={
                isActive ? { boxShadow: "var(--shadow-control)" } : undefined
              }
            >
              {LIGHTING[key].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
