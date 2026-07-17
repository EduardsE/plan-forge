import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_OF_DAY,
  LIGHTING,
  TIME_OF_DAY_ORDER,
  type TimeOfDay,
} from "./lighting";

describe("lighting presets", () => {
  it("orders every preset once, chronologically", () => {
    expect(TIME_OF_DAY_ORDER).toEqual(["dawn", "day", "golden", "dusk"]);
    expect(new Set(TIME_OF_DAY_ORDER).size).toBe(TIME_OF_DAY_ORDER.length);
    expect(Object.keys(LIGHTING).sort()).toEqual([...TIME_OF_DAY_ORDER].sort());
  });

  it("defaults to a preset that exists", () => {
    expect(LIGHTING[DEFAULT_TIME_OF_DAY]).toBeDefined();
  });

  it("keeps every preset's values in sane ranges", () => {
    for (const key of TIME_OF_DAY_ORDER) {
      const p = LIGHTING[key];
      expect(p.label.length).toBeGreaterThan(0);
      // Sun above the horizon and below the zenith, positive intensity.
      expect(p.sun.elevationDeg).toBeGreaterThan(0);
      expect(p.sun.elevationDeg).toBeLessThan(90);
      expect(p.sun.intensity).toBeGreaterThan(0);
      // Rake stays within a quarter-turn either way of opposite-camera.
      expect(Math.abs(p.sun.rakeDeg)).toBeLessThanOrEqual(90);
      expect(p.ambient.intensity).toBeGreaterThan(0);
      expect(p.pool).toHaveLength(3);
    }
  });

  it("lifts the sun highest and brightest at midday", () => {
    const midday = LIGHTING.day;
    for (const key of ["dawn", "golden", "dusk"] as TimeOfDay[]) {
      expect(midday.sun.elevationDeg).toBeGreaterThan(
        LIGHTING[key].sun.elevationDeg,
      );
      expect(midday.sun.intensity).toBeGreaterThanOrEqual(
        LIGHTING[key].sun.intensity,
      );
    }
  });
});
