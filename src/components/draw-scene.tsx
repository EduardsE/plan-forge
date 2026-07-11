import { Html, Line, useCursor } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Shape,
  type OrthographicCamera as ThreeOrthographicCamera,
} from "three";
import {
  CLICK_SLOP_PX as DRAG_SLOP_PX,
  floorProjector,
  useControlsPause,
} from "#/components/move-drag";
import {
  type DraftSnap,
  rectangleOutline,
  snapDraftPoint,
  snapRectPoint,
} from "#/lib/draw";
import type { Point } from "#/lib/model";
import {
  type CornerGuide,
  snapCornerDrag,
  splitPointOnWall,
} from "#/lib/outline-edit";
import { dashedPolyline } from "#/lib/plan-scene";
import {
  formatLength,
  formatLengthValue,
  parseLength,
  type Unit,
} from "#/lib/units";

/**
 * The draw-mode scene (mockup screen 1c): click the grid plane to place
 * outline corners. Committed segments render as navy bars with white length
 * pills (click one to type an exact length); the preview segment to the
 * cursor is dashed cyan with a live label, axis snapping shows the 90° badge
 * and corner-alignment snaps show a dashed guide + chip. Geometry lives in
 * `src/lib/draw.ts`; every color/proportion is lifted from the mockup.
 *
 * A *closed* draft (draw mode entered over an existing room) renders the
 * same loop but flips the interactions to reshaping: corners drag with the
 * same snapping and guides, and clicking a wall splits it with a new corner
 * (`src/lib/outline-edit.ts` holds that geometry).
 *
 * Labels are drei `<Html>` overlays like the plan lens, so they stay crisp
 * and the length input is a real DOM input.
 */

const WALL_COLOR = "#16213e";
const SNAP_COLOR = "#3a5bf0";
/** Snap radius in screen px, converted per-event to meters via camera zoom. */
const SNAP_TOLERANCE_PX = 12;
/** Clicking this close (px) to the start corner closes the outline instead. */
const CLOSE_TOLERANCE_PX = 14;
/** Clicks that travelled further than this (px) were pans, not placements. */
const CLICK_SLOP_PX = 4;
/** Ignore clicks that would stack a corner onto the previous one (meters). */
const MIN_SEGMENT = 0.01;
/** Side length of the right-angle marker at the snapped corner (meters). */
const ANGLE_MARKER_SIZE = 0.22;
/** Perpendicular offset from a segment to its length label (meters). */
const LABEL_OFFSET = 0.4;

/** Stacked heights above the ground grid, same trick as the plan lens. */
const GUIDE_Y = 0.012;
const WALL_Y = 0.014;
const PREVIEW_Y = 0.016;
const LABEL_Y = 0.02;

/** Plan point → world vector on the floor plane (world z = plan y). */
function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function centroidOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Unit perpendicular of a→b pointing away from the draft centroid, so
 * length labels sit outside the shape being drawn (mockup: every label is
 * on the outward side). Falls back to "up" (-y) for degenerate cases.
 */
function outwardPerp(a: Point, b: Point, centroid: Point): Point {
  const len = distance(a, b);
  if (len === 0) return { x: 0, y: -1 };
  let px = -(b.y - a.y) / len;
  let py = (b.x - a.x) / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dot = (mid.x - centroid.x) * px + (mid.y - centroid.y) * py;
  if (dot < 0) {
    px = -px;
    py = -py;
  }
  return { x: px, y: py };
}

function labelPosition(a: Point, b: Point, centroid: Point): Point {
  const perp = outwardPerp(a, b, centroid);
  return {
    x: (a.x + b.x) / 2 + perp.x * LABEL_OFFSET,
    y: (a.y + b.y) / 2 + perp.y * LABEL_OFFSET,
  };
}

/** White length pill of a committed segment; click to edit, or the inline
 * input while editing (mockup: "2.80|m" with the cyan focus ring). */
function SegmentLabel({
  a,
  b,
  unit,
  editing,
  onBeginEdit,
  onCommit,
  onCancel,
  centroid,
}: {
  a: Point;
  b: Point;
  unit: Unit;
  editing: boolean;
  onBeginEdit: () => void;
  onCommit: (meters: number) => void;
  onCancel: () => void;
  centroid: Point;
}) {
  const length = distance(a, b);
  const at = labelPosition(a, b, centroid);
  const commitInput = (value: string) => {
    const meters = parseLength(value, unit);
    if (meters === null) onCancel();
    else onCommit(meters);
  };
  return (
    <Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
      {editing ? (
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border-2 border-[#3a5bf0] bg-white px-2 py-[3px] shadow-[0_0_0_4px_rgba(58,91,240,0.15),0_6px_16px_rgba(15,27,61,0.10)]">
          <input
            // biome-ignore lint/a11y/noAutofocus: the input replaces the label the user just clicked
            autoFocus
            defaultValue={formatLengthValue(length, unit)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => commitInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Keep Enter/Esc away from the route's close/cancel keys.
              event.stopPropagation();
              if (event.key === "Enter") {
                commitInput(event.currentTarget.value);
              } else if (event.key === "Escape") {
                onCancel();
              }
            }}
            className="w-[52px] bg-transparent text-right font-mono text-[13.5px] text-[#0F1B3D] outline-none"
          />
          <span className="font-mono text-[13.5px] text-[#9AA9C7]">{unit}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onBeginEdit();
          }}
          className="pointer-events-auto cursor-pointer whitespace-nowrap rounded-lg border border-[rgba(15,27,61,0.12)] bg-white px-[11px] py-[3px] font-mono text-[13.5px] text-[#33415C] shadow-[0_6px_16px_rgba(15,27,61,0.08)]"
        >
          {formatLength(length, unit)}
        </button>
      )}
    </Html>
  );
}

/** The dashed alignment guide from a matched earlier corner to the cursor,
 * with the "snap · aligned with start" chip beside its midpoint. */
function AlignmentGuide({
  from,
  to,
  startAligned,
}: {
  from: Point;
  to: Point;
  startAligned: boolean;
}) {
  const dashes = useMemo(
    () => dashedPolyline([from, to], 0.14, 0.1),
    [from, to],
  );
  if (dashes.length === 0) return null;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return (
    <group>
      <Line
        segments
        points={dashes.map((p) => v3(p, GUIDE_Y))}
        color={SNAP_COLOR}
        lineWidth={2.5}
        transparent
        opacity={0.6}
        alphaToCoverage={false}
      />
      <Html
        position={[mid.x, LABEL_Y, mid.y]}
        style={{ pointerEvents: "none", transform: "translateY(-50%)" }}
      >
        <div className="ml-3 whitespace-nowrap rounded-lg border-[1.5px] border-dashed border-[rgba(58,91,240,0.7)] bg-[rgba(58,91,240,0.10)] px-[11px] py-1 font-mono text-[12px] text-[#3a5bf0]">
          {startAligned ? "snap · aligned with start" : "snap · aligned"}
        </div>
      </Html>
    </group>
  );
}

/** Right-angle marker + "90°" badge in the wedge at the last corner. */
function AngleBadge({
  prev,
  corner,
  next,
  angleDeg,
}: {
  prev: Point;
  corner: Point;
  next: Point;
  angleDeg: number;
}) {
  const s = ANGLE_MARKER_SIZE;
  const backLen = distance(corner, prev);
  const outLen = distance(corner, next);
  if (backLen === 0 || outLen === 0) return null;
  const back = {
    x: ((prev.x - corner.x) / backLen) * s,
    y: ((prev.y - corner.y) / backLen) * s,
  };
  const out = {
    x: ((next.x - corner.x) / outLen) * s,
    y: ((next.y - corner.y) / outLen) * s,
  };
  const marker: Point[] = [
    { x: corner.x + back.x, y: corner.y + back.y },
    { x: corner.x + back.x + out.x, y: corner.y + back.y + out.y },
    { x: corner.x + out.x, y: corner.y + out.y },
  ];
  const badgeAt = {
    x: corner.x + (back.x + out.x) * 1.9,
    y: corner.y + (back.y + out.y) * 1.9,
  };
  return (
    <group>
      <Line
        points={marker.map((p) => v3(p, PREVIEW_Y))}
        color={SNAP_COLOR}
        lineWidth={2}
        alphaToCoverage={false}
      />
      <Html
        position={v3(badgeAt, LABEL_Y)}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className="whitespace-nowrap rounded-md border border-[rgba(58,91,240,0.6)] bg-white px-2 py-[2px] font-mono text-[11.5px] text-[#3a5bf0]">
          {angleDeg}°
        </span>
      </Html>
    </group>
  );
}

/** Corner dot; the start corner carries the cyan glow (mockup screen 1c). */
function CornerDot({ at, isStart }: { at: Point; isStart: boolean }) {
  return (
    <Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
      <div
        className="h-4 w-4 rounded-full border-[3px] border-[#16213E] bg-white"
        style={{
          boxShadow: isStart
            ? "0 0 0 6px rgba(58,91,240,0.25), 0 0 16px rgba(58,91,240,0.5)"
            : "0 2px 6px rgba(15,27,61,0.25)",
        }}
      />
    </Html>
  );
}

/** The drawn crosshair cursor: cyan dot + thin hairlines (the OS cursor is
 * hidden over the canvas while the wall tool is active). */
function DrawCursor({ at }: { at: Point }) {
  return (
    <Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
      <div className="relative">
        <div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-[60px] w-[1.5px] bg-[rgba(58,91,240,0.7)]" />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-[1.5px] w-[60px] bg-[rgba(58,91,240,0.7)]" />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-[#3a5bf0] shadow-[0_0_0_5px_rgba(58,91,240,0.25),0_0_18px_rgba(58,91,240,0.7)]" />
      </div>
    </Html>
  );
}

/** The cyan rectangle preview between the rect tool's two clicks, with a width
 * label on the top edge and a height label on the right edge. Solid cyan (not
 * the dashed preview language the open draft uses) on purpose: a dashed loop
 * chops into ~50 segment quads that stall drei's `<Line>` on this GPU stack,
 * and the cyan already reads as "not committed" against the navy strokes. */
function RectPreview({ a, b, unit }: { a: Point; b: Point; unit: Unit }) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const width = maxX - minX;
  const height = maxY - minY;
  const loop: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
  return (
    <group>
      <Line
        points={loop.map((p) => v3(p, PREVIEW_Y))}
        color={SNAP_COLOR}
        lineWidth={3.5}
        alphaToCoverage={false}
      />
      {width > MIN_SEGMENT && (
        <Html
          position={[(minX + maxX) / 2, LABEL_Y, minY - LABEL_OFFSET]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="whitespace-nowrap rounded-lg border-[1.5px] border-[#3a5bf0] bg-[rgba(58,91,240,0.10)] px-[11px] py-[3px] font-mono text-[13.5px] text-[#3a5bf0]">
            {formatLength(width, unit)}
          </span>
        </Html>
      )}
      {height > MIN_SEGMENT && (
        <Html
          position={[maxX + LABEL_OFFSET, LABEL_Y, (minY + maxY) / 2]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="whitespace-nowrap rounded-lg border-[1.5px] border-[#3a5bf0] bg-[rgba(58,91,240,0.10)] px-[11px] py-[3px] font-mono text-[13.5px] text-[#3a5bf0]">
            {formatLength(height, unit)}
          </span>
        </Html>
      )}
    </group>
  );
}

/** Corner pick-handle radius, meters (the visual dot is smaller). */
const CORNER_PICK_RADIUS = 0.18;
/** Wall pick-strip half-width for splitting, meters. */
const STRIP_PAD = 0.12;
/** Invisible pick layers, above the visible strokes. */
const PICK_Y = 0.018;

/** Plan-coordinate polygon as a three Shape (mirrored so world z = plan y
 * after `rotation-x={-Math.PI / 2}`); same convention as plan-openings. */
function shapeFromPoints(points: Point[]): Shape {
  const shape = new Shape();
  for (const [i, p] of points.entries()) {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  }
  shape.closePath();
  return shape;
}

/** Pick quad along a wall, `pad` meters to each side. */
function wallStripPoints(a: Point, b: Point, pad: number): Point[] {
  const length = distance(a, b);
  if (length === 0) return [a, a, a, a];
  const nx = (-(b.y - a.y) / length) * pad;
  const ny = ((b.x - a.x) / length) * pad;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/** A live corner drag: which corner, where it started (esc restores it). */
interface CornerDrag {
  index: number;
  original: Point;
  originScreen: { x: number; y: number };
}

/**
 * The window-listener half of a corner drag (the pointer is already down when
 * this mounts): pointermoves project onto the floor plane and snap through
 * `snapCornerDrag` (axis locks to other corners + grid quantize), rendering a
 * dashed guide per locked axis. Pointerup commits wherever the corner is; esc
 * restores the original position. Keys register in the capture phase and stop
 * propagation so the route's draft-wide ⏎/esc handlers sit the drag out.
 */
function CornerDragSession({
  corners,
  snapEnabled,
  drag,
  onMove,
  onEnd,
}: {
  corners: Point[];
  snapEnabled: boolean;
  drag: CornerDrag;
  onMove: (index: number, point: Point) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<CornerGuide[]>([]);
  // Latest corners/snap/callbacks without resubscribing mid-drag (every move
  // rebuilds the draft the handlers close over).
  const cornersRef = useRef(corners);
  cornersRef.current = corners;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const toFloor = floorProjector(gl, camera);
    // Pointer-still-down presses shouldn't nudge the corner onto the snap
    // grid: nothing moves until the pointer clears the click slop.
    let moved = false;
    const handleMove = (event: PointerEvent) => {
      if (!moved) {
        const travel = Math.hypot(
          event.clientX - drag.originScreen.x,
          event.clientY - drag.originScreen.y,
        );
        if (travel <= DRAG_SLOP_PX) return;
        moved = true;
      }
      const point = toFloor(event);
      if (!point) return;
      const zoom = (camera as ThreeOrthographicCamera).zoom || 80;
      const snap = snapCornerDrag(
        cornersRef.current,
        drag.index,
        point,
        SNAP_TOLERANCE_PX / zoom,
        snapRef.current,
      );
      moveRef.current(drag.index, snap.point);
      setGuides(snap.guides);
    };
    const handleUp = () => endRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        moveRef.current(drag.index, drag.original);
        endRef.current();
      } else if (event.key === "Enter") {
        // Committing the draft mid-drag would pull it out from under us.
        event.stopPropagation();
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [drag, camera, gl]);

  const at = corners[drag.index];
  if (!at) return null;
  return (
    <group>
      {guides.map((guide) => (
        <AlignmentGuide
          key={`${guide.axis}-${guide.cornerIndex}`}
          from={corners[guide.cornerIndex]}
          to={at}
          startAligned={guide.cornerIndex === 0}
        />
      ))}
    </group>
  );
}

/** Draggable corner of a closed draft: visual dot + invisible pick disc. */
function CornerHandle({
  at,
  index,
  onDragStart,
}: {
  at: Point;
  index: number;
  onDragStart: (index: number, screen: { x: number; y: number }) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, "grab");
  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[at.x, PICK_Y, at.y]}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          onDragStart(index, { x: event.clientX, y: event.clientY });
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[CORNER_PICK_RADIUS, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={v3(at, LABEL_Y)} center style={{ pointerEvents: "none" }}>
        <div
          className="h-4 w-4 rounded-full border-[3px] border-[#16213E] bg-white"
          style={{
            boxShadow: hovered
              ? "0 0 0 6px rgba(58,91,240,0.25), 0 0 16px rgba(58,91,240,0.5)"
              : "0 2px 6px rgba(15,27,61,0.25)",
          }}
        />
      </Html>
    </group>
  );
}

/**
 * Reshaping interactions of a closed draft: draggable corner handles, and an
 * invisible strip along each wall that previews (ghost dot) and inserts a new
 * corner on click — the split, which the next press can drag out. The camera
 * controls pause around a drag, like every in-scene drag.
 */
function OutlineEditLayer({
  corners,
  snapEnabled,
  onMoveCorner,
  onSplitWall,
  onDragActiveChange,
}: {
  corners: Point[];
  snapEnabled: boolean;
  onMoveCorner: (index: number, point: Point) => void;
  onSplitWall: (wallIndex: number, point: Point) => void;
  onDragActiveChange: (active: boolean) => void;
}) {
  const [drag, setDrag] = useState<CornerDrag | null>(null);
  const [splitGhost, setSplitGhost] = useState<Point | null>(null);
  const [stripHovered, setStripHovered] = useState(false);
  useCursor(stripHovered && !drag, "copy");
  const { begin, end } = useControlsPause(onDragActiveChange);

  const beginDrag = useCallback(
    (index: number, screen: { x: number; y: number }) => {
      setDrag({ index, original: corners[index], originScreen: screen });
      begin();
    },
    [corners, begin],
  );
  const endDrag = useCallback(() => {
    setDrag(null);
    end();
  }, [end]);

  const strips = useMemo(
    () =>
      corners.map((corner, index) => ({
        wallIndex: index,
        shape: shapeFromPoints(
          wallStripPoints(
            corner,
            corners[(index + 1) % corners.length],
            STRIP_PAD,
          ),
        ),
      })),
    [corners],
  );

  return (
    <group>
      {!drag &&
        strips.map(({ wallIndex, shape }) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
          <mesh
            key={wallIndex}
            rotation-x={-Math.PI / 2}
            position-y={PICK_Y}
            onPointerMove={(event) => {
              setStripHovered(true);
              setSplitGhost(
                splitPointOnWall(corners, wallIndex, {
                  x: event.point.x,
                  y: event.point.z,
                }),
              );
            }}
            onPointerOut={() => {
              setStripHovered(false);
              setSplitGhost(null);
            }}
            onClick={(event) => {
              // A drag that ends on the wall is a camera pan, not a split.
              if (event.delta > CLICK_SLOP_PX) return;
              const point = splitPointOnWall(corners, wallIndex, {
                x: event.point.x,
                y: event.point.z,
              });
              if (!point) return;
              event.stopPropagation();
              setSplitGhost(null);
              onSplitWall(wallIndex, point);
            }}
          >
            <shapeGeometry args={[shape]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      {corners.map((corner, index) => (
        <CornerHandle
          // biome-ignore lint/suspicious/noArrayIndexKey: corners are identified by position in the draft
          key={index}
          at={corner}
          index={index}
          onDragStart={beginDrag}
        />
      ))}
      {splitGhost && !drag && (
        <Html
          position={v3(splitGhost, LABEL_Y)}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="h-3.5 w-3.5 rounded-full border-2 border-[#3a5bf0] bg-[rgba(58,91,240,0.35)] shadow-[0_0_0_5px_rgba(58,91,240,0.2)]" />
        </Html>
      )}
      {drag && (
        <CornerDragSession
          corners={corners}
          snapEnabled={snapEnabled}
          drag={drag}
          onMove={onMoveCorner}
          onEnd={endDrag}
        />
      )}
    </group>
  );
}

export interface DrawSceneProps {
  corners: Point[];
  /** Closed loop (editing an existing room) vs open chain (fresh drawing). */
  closed: boolean;
  unit: Unit;
  /** Snap toggle: off means free-hand corners (no axis lock / quantize). */
  snapEnabled: boolean;
  /** Wall tool active on an open draft: clicks place corners, crosshair on. */
  placing: boolean;
  /** Rect tool active: two opposite-corner clicks draw a rectangular room. */
  rectMode: boolean;
  onPlaceCorner: (point: Point) => void;
  /** Rect tool: the two clicked opposite corners define the new outline. */
  onPlaceRect: (a: Point, b: Point) => void;
  onSetSegmentLength: (segmentIndex: number, meters: number) => void;
  /** Requested by clicking back on the start corner (≥ 3 corners placed). */
  onRequestClose: () => void;
  /** Closed drafts: a corner dragged to a (snapped) new position. */
  onMoveCorner: (index: number, point: Point) => void;
  /** Closed drafts: a wall clicked to insert a corner at `point`. */
  onSplitWall: (wallIndex: number, point: Point) => void;
  /** A corner drag started/ended — the canvas locks pan/zoom meanwhile. */
  onDragActiveChange: (active: boolean) => void;
}

export function DrawScene({
  corners,
  closed,
  unit,
  snapEnabled,
  placing,
  rectMode,
  onPlaceCorner,
  onPlaceRect,
  onSetSegmentLength,
  onRequestClose,
  onMoveCorner,
  onSplitWall,
  onDragActiveChange,
}: DrawSceneProps) {
  const [snap, setSnap] = useState<DraftSnap | null>(null);
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  // Rect tool: the first clicked corner (null until the first click), and the
  // live snapped cursor for the second. Cleared when the tool deactivates.
  const [rectAnchor, setRectAnchor] = useState<Point | null>(null);
  const [rectCursor, setRectCursor] = useState<Point | null>(null);
  useEffect(() => {
    if (!rectMode) {
      setRectAnchor(null);
      setRectCursor(null);
    }
  }, [rectMode]);
  // Esc drops the in-progress rectangle without reverting the whole draft;
  // capture-phase + stopPropagation keeps it away from the route's esc.
  useEffect(() => {
    if (!rectMode || !rectAnchor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setRectAnchor(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [rectMode, rectAnchor]);

  const centroid = useMemo(() => centroidOf(corners), [corners]);
  const last = corners.at(-1);
  const preview = !closed && placing && last && snap ? snap : null;
  const previewDashes = useMemo(
    () =>
      preview && last ? dashedPolyline([last, preview.point], 0.12, 0.08) : [],
    [preview, last],
  );

  /** Snap tolerance in meters at the event camera's current zoom. */
  const toleranceOf = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const zoom = (event.camera as ThreeOrthographicCamera).zoom || 80;
    return SNAP_TOLERANCE_PX / zoom;
  };

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    const cursor = { x: event.point.x, y: event.point.z };
    if (rectMode) {
      setRectCursor(snapRectPoint(cursor, snapEnabled));
      return;
    }
    if (!placing) return;
    setSnap(snapDraftPoint(corners, cursor, toleranceOf(event), snapEnabled));
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!placing && !rectMode) return;
    // Clicks on DOM overlays (length pills) also raycast through to this
    // plane; only true canvas clicks may place corners.
    if (!(event.nativeEvent.target instanceof HTMLCanvasElement)) return;
    if (event.delta > CLICK_SLOP_PX) return;
    if (rectMode) {
      const corner = snapRectPoint(
        { x: event.point.x, y: event.point.z },
        snapEnabled,
      );
      if (!rectAnchor) {
        setRectAnchor(corner);
        return;
      }
      // Ignore a second click that would collapse the rectangle (same row
      // or column) — keep the anchor and wait for a real opposite corner.
      if (rectangleOutline(rectAnchor, corner)) {
        onPlaceRect(rectAnchor, corner);
        setRectAnchor(null);
      }
      return;
    }
    const tolerance = toleranceOf(event);
    const { point } = snapDraftPoint(
      corners,
      { x: event.point.x, y: event.point.z },
      tolerance,
      snapEnabled,
    );
    if (corners.length >= 3) {
      const closeTolerance =
        CLOSE_TOLERANCE_PX /
        ((event.camera as ThreeOrthographicCamera).zoom || 80);
      if (distance(point, corners[0]) < closeTolerance) {
        onRequestClose();
        return;
      }
    }
    if (last && distance(point, last) < MIN_SEGMENT) return;
    onPlaceCorner(point);
  };

  return (
    <group>
      {/* Invisible pick plane: the "grid plane" the task says to click. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={0.001}
        onPointerMove={handleMove}
        onPointerOut={() => {
          setSnap(null);
          setRectCursor(null);
        }}
        onClick={handleClick}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {corners.length >= 2 && (
        <Line
          points={(closed ? [...corners, corners[0]] : corners).map((p) =>
            v3(p, WALL_Y),
          )}
          color={WALL_COLOR}
          lineWidth={7}
          alphaToCoverage={false}
        />
      )}

      {!rectMode &&
        corners.slice(0, closed ? undefined : -1).map((corner, index) => (
          <SegmentLabel
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are identified by position in the draft
            key={index}
            a={corner}
            b={corners[(index + 1) % corners.length]}
            unit={unit}
            centroid={centroid}
            editing={editingSegment === index}
            onBeginEdit={() => setEditingSegment(index)}
            onCommit={(meters) => {
              onSetSegmentLength(index, meters);
              setEditingSegment(null);
            }}
            onCancel={() => setEditingSegment(null)}
          />
        ))}

      {preview && last && distance(last, preview.point) > MIN_SEGMENT && (
        <group>
          <Line
            segments
            points={previewDashes.map((p) => v3(p, PREVIEW_Y))}
            color={SNAP_COLOR}
            lineWidth={3.5}
            alphaToCoverage={false}
          />
          <Html
            position={v3(labelPosition(last, preview.point, centroid), LABEL_Y)}
            center
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded-lg border-[1.5px] border-[#3a5bf0] bg-[rgba(58,91,240,0.10)] px-[11px] py-[3px] font-mono text-[13.5px] text-[#3a5bf0]">
              {formatLength(distance(last, preview.point), unit)}
            </span>
          </Html>
        </group>
      )}

      {preview?.alignment && (
        <AlignmentGuide
          from={corners[preview.alignment.cornerIndex]}
          to={preview.point}
          startAligned={preview.alignment.cornerIndex === 0}
        />
      )}

      {preview?.turnAngleDeg === 90 && last && corners.length >= 2 && (
        <AngleBadge
          prev={corners[corners.length - 2]}
          corner={last}
          next={preview.point}
          angleDeg={90}
        />
      )}

      {!closed &&
        corners.map((corner, index) => (
          <CornerDot
            // biome-ignore lint/suspicious/noArrayIndexKey: corners are identified by position in the draft
            key={index}
            at={corner}
            isStart={index === 0}
          />
        ))}

      {closed && !rectMode && (
        <OutlineEditLayer
          corners={corners}
          snapEnabled={snapEnabled}
          onMoveCorner={onMoveCorner}
          onSplitWall={onSplitWall}
          onDragActiveChange={onDragActiveChange}
        />
      )}

      {rectMode && rectAnchor && rectCursor && (
        <RectPreview a={rectAnchor} b={rectCursor} unit={unit} />
      )}
      {rectMode && rectAnchor && <CornerDot at={rectAnchor} isStart={true} />}
      {rectMode && rectCursor && <DrawCursor at={rectCursor} />}

      {!closed && placing && snap && <DrawCursor at={snap.point} />}
    </group>
  );
}
