import { Html, Line, useCursor } from "@react-three/drei";
import { useMemo, useState } from "react";
import { MathUtils } from "three";
import { CLICK_SLOP_PX } from "#/components/move-drag";
import type { Floor, Point, Stair } from "#/lib/model";
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
 *
 * Pickable (V8): both variants get an invisible flat pick mesh over the
 * footprint (`FILL_Y`-level, like every other plan footprint) — a void
 * symbol picks the *owning* (lower) floor's stair id, same as the up symbol;
 * the caller resolves ownership (`floorOfStair`), this component just
 * reports which id was clicked. Selected/hovered tints the outline
 * accent-blue, matching every other plan footprint's active-state contract.
 */

/** Ink-grey stroke for the owning floor's real stair symbol — the plan's
 * usual wall/symbol ink (`plan-scene.tsx`'s `SYMBOL_COLOR`). */
const UP_COLOR = "#33415c";
/** Paper ink-500 — the void's non-editable, non-wall grey. */
const VOID_COLOR = "#9A9A92";
/** Accent blue (`plan-scene.tsx`'s `SELECTION_COLOR`) — selected/hovered. */
const SELECTION_COLOR = "#3a5bf0";

const STAIR_LINE_Y = 0.0145;
const VOID_LINE_Y = 0.011;
/** Flat pick mesh, level with every other plan footprint's fill. */
const PICK_Y = 0.01;

/** Raycast opt-out for decorative strokes — only the pick mesh below is a
 * click/hover target. */
const noRaycast = () => null;

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
  active,
}: {
  width: number;
  run: number;
  risers: number;
  active: boolean;
}) {
  const hw = width / 2;
  const hd = run / 2;
  const color = active ? SELECTION_COLOR : UP_COLOR;
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
        color={color}
        lineWidth={2}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      {treads.map((line, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: a static per-riser list.
          key={i}
          points={line.map((p) => v3(p, STAIR_LINE_Y))}
          color={color}
          lineWidth={1.5}
          alphaToCoverage={false}
          raycast={noRaycast}
        />
      ))}
      <Line
        points={[v3({ x: 0, y: -hd }, STAIR_LINE_Y), v3(tip, STAIR_LINE_Y)]}
        color={color}
        lineWidth={1.5}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      <Line
        points={arrowHead.map((p) => v3(p, STAIR_LINE_Y))}
        color={color}
        lineWidth={1.5}
        alphaToCoverage={false}
        raycast={noRaycast}
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
function VoidSymbol({
  width,
  run,
  active,
}: {
  width: number;
  run: number;
  active: boolean;
}) {
  const hw = width / 2;
  const hd = run / 2;
  const color = active ? SELECTION_COLOR : VOID_COLOR;
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
        color={color}
        lineWidth={2}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      <Line
        segments
        points={breakDashes.map((p) => v3(p, VOID_LINE_Y))}
        color={color}
        lineWidth={1.5}
        alphaToCoverage={false}
        raycast={noRaycast}
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

/** One stair's symbol, positioned/rotated at its footprint, with the shared
 * pick/hover/selected contract every plan footprint uses. `onSelect` absent
 * renders a static (non-interactive) symbol — matches every other plan
 * layer's `interactive` convention. */
function StairSymbol({
  stair,
  run,
  risers,
  variant,
  selected,
  onSelect,
}: {
  stair: Stair;
  run: number;
  risers: number;
  variant: "up" | "void";
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const active = selected || hovered;
  return (
    <group
      position={[stair.position.x, 0, stair.position.y]}
      rotation-y={MathUtils.degToRad(stair.rotation)}
    >
      {onSelect && (
        // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
        <mesh
          rotation-x={-Math.PI / 2}
          position-y={PICK_Y}
          onClick={(event) => {
            if (event.delta > CLICK_SLOP_PX) return;
            event.stopPropagation();
            onSelect(stair.id);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <planeGeometry args={[stair.width, run]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {variant === "up" ? (
        <UpSymbol
          width={stair.width}
          run={run}
          risers={risers}
          active={active}
        />
      ) : (
        <VoidSymbol width={stair.width} run={run} active={active} />
      )}
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
  /** Currently selected stair id, if any (either variant can hold it — a
   * void symbol picks the same id its owning floor's "up" symbol would). */
  selectedStairId?: string | null;
  /** Absent renders a static, non-interactive symbol. */
  onSelectStair?: (id: string) => void;
  /** "up" on the owning floor (treads + arrow + "UP"); "void" on the floor
   * above (dashed outline + break line + "DN"). */
  variant: "up" | "void";
}

export function PlanStairs({
  floor,
  storeyHeight,
  selectedStairId = null,
  onSelectStair,
  variant,
}: PlanStairsProps) {
  const { risers, run } = useMemo(() => stairRun(storeyHeight), [storeyHeight]);
  if (floor.stairs.length === 0) return null;
  return (
    <>
      {floor.stairs.map((stair) => (
        <StairSymbol
          key={stair.id}
          stair={stair}
          run={run}
          risers={risers}
          variant={variant}
          selected={stair.id === selectedStairId}
          onSelect={onSelectStair}
        />
      ))}
    </>
  );
}
