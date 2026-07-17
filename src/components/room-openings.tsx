import { Html, Line, useCursor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLICK_SLOP_PX,
  useControlsPause,
  wallProjector,
} from "#/components/move-drag";
import { GUIDE_PILL_CLASS, SnapGuides } from "#/components/snap-guides";
import {
  OPENING_GRID,
  offsetAlongWall,
  openingCornerGuides,
  openingVerticalGuides,
  slideOpening,
} from "#/lib/opening-place";
import type { PlacementGuide } from "#/lib/place";
import { dashedPolyline } from "#/lib/plan-scene";
import {
  WALL_THICKNESS,
  type WallHole,
  type WallSolid,
} from "#/lib/room-scene";
import { formatLength, type Unit } from "#/lib/units";

/**
 * Door/window editing in the 3D dollhouse: every opening gets an invisible
 * pick volume over its hole (the visible walls never raycast), hover/selection
 * shows a translucent blue band, and a pointerdown on the selected opening
 * arms a drag *on the wall's vertical plane* — doors slide along the wall,
 * windows also ride up and down it (their whole-hole shift, height preserved).
 * The same press-picks / press-again-moves contract as the 2D plan and the
 * furniture. Width/height/elevation live in the inspector.
 */

const SELECTION_COLOR = "#3a5bf0";

/** Pick volume reach beyond the wall faces, meters (the 2D lens's PICK_PAD). */
const PICK_PAD = 0.12;

/** A live 3D opening drag: where it was grabbed, what to restore on esc. */
interface OpeningDrag {
  id: string;
  kind: WallHole["kind"];
  /** Solid index of the host edge (stable across preview re-renders). */
  wallIndex: number;
  /** Grab offset from the opening's near edge, wall-local meters. */
  grabAlong: number;
  /** Grab height above the hole's bottom edge, meters. */
  grabUp: number;
  /** Offset/bottom at drag start, restored by esc. */
  originalOffset: number;
  originalBottom: number;
  width: number;
  /** Screen point of the pointerdown, for the drag-vs-click slop guard. */
  originScreen: { x: number; y: number };
}

/** One opening's pick volume + hover/selection band, in wall-local space
 * (the parent group carries the wall's transform). */
function OpeningVolume({
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
    grab: { along: number; up: number },
    screen: { x: number; y: number },
  ) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const cx = hole.start + hole.width / 2;
  const cy = (hole.bottom + hole.top) / 2;
  const height = hole.top - hole.bottom;
  return (
    <group position={[cx, cy, 0]}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
      <mesh
        onClick={(event) => {
          // A drag that ends on the opening is a camera orbit, not a pick.
          if (event.delta > CLICK_SLOP_PX) return;
          event.stopPropagation();
          onSelect(hole.id);
        }}
        onPointerDown={(event) => {
          // Only a selected opening arms a drag (right button still orbits).
          if (!selected || event.button !== 0) return;
          event.stopPropagation();
          onDragStart(
            solid,
            hole,
            {
              along: offsetAlongWall(solid, {
                x: event.point.x,
                y: event.point.z,
              }),
              up: event.point.y,
            },
            { x: event.clientX, y: event.clientY },
          );
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry
          args={[hole.width, height, WALL_THICKNESS + PICK_PAD * 2]}
        />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(hovered || selected) && (
        <mesh raycast={() => null}>
          <boxGeometry args={[hole.width, height, WALL_THICKNESS + 0.03]} />
          <meshBasicMaterial
            color={SELECTION_COLOR}
            transparent
            opacity={selected ? 0.3 : 0.16}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * The floor→sill and head→ceiling readouts while a window rides its wall:
 * dashed vertical lines standing on the wall plane (just off the face on the
 * opening's side), each with the same blue distance pill the corner guides
 * use. Computed from the *live* hole, so they track every preview.
 */
function WallVerticalGuides({
  solid,
  hole,
  unit,
}: {
  solid: WallSolid;
  hole: WallHole;
  unit: Unit;
}) {
  const guides = useMemo(
    () =>
      openingVerticalGuides(
        hole.start,
        hole.width,
        hole.bottom,
        hole.top,
        solid.height,
      ),
    [hole.start, hole.width, hole.bottom, hole.top, solid.height],
  );
  // Plan point where a guide stands: on the wall line at the hole's center,
  // pushed just past the face toward the room the opening belongs to.
  const off = (WALL_THICKNESS / 2 + 0.02) * hole.side;
  return (
    <>
      {guides.map((guide) => {
        const at = {
          x: solid.start.x + solid.dir.x * guide.along - solid.dir.y * off,
          y: solid.start.y + solid.dir.y * guide.along + solid.dir.x * off,
        };
        // dashedPolyline chops 2D polylines; run it over the vertical span
        // (height encoded as x) and stand the dashes up at `at`.
        const dashes = dashedPolyline(
          [
            { x: guide.fromY, y: 0 },
            { x: guide.toY, y: 0 },
          ],
          0.14,
          0.11,
        );
        return (
          <group key={guide.id}>
            <Line
              segments
              points={dashes.map(
                (d) => [at.x, d.x, at.y] as [number, number, number],
              )}
              color={SELECTION_COLOR}
              lineWidth={2.5}
              transparent
              opacity={0.85}
              alphaToCoverage={false}
            />
            <Html
              position={[at.x, (guide.fromY + guide.toY) / 2, at.y]}
              center
              style={{ pointerEvents: "none" }}
              zIndexRange={[30, 0]}
            >
              <span className={GUIDE_PILL_CLASS}>
                {formatLength(guide.distance, unit)}
              </span>
            </Html>
          </group>
        );
      })}
    </>
  );
}

/**
 * The window-listener half of a 3D opening drag (the pointer is already down
 * when this mounts): pointermoves project onto the host wall's vertical
 * plane; the along component slides through `slideOpening`'s quantize /
 * clamp / no-overlap, the up component shifts a window's whole hole (the
 * canvas clamps it to floor/ceiling and quantizes). Both land in ONE
 * combined preview per move — separate calls would each rebuild the floor
 * from the same pre-move state, the second silently dropping the first.
 * Pointerup commits wherever the opening is; esc restores both axes.
 */
function OpeningDragSession3D({
  solid,
  drag,
  unit,
  snapEnabled,
  onDrag,
  onEnd,
}: {
  solid: WallSolid;
  drag: OpeningDrag;
  unit: Unit;
  snapEnabled: boolean;
  onDrag: (id: string, offset: number | null, bottom: number | null) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<PlacementGuide[]>([]);
  // The pointer has cleared the click slop: the drag is real, guides show.
  const [dragging, setDragging] = useState(false);
  // Latest solid/callbacks without resubscribing mid-drag — every preview
  // rebuilds the floor, churning the solid's identity while its wall
  // geometry stays constant.
  const solidRef = useRef(solid);
  solidRef.current = solid;
  const dragRef = useRef(onDrag);
  dragRef.current = onDrag;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;

  useEffect(() => {
    const toWall = wallProjector(gl, camera, solidRef.current);
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
        setDragging(true);
      }
      const point = toWall(event);
      if (!point) return;
      const wall = solidRef.current;
      const others = wall.holes.filter((hole) => hole.id !== drag.id);
      const offset = slideOpening(
        wall.length,
        drag.width,
        others,
        point.along - drag.grabAlong,
        snapRef.current ? OPENING_GRID : 0,
      );
      dragRef.current(
        drag.id,
        offset,
        drag.kind === "window" ? point.up - drag.grabUp : null,
      );
      if (offset !== null) {
        setGuides(
          snapRef.current ? openingCornerGuides(wall, offset, drag.width) : [],
        );
      }
    };
    const handleUp = () => endRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dragRef.current(
        drag.id,
        drag.originalOffset,
        drag.kind === "window" ? drag.originalBottom : null,
      );
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

  // The live hole tracks every preview — its bottom/top drive the vertical
  // guides while a window rides the wall (doors stay floor-pinned).
  const liveHole = solid.holes.find((hole) => hole.id === drag.id) ?? null;
  return (
    <group>
      <SnapGuides guides={guides} unit={unit} />
      {dragging && drag.kind === "window" && liveHole && (
        <WallVerticalGuides solid={solid} hole={liveHole} unit={unit} />
      )}
    </group>
  );
}

export interface RoomOpeningsProps {
  solids: WallSolid[];
  selectedId: string | null;
  unit: Unit;
  /** Snap toggle: off means free slide (no quantize, no guides). */
  snapEnabled: boolean;
  onSelect: (id: string) => void;
  /** One combined drag preview: the along-wall offset (already snapped;
   * null when no free stretch fits) and, for windows, the raw whole-hole
   * bottom (the canvas clamps/quantizes it; null for doors). */
  onDrag: (id: string, offset: number | null, bottom: number | null) => void;
  /** An opening drag started/ended — the canvas locks orbit meanwhile. */
  onDragActiveChange: (active: boolean) => void;
}

export function RoomOpenings({
  solids,
  selectedId,
  unit,
  snapEnabled,
  onSelect,
  onDrag,
  onDragActiveChange,
}: RoomOpeningsProps) {
  const [drag, setDrag] = useState<OpeningDrag | null>(null);
  const { begin, end } = useControlsPause(onDragActiveChange);
  const beginDrag = useCallback(
    (
      solid: WallSolid,
      hole: WallHole,
      grab: { along: number; up: number },
      screen: { x: number; y: number },
    ) => {
      setDrag({
        id: hole.id,
        kind: hole.kind,
        wallIndex: solid.index,
        grabAlong: grab.along - hole.start,
        grabUp: grab.up - hole.bottom,
        originalOffset: hole.start,
        originalBottom: hole.bottom,
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

  const dragSolid = drag
    ? (solids.find((solid) => solid.index === drag.wallIndex) ?? null)
    : null;

  return (
    <group>
      {solids.map((solid) => (
        <group
          key={solid.edgeId}
          position={[solid.start.x, 0, solid.start.y]}
          rotation-y={Math.atan2(-solid.dir.y, solid.dir.x)}
        >
          {solid.holes.map((hole) => (
            <OpeningVolume
              key={hole.id}
              solid={solid}
              hole={hole}
              selected={hole.id === selectedId}
              onSelect={onSelect}
              onDragStart={beginDrag}
            />
          ))}
        </group>
      ))}
      {drag && dragSolid && (
        <OpeningDragSession3D
          solid={dragSolid}
          drag={drag}
          unit={unit}
          snapEnabled={snapEnabled}
          onDrag={onDrag}
          onEnd={endDrag}
        />
      )}
    </group>
  );
}
