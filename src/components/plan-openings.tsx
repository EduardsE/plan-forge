import { Html, Line, useCursor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { ArrowLeftRight, DoorOpen, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shape } from "three";
import {
  CLICK_SLOP_PX,
  floorProjector,
  useControlsPause,
} from "#/components/move-drag";
import { ACTION_BUTTON_CLASS } from "#/components/selection-chip";
import { SnapGuides } from "#/components/snap-guides";
import { Tooltip } from "#/components/tooltip";
import type { Point } from "#/lib/model";
import {
  offsetAlongWall,
  openingCornerGuides,
  slideOpening,
} from "#/lib/opening-place";
import type { PlacementGuide } from "#/lib/place";
import { wallPoint } from "#/lib/plan-scene";
import {
  WALL_THICKNESS,
  type WallHole,
  type WallSolid,
} from "#/lib/room-scene";
import { formatLengthValue, parseLength, type Unit } from "#/lib/units";

/**
 * Door/window editing on the 2D plan lens: existing openings pick like the
 * furniture footprints (hover, click-select, chip, drag-along-the-wall with
 * the shared guide pills). Fresh doors/windows insert by dragging a catalog
 * card from the objects library (`opening-ghost.tsx`). All geometry math
 * lives in `opening-place.ts`; this file is rendering and pointers.
 */

/** Hover/selection stroke, same accent as the plan footprints. */
const SELECTION_COLOR = "#3a5bf0";

/** Pick target reach beyond the wall faces, meters — the wall band is only
 * 0.1 m deep, a sliver at typical zoom. */
const PICK_PAD = 0.12;
/** Highlight rect clearance outside the wall faces. */
const HIGHLIGHT_PAD = 0.035;
/** Selection halo clearance (mirrors the footprint halo gap). */
const HALO_PAD = 0.1;
/** Gap between the opening and the chip's leader line, plan meters. */
const CHIP_GAP = 0.16;

/** Stacked above the plan drawing's symbol strokes (LINE_Y = 0.014) and
 * below the snap-guide pills (0.026). The invisible pick layers sit on top
 * of the visible strokes. */
const HIGHLIGHT_Y = 0.019;
const PICK_Y = 0.02;
const CHIP_Y = 0.024;

function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

/** Rect over a wall stretch: `s0..s1` along the wall, `o0..o1` across it
 * (outward offsets — negative is inside the room). */
function wallRect(
  solid: WallSolid,
  s0: number,
  s1: number,
  o0: number,
  o1: number,
): Point[] {
  return [
    wallPoint(solid, s0, o0),
    wallPoint(solid, s1, o0),
    wallPoint(solid, s1, o1),
    wallPoint(solid, s0, o1),
  ];
}

/** Plan-coordinate polygon as a three Shape (mirrored so world z = plan y
 * after `rotation-x={-Math.PI / 2}`); same convention as plan-scene.tsx. */
function shapeFromPoints(points: Point[]): Shape {
  const shape = new Shape();
  for (const [i, p] of points.entries()) {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  }
  shape.closePath();
  return shape;
}

/** A live opening drag: which opening, where it was grabbed, where it began. */
interface OpeningDrag {
  id: string;
  wallIndex: number;
  /** Grab offset from the opening's near edge, wall-local meters. */
  grab: number;
  /** Offset at drag start, restored by esc. */
  original: number;
  width: number;
  /** Screen point of the pointerdown, for the drag-vs-click slop guard. */
  originScreen: { x: number; y: number };
}

/**
 * One existing opening's pick target and highlight. The invisible pick mesh
 * defines the hit area (the visible symbols never raycast); a click selects,
 * and a pointerdown on the already-selected opening arms a wall-local drag —
 * the same press-picks / press-again-moves contract as the footprints.
 */
function OpeningTarget({
  solid,
  hole,
  selected,
  onSelect,
  onDragStart,
}: {
  solid: WallSolid;
  hole: WallHole;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (
    solid: WallSolid,
    hole: WallHole,
    along: number,
    screen: { x: number; y: number },
  ) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const end = hole.start + hole.width;
  const pickShape = useMemo(
    () =>
      shapeFromPoints(
        wallRect(solid, hole.start, end, -PICK_PAD, WALL_THICKNESS + PICK_PAD),
      ),
    [solid, hole.start, end],
  );
  const highlight = useMemo(() => {
    const rect = wallRect(
      solid,
      hole.start,
      end,
      -HIGHLIGHT_PAD,
      WALL_THICKNESS + HIGHLIGHT_PAD,
    );
    return [...rect, rect[0]];
  }, [solid, hole.start, end]);
  const halo = useMemo(() => {
    const rect = wallRect(
      solid,
      hole.start - HALO_PAD,
      end + HALO_PAD,
      -HALO_PAD,
      WALL_THICKNESS + HALO_PAD,
    );
    return [...rect, rect[0]];
  }, [solid, hole.start, end]);
  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={PICK_Y}
        onClick={(event) => {
          // A drag that ends on the opening is a camera pan, not a pick.
          if (event.delta > CLICK_SLOP_PX) return;
          event.stopPropagation();
          onSelect(hole.id);
        }}
        onPointerDown={(event) => {
          // Only a selected opening arms a drag (right button still pans).
          if (!selected || event.button !== 0) return;
          event.stopPropagation();
          onDragStart(
            solid,
            hole,
            offsetAlongWall(solid, { x: event.point.x, y: event.point.z }),
            { x: event.clientX, y: event.clientY },
          );
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <shapeGeometry args={[pickShape]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(hovered || selected) && (
        <Line
          points={highlight.map((p) => v3(p, HIGHLIGHT_Y))}
          color={SELECTION_COLOR}
          lineWidth={selected ? 2.5 : 2}
          alphaToCoverage={false}
        />
      )}
      {selected && (
        <Line
          points={halo.map((p) => v3(p, HIGHLIGHT_Y))}
          color={SELECTION_COLOR}
          lineWidth={1.5}
          transparent
          opacity={0.45}
          alphaToCoverage={false}
        />
      )}
    </group>
  );
}

/**
 * The chip's editable width: same commit-on-blur/⏎, esc-reverts contract as
 * the properties card's fields, restyled for the dark chip. The canonical
 * width re-seeds the field whenever a commit (possibly clamped) lands.
 */
function ChipWidthField({
  width,
  unit,
  onCommit,
}: {
  width: number;
  unit: Unit;
  onCommit: (width: number) => void;
}) {
  const value = formatLengthValue(width, unit);
  const [text, setText] = useState(value);
  const cancelledRef = useRef(false);
  useEffect(() => setText(value), [value]);
  return (
    <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[12.5px] text-[var(--ink-400)]">
      W
      <input
        type="text"
        inputMode="decimal"
        aria-label="Opening width"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (!cancelledRef.current && text !== value) {
            const meters = parseLength(text, unit);
            if (meters !== null) onCommit(meters);
          }
          cancelledRef.current = false;
          setText(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            cancelledRef.current = true;
            setText(value);
            event.currentTarget.blur();
          }
        }}
        className="pointer-events-auto w-[52px] rounded-[6px] bg-[var(--well)] px-1.5 py-0.5 text-center font-mono text-[12.5px] text-[var(--ink-900)] outline-none focus:shadow-[0_0_0_1px_var(--blue)]"
      />
      {unit}
    </span>
  );
}

/** The selected opening's chip: flip hinge (doors), flip which room a portal
 * opens into (two-face walls only), delete, editable width. A portal opening
 * also names the connection it makes ("Living ↔ Kitchen"). */
function OpeningChip({
  solid,
  hole,
  connects,
  showSideFlip,
  unit,
  onFlipHinge,
  onFlipSide,
  onDelete,
  onResize,
}: {
  solid: WallSolid;
  hole: WallHole;
  /** Derived portal label ("Living ↔ Kitchen"), or null off shared walls. */
  connects: string | null;
  /** The host edge borders two rooms — the door can open either way. */
  showSideFlip: boolean;
  unit: Unit;
  onFlipHinge: (id: string) => void;
  onFlipSide: (id: string) => void;
  onDelete: (id: string) => void;
  onResize: (id: string, width: number) => void;
}) {
  const mid = wallPoint(solid, hole.start + hole.width / 2, WALL_THICKNESS / 2);
  return (
    <Html
      position={[mid.x, CHIP_Y, mid.y - CHIP_GAP]}
      style={{ pointerEvents: "none" }}
    >
      <div className="pointer-events-none flex -translate-x-1/2 -translate-y-full flex-col items-center">
        <div className="mb-1.5 flex items-center gap-[7px] whitespace-nowrap rounded-[9px] border border-[var(--control-border)] bg-white px-3 py-[5px] font-semibold text-[12.5px] text-[var(--ink-900)] shadow-[0_8px_20px_rgba(15,27,61,0.10)]">
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] rounded-[2px] bg-[var(--blue)]"
          />
          {hole.kind === "door" ? "Door" : "Window"}
          {connects && (
            <span className="font-normal text-[11.5px] text-[var(--ink-400)]">
              {connects}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-[10px] border border-[var(--control-border)] bg-white px-2.5 py-[7px] shadow-[0_14px_34px_rgba(15,27,61,0.14)]">
          {hole.kind === "door" && (
            <Tooltip label="Flip hinge side" side="bottom">
              <button
                type="button"
                aria-label="Flip hinge side"
                className={`${ACTION_BUTTON_CLASS} text-[var(--ink-600)]`}
                onClick={() => onFlipHinge(hole.id)}
              >
                <ArrowLeftRight size={17} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
          {showSideFlip && (
            <Tooltip label="Flip which room it opens into" side="bottom">
              <button
                type="button"
                aria-label="Flip which room it opens into"
                className={`${ACTION_BUTTON_CLASS} text-[var(--ink-600)]`}
                onClick={() => onFlipSide(hole.id)}
              >
                <DoorOpen size={17} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
          <Tooltip label="Delete opening" side="bottom">
            <button
              type="button"
              aria-label="Delete opening"
              className={`${ACTION_BUTTON_CLASS} text-[var(--danger)]`}
              onClick={() => onDelete(hole.id)}
            >
              <Trash2 size={17} strokeWidth={1.6} />
            </button>
          </Tooltip>
          <div className="mx-[3px] h-[22px] w-px bg-[var(--hairline)]" />
          <ChipWidthField
            width={hole.width}
            unit={unit}
            onCommit={(width) => onResize(hole.id, width)}
          />
        </div>
        <div className="h-[26px] w-[1.5px] bg-gradient-to-b from-[rgba(58,91,240,0.8)] to-transparent" />
      </div>
    </Html>
  );
}

/**
 * The window-listener half of an opening drag (the pointer is already down
 * when this mounts): pointermoves project onto the host wall's axis, slide
 * through `slideOpening`'s quantize / clamp / no-overlap, and render the
 * distance-to-corner pills. Pointerup commits wherever the opening is; esc
 * restores the original offset.
 */
function OpeningDragSession({
  solid,
  drag,
  unit,
  onMove,
  onEnd,
}: {
  solid: WallSolid;
  drag: OpeningDrag;
  unit: Unit;
  onMove: (id: string, offset: number) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<PlacementGuide[]>([]);
  // Latest solid/neighbors/callbacks without resubscribing mid-drag — every
  // onMove rebuilds the room, so the solid's identity churns per move while
  // its wall geometry stays constant.
  const solidRef = useRef(solid);
  solidRef.current = solid;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const toFloor = floorProjector(gl, camera);
    // Pointer-still-down presses shouldn't nudge the opening onto the snap
    // grid: nothing moves until the pointer clears the click slop.
    let moved = false;
    const handleMove = (event: PointerEvent) => {
      if (!moved) {
        const travel = Math.hypot(
          event.clientX - drag.originScreen.x,
          event.clientY - drag.originScreen.y,
        );
        if (travel <= CLICK_SLOP_PX) return;
        moved = true;
      }
      const point = toFloor(event);
      if (!point) return;
      const wall = solidRef.current;
      const others = wall.holes.filter((hole) => hole.id !== drag.id);
      const offset = slideOpening(
        wall.length,
        drag.width,
        others,
        offsetAlongWall(wall, point) - drag.grab,
      );
      if (offset === null) return;
      moveRef.current(drag.id, offset);
      setGuides(openingCornerGuides(wall, offset, drag.width));
    };
    const handleUp = () => endRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      moveRef.current(drag.id, drag.original);
      endRef.current();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drag, camera, gl]);

  return <SnapGuides guides={guides} unit={unit} />;
}

export interface PlanOpeningsProps {
  solids: WallSolid[];
  selectedId: string | null;
  /** "Living ↔ Kitchen" per portal opening id, shown on the chip. */
  portalLabels?: Map<string, string>;
  unit: Unit;
  onSelect: (id: string) => void;
  /** Live re-offset during a drag (already snapped). */
  onMove: (id: string, offset: number) => void;
  onFlipHinge: (id: string) => void;
  /** Flip which room a portal door opens into (two-face walls only). */
  onFlipSide: (id: string) => void;
  onDelete: (id: string) => void;
  /** A committed width from the chip's field (the clamping is the caller's). */
  onResize: (id: string, width: number) => void;
  /** An opening drag started/ended — the canvas locks pan/zoom meanwhile. */
  onDragActiveChange: (active: boolean) => void;
}

export function PlanOpenings({
  solids,
  selectedId,
  portalLabels,
  unit,
  onSelect,
  onMove,
  onFlipHinge,
  onFlipSide,
  onDelete,
  onResize,
  onDragActiveChange,
}: PlanOpeningsProps) {
  const [drag, setDrag] = useState<OpeningDrag | null>(null);
  const { begin, end } = useControlsPause(onDragActiveChange);
  const beginDrag = useCallback(
    (
      solid: WallSolid,
      hole: WallHole,
      along: number,
      screen: { x: number; y: number },
    ) => {
      setDrag({
        id: hole.id,
        wallIndex: solid.index,
        grab: along - hole.start,
        original: hole.start,
        width: hole.width,
        originScreen: screen,
      });
      begin();
    },
    [begin],
  );
  const endDrag = useCallback(() => {
    setDrag(null);
    end();
  }, [end]);

  // One solid per edge carries every opening on it (both rooms'); each is
  // picked, selected and chipped exactly once, here.
  const selected = useMemo(() => {
    for (const solid of solids) {
      const hole = solid.holes.find((h) => h.id === selectedId);
      if (hole) return { solid, hole };
    }
    return null;
  }, [solids, selectedId]);
  const dragSolid = drag
    ? (solids.find((solid) => solid.index === drag.wallIndex) ?? null)
    : null;

  return (
    <group>
      {solids.map((solid) =>
        solid.holes.map((hole) => (
          <OpeningTarget
            key={hole.id}
            solid={solid}
            hole={hole}
            selected={hole.id === selectedId}
            onSelect={onSelect}
            onDragStart={beginDrag}
          />
        )),
      )}
      {selected && (
        <OpeningChip
          solid={selected.solid}
          hole={selected.hole}
          connects={portalLabels?.get(selected.hole.id) ?? null}
          showSideFlip={selected.solid.faces === 2}
          unit={unit}
          onFlipHinge={onFlipHinge}
          onFlipSide={onFlipSide}
          onDelete={onDelete}
          onResize={onResize}
        />
      )}
      {drag && dragSolid && (
        <OpeningDragSession
          solid={dragSolid}
          drag={drag}
          unit={unit}
          onMove={onMove}
          onEnd={endDrag}
        />
      )}
    </group>
  );
}
