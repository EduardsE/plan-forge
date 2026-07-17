import { Sun } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import type { CameraReadoutStore } from "#/lib/camera";
import { cn } from "#/lib/utils";

interface SunDialProps {
  /** Effective world sun azimuth in degrees (`atan2(z, x)`), rake included. */
  sunAzimuthDeg: number;
  /** True when the user has aimed the sun (vs the automatic glazing anchor). */
  overridden: boolean;
  /** Live camera state — the dial rotates with the orbit so the dot always
   * points at the sun's side of the *view*, not of the abstract plan. */
  readout: CameraReadoutStore;
  /** Drag callback: the aimed world sun azimuth in degrees. */
  onAim: (sunAzimuthDeg: number) => void;
  /** Double-click: return to the automatic anchor. */
  onReset: () => void;
}

const DIAL_SIZE = 30;
const DOT_SIZE = 7;
/** Rim radius the dot rides on, inside the hairline ring. */
const DOT_RADIUS = DIAL_SIZE / 2 - DOT_SIZE / 2 - 2.5;

/**
 * The compass dial on the time-of-day pill: a top-down view of the model with
 * the sun as a draggable dot on the rim. Drag the dot toward the side the
 * light should come from (screen-relative — up on the dial is away from the
 * viewer); double-click to hand aiming back to the most-glazed-wall
 * automatic. The dot counter-rotates while orbiting because the sun is fixed
 * in the world and the view is not.
 *
 * Screen mapping: with θ = the camera's spherical theta and ψ = the world
 * azimuth (`atan2(z, x)`), a world direction lands on the view-aligned dial
 * at CSS angle α = ψ + θ (x right, y down). Aiming inverts it: ψ = α − θ.
 */
export function SunDial({
  sunAzimuthDeg,
  overridden,
  readout,
  onAim,
  onReset,
}: SunDialProps) {
  const camera = useSyncExternalStore(
    readout.subscribe,
    readout.getSnapshot,
    () => null,
  );
  const cameraDeg = camera?.kind === "orbit" ? camera.azimuthDeg : 0;
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const alpha = ((sunAzimuthDeg + cameraDeg) * Math.PI) / 180;
  const dotX = Math.cos(alpha) * DOT_RADIUS;
  const dotY = Math.sin(alpha) * DOT_RADIUS;

  const aimFromPointer = (event: React.PointerEvent) => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    // Dead zone: a click near the hub (double-click resets there) must not
    // fling the sun toward whatever half-pixel it landed on.
    if (Math.hypot(dx, dy) < 4) return;
    const aimedAlpha = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Normalize to (-180, 180] so the stored override stays tidy.
    const psi = ((((aimedAlpha - cameraDeg) % 360) + 540) % 360) - 180;
    onAim(psi);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Sun direction"
      title="Sun direction — drag to aim, double-click for auto"
      className="relative shrink-0 cursor-grab rounded-full border border-[var(--control-border)] bg-[var(--well)] active:cursor-grabbing"
      style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        aimFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        aimFromPointer(event);
      }}
      onDoubleClick={onReset}
    >
      <Sun
        width={11}
        height={11}
        strokeWidth={1.7}
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 text-[var(--ink-400)]"
      />
      <span
        className={cn(
          "absolute top-1/2 left-1/2 rounded-full",
          overridden ? "bg-[var(--blue)]" : "bg-[var(--ink-400)]",
        )}
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          transform: `translate(calc(-50% + ${dotX.toFixed(2)}px), calc(-50% + ${dotY.toFixed(2)}px))`,
        }}
      />
    </button>
  );
}
