/**
 * Time-of-day lighting presets for the 3D lens. Pure data + types — the scene
 * (src/components/room-scene.tsx) reads a preset to drive the sun, ambient and
 * fill; the route (src/routes/index.tsx) reads the same preset's `pool` stops
 * to tint the CSS studio-pool background so the canvas shares the hour's
 * warmth. No three/React imports here, so the table is unit-testable directly.
 *
 * Each preset expresses the hour through the sun's *height, colour and
 * brightness* (plus a rake swing), never a free azimuth — the sun's azimuth
 * stays slaved to the camera in the scene so daylight patches always fall on
 * the visible floor, whatever the hour.
 */

export type TimeOfDay = "dawn" | "day" | "golden" | "dusk";

/** Left-to-right chronological order for the segmented control. */
export const TIME_OF_DAY_ORDER: TimeOfDay[] = ["dawn", "day", "golden", "dusk"];

/** Opens on the bright, neutral midday look (best for reading the room). */
export const DEFAULT_TIME_OF_DAY: TimeOfDay = "day";

export interface LightingPreset {
  /** Segmented-control label. */
  label: string;
  /**
   * The shadow-casting sun. `elevationDeg` is its height over the horizon;
   * `rakeDeg` swings its azimuth off dead-opposite-the-camera — the sign flips
   * the side the beams rake from, so morning and evening read differently even
   * though both keep patches on the visible floor.
   */
  sun: {
    color: string;
    intensity: number;
    elevationDeg: number;
    rakeDeg: number;
  };
  /** Flat fill so surfaces the sun misses don't crush to black. */
  ambient: { color: string; intensity: number };
  /** Warm window-side key light intensity. */
  key: number;
  /** Cool open-side fill intensity. */
  fill: number;
  /**
   * The studio-pool gradient's three colour stops (centre → mid → edge),
   * matched to the hour. Positions stay in CSS; only the colours vary.
   */
  pool: [string, string, string];
}

export const LIGHTING: Record<TimeOfDay, LightingPreset> = {
  dawn: {
    label: "Dawn",
    sun: { color: "#ffe1c6", intensity: 1.95, elevationDeg: 17, rakeDeg: -40 },
    ambient: { color: "#e9e6ee", intensity: 0.46 },
    key: 0.3,
    fill: 0.16,
    pool: [
      "rgba(253,247,247,0.95)",
      "rgba(219,214,226,0.5)",
      "rgba(128,122,150,0.3)",
    ],
  },
  day: {
    label: "Day",
    sun: { color: "#fff4e2", intensity: 3.0, elevationDeg: 60, rakeDeg: 14 },
    // Neutral-warm, not cool: midday should still read as an inviting room.
    ambient: { color: "#f2eee6", intensity: 0.52 },
    key: 0.42,
    fill: 0.2,
    pool: [
      "rgba(255,254,251,0.95)",
      "rgba(216,215,216,0.55)",
      "rgba(126,124,132,0.3)",
    ],
  },
  golden: {
    label: "Golden",
    sun: { color: "#ffca8a", intensity: 2.7, elevationDeg: 27, rakeDeg: 30 },
    ambient: { color: "#f6e8d4", intensity: 0.44 },
    key: 0.4,
    fill: 0.15,
    pool: [
      "rgba(255,247,232,0.96)",
      "rgba(238,214,184,0.5)",
      "rgba(150,116,90,0.3)",
    ],
  },
  dusk: {
    label: "Dusk",
    sun: { color: "#ff9f63", intensity: 1.7, elevationDeg: 12, rakeDeg: 46 },
    ambient: { color: "#eedac6", intensity: 0.38 },
    key: 0.3,
    fill: 0.14,
    pool: [
      "rgba(255,240,224,0.95)",
      "rgba(228,196,170,0.5)",
      "rgba(122,96,112,0.32)",
    ],
  },
};
