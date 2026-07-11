import { describe, expect, it } from "vitest";
import {
  createCameraReadoutStore,
  easeInOutCubic,
  formatOrbitReadout,
  formatPlanReadout,
  frustumDistance,
  frustumHeight,
  perspectiveFitDistance,
  planFitZoom,
  scaleDenominator,
  wrapAngle,
} from "./camera";

describe("scaleDenominator", () => {
  it("yields 1:50 at the px-per-meter that maps 96 dpi to 1:50", () => {
    // 1:50 means 1 m of room spans 2 cm of screen = 2 * 96/2.54 px.
    expect(scaleDenominator((2 * 96) / 2.54)).toBe(50);
  });

  it("halves the denominator when zooming in 2×", () => {
    const base = (2 * 96) / 2.54;
    expect(scaleDenominator(base * 2)).toBe(25);
  });
});

describe("formatOrbitReadout", () => {
  it("matches the mockup string at the mockup's initial orbit", () => {
    expect(
      formatOrbitReadout({
        kind: "orbit",
        azimuthDeg: 38,
        polarDeg: 62,
        zoom: 1,
      }),
    ).toBe("orbit 38° / 62° · zoom 1.0×");
  });

  it("normalizes negative azimuth into 0–359", () => {
    expect(
      formatOrbitReadout({
        kind: "orbit",
        azimuthDeg: -90,
        polarDeg: 45,
        zoom: 2.5,
      }),
    ).toBe("orbit 270° / 45° · zoom 2.5×");
  });
});

describe("formatPlanReadout", () => {
  it("matches the mockup string shape", () => {
    expect(
      formatPlanReadout({ kind: "plan", pxPerMeter: (2 * 96) / 2.54 }),
    ).toBe("scale 1 : 50 · grid 0.5 m");
  });
});

describe("planFitZoom", () => {
  it("fits the constraining axis exactly at fill 1", () => {
    // 6.4 × 5.2 m into 640 × 520 px: both axes give 100 px/m.
    expect(planFitZoom(6.4, 5.2, 640, 520, 1)).toBe(100);
  });

  it("is limited by the tighter axis", () => {
    // Wide viewport: height constrains. 520 px / 5.2 m = 100.
    expect(planFitZoom(6.4, 5.2, 5000, 520, 1)).toBe(100);
  });

  it("applies the fill margin", () => {
    expect(planFitZoom(6.4, 5.2, 640, 520, 0.5)).toBe(50);
  });
});

describe("perspectiveFitDistance", () => {
  it("fits a unit sphere at 90° fov square aspect at sqrt(2)", () => {
    expect(perspectiveFitDistance(1, 90, 1, 1)).toBeCloseTo(Math.SQRT2, 10);
  });

  it("uses the horizontal fov when the viewport is tall", () => {
    // aspect 0.5 halves tan of the half-angle; distance grows.
    const square = perspectiveFitDistance(1, 90, 1, 1);
    const tall = perspectiveFitDistance(1, 90, 0.5, 1);
    expect(tall).toBeGreaterThan(square);
  });

  it("scales linearly with margin", () => {
    expect(perspectiveFitDistance(2, 45, 1.6, 1.3)).toBeCloseTo(
      perspectiveFitDistance(2, 45, 1.6, 1) * 1.3,
      10,
    );
  });
});

describe("frustumHeight / frustumDistance", () => {
  it("spans 2× the distance at 90° fov", () => {
    expect(frustumHeight(1, 90)).toBeCloseTo(2, 10);
  });

  it("round-trips", () => {
    expect(frustumDistance(frustumHeight(7.3, 42), 42)).toBeCloseTo(7.3, 10);
  });
});

describe("wrapAngle", () => {
  it("keeps angles already in range", () => {
    expect(wrapAngle(0.3)).toBeCloseTo(0.3, 12);
    expect(wrapAngle(-3)).toBeCloseTo(-3, 12);
  });

  it("wraps full turns away", () => {
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
    expect(wrapAngle(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
  });
});

describe("easeInOutCubic", () => {
  it("pins the endpoints and midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("starts slower than linear and ends faster", () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });
});

describe("createCameraReadoutStore", () => {
  it("starts empty, publishes to subscribers, and unsubscribes cleanly", () => {
    const store = createCameraReadoutStore();
    expect(store.getSnapshot()).toBeNull();

    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });
    const readout = { kind: "plan", pxPerMeter: 100 } as const;
    store.publish(readout);
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(readout);

    unsubscribe();
    store.publish({ kind: "plan", pxPerMeter: 50 });
    expect(calls).toBe(1);
  });
});
