import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import { MathUtils } from "three";
import type { Floor, Point } from "#/lib/model";
import { dashedPolyline } from "#/lib/plan-scene";
import { stairRun, TREAD_DEPTH } from "#/lib/stairs";

/**
 * The 2D plan's stair symbol (architectural convention): the owning floor
 * draws its stair as tread lines + a climb arrow + "UP"; the floor
 * immediately above draws the same footprint as a dashed void with one
 * diagonal break line + "DN" — the opening its stairs cut into the platform
 * above. Both variants share the run/riser geometry `StairMesh` and the
 * ghost use (`stairRun`), so the 2D symbol always matches the 3D treads.
 *
 * Local (pre-rotation) space matches `footprintCorners`'/`stairClimbDir`'s
 * convention: x is the footprint width (centered), the "y" field below (the
 * run/climb axis, mapped to world z by `v3`) runs from -run/2 (bottom, no
 * climb) to +run/2 (top) — a `rotation-y` group wrapper reproduces the same
 * rotation `stairClimbDir(rotation)` computes, so no separate vector math is
 * needed here (see `StairMesh`'s docstring for the derivation).
 */

/** Ink-grey stroke for the owning floor's real stair symbol — the plan's
 * usual wall/symbol ink (`plan-scene.tsx`'s `SYMBOL_COLOR`). */
const UP_COLOR = "#33415c";
/** Paper ink-500 — the void's non-editable, non-wall grey. */
const VOID_COLOR = "#9A9A92";

const STAIR_LINE_Y = 0.0145;
const VOID_LINE_Y = 0.011;

function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

const LABEL_CLASS =
  "whitespace-nowrap rounded-md border border-[rgba(15,27,61,0.12)] bg-white px-[7px] py-[1px] font-mono text-[11px] tracking-[0.08em] text-[#33415C]";

/** The owning floor's stair: solid outline, tread lines every `TREAD_DEPTH`,
 * a climb arrow, "UP". */
function UpSymbol({
  width,
  run,
  risers,
}: {
  width: number;
  run: number;
  risers: number;
}) {
  const hw = width / 2;
  const hd = run / 2;
  const outline = useMemo(
    () => [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
      { x: -hw, y: -hd },
    ],
    [hw, hd],
  );
  const treads = useMemo(() => {
    const lines: [Point, Point][] = [];
    for (let i = 1; i < risers; i++) {
      const z = -hd + i * TREAD_DEPTH;
      lines.push([
        { x: -hw, y: z },
        { x: hw, y: z },
      ]);
    }
    return lines;
  }, [hw, hd, risers]);
  const tip = useMemo(() => ({ x: 0, y: hd - 0.08 }), [hd]);
  const arrowHead = useMemo(
    () => [{ x: -0.09, y: tip.y - 0.16 }, tip, { x: 0.09, y: tip.y - 0.16 }],
    [tip],
  );

  return (
    <group>
      <Line
        points={outline.map((p) => v3(p, STAIR_LINE_Y))}
        color={UP_COLOR}
        lineWidth={2}
        alphaToCoverage={false}
      />
      {treads.map((line, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: a static per-riser list.
          key={i}
          points={line.map((p) => v3(p, STAIR_LINE_Y))}
          color={UP_COLOR}
          lineWidth={1.5}
          alphaToCoverage={false}
        />
      ))}
      <Line
        points={[v3({ x: 0, y: -hd }, STAIR_LINE_Y), v3(tip, STAIR_LINE_Y)]}
        color={UP_COLOR}
        lineWidth={1.5}
        alphaToCoverage={false}
      />
      <Line
        points={arrowHead.map((p) => v3(p, STAIR_LINE_Y))}
        color={UP_COLOR}
        lineWidth={1.5}
        alphaToCoverage={false}
      />
      <Html
        position={[0, STAIR_LINE_Y, hd - 0.32]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className={LABEL_CLASS}>UP</span>
      </Html>
    </group>
  );
}

/** The floor above's void: dashed outline, one diagonal break line, "DN". */
function VoidSymbol({ width, run }: { width: number; run: number }) {
  const hw = width / 2;
  const hd = run / 2;
  const outline = useMemo(
    () => [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
      { x: -hw, y: -hd },
    ],
    [hw, hd],
  );
  const dashes = useMemo(() => dashedPolyline(outline, 0.09, 0.06), [outline]);
  const breakDashes = useMemo(
    () =>
      dashedPolyline(
        [
          { x: -hw, y: -hd },
          { x: hw, y: hd },
        ],
        0.09,
        0.06,
      ),
    [hw, hd],
  );
  return (
    <group>
      <Line
        segments
        points={dashes.map((p) => v3(p, VOID_LINE_Y))}
        color={VOID_COLOR}
        lineWidth={2}
        alphaToCoverage={false}
      />
      <Line
        segments
        points={breakDashes.map((p) => v3(p, VOID_LINE_Y))}
        color={VOID_COLOR}
        lineWidth={1.5}
        alphaToCoverage={false}
      />
      <Html
        position={[0, VOID_LINE_Y, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className={LABEL_CLASS}>DN</span>
      </Html>
    </group>
  );
}

export interface PlanStairsProps {
  /** The floor whose `stairs` this draws — the owning floor for "up", the
   * floor below the active one for "void". */
  floor: Floor;
  /** The climbing floor's own storey height (`storeyHeightOf`), driving the
   * same `stairRun` the ghost and `StairMesh` use. */
  storeyHeight: number;
  /** Selection lands in V8; accepted now so this component's signature
   * doesn't change when it does. */
  selectedStairId?: string | null;
  onSelectStair?: (id: string) => void;
  /** "up" on the owning floor (treads + arrow + "UP"); "void" on the floor
   * above (dashed outline + break line + "DN"). */
  variant: "up" | "void";
}

export function PlanStairs({ floor, storeyHeight, variant }: PlanStairsProps) {
  const { risers, run } = useMemo(() => stairRun(storeyHeight), [storeyHeight]);
  if (floor.stairs.length === 0) return null;
  return (
    <>
      {floor.stairs.map((stair) => (
        <group
          key={stair.id}
          position={[stair.position.x, 0, stair.position.y]}
          rotation-y={MathUtils.degToRad(stair.rotation)}
        >
          {variant === "up" ? (
            <UpSymbol width={stair.width} run={run} risers={risers} />
          ) : (
            <VoidSymbol width={stair.width} run={run} />
          )}
        </group>
      ))}
    </>
  );
}
