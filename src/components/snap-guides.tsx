import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import type { Point } from "#/lib/model";
import type { PlacementGuide } from "#/lib/place";
import { dashedPolyline } from "#/lib/plan-scene";
import { formatLength, type Unit } from "#/lib/units";

/**
 * The per-axis wall-distance guides from mockup screen 1d — dashed cyan
 * lines with teal readout pills — shared by the placement ghost and the
 * furniture move drag, which both get them from `snapPlacement`.
 */

const GUIDE_COLOR = "#3a5bf0";
/** Readout pill colors, from the mockup's "3.00 m" chips. */
const PILL_CLASS =
  "whitespace-nowrap rounded-[7px] bg-[#3a5bf0] px-2.5 py-[3px] font-mono text-[12.5px] text-white";

/** Stacked above the 3D floor top (0.001) and the rug (top ≈ 0.017). */
const GUIDE_Y = 0.026;
const LABEL_Y = 0.032;

function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

export interface SnapGuidesProps {
  guides: PlacementGuide[];
  unit: Unit;
}

export function SnapGuides({ guides, unit }: SnapGuidesProps) {
  const dashes = useMemo(
    () =>
      guides.map((guide) => dashedPolyline([guide.from, guide.to], 0.14, 0.11)),
    [guides],
  );
  return (
    <>
      {guides.map((guide, index) => (
        // Wall guides carry one guide per axis, but the opening corner
        // guides share their wall's axis and set an id instead.
        <group key={guide.id ?? guide.axis}>
          <Line
            segments
            points={(dashes[index] ?? []).map((p) => v3(p, GUIDE_Y))}
            color={GUIDE_COLOR}
            lineWidth={2.5}
            transparent
            opacity={0.85}
            alphaToCoverage={false}
          />
          <Html
            position={[
              (guide.from.x + guide.to.x) / 2,
              LABEL_Y,
              (guide.from.y + guide.to.y) / 2,
            ]}
            center
            style={{ pointerEvents: "none" }}
            zIndexRange={[30, 0]}
          >
            <span className={PILL_CLASS}>
              {formatLength(guide.distance, unit)}
            </span>
          </Html>
        </group>
      ))}
    </>
  );
}
