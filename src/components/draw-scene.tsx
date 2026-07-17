import { Html, Line, useCursor } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Shape,
  type OrthographicCamera as ThreeOrthographicCamera,
} from "three";
import type { DrawTool } from "#/components/draw-tool-stack";
import {
  CLICK_SLOP_PX as DRAG_SLOP_PX,
  floorProjector,
  useControlsPause,
} from "#/components/move-drag";
import {
  type DraftSnap,
  type FloorSnap,
  rectangleOutline,
  snapDraftPoint,
  snapRectPoint,
  snapTargetsOfGraph,
} from "#/lib/draw";
import { type NodeGuide, snapNodeDrag } from "#/lib/graph-edit";
import {
  type Floor,
  faceLabelPoint,
  floorArea,
  type Point,
  type Room,
} from "#/lib/model";
import { dashedPolyline } from "#/lib/plan-scene";
import {
  formatLength,
  formatLengthValue,
  parseLength,
  type Unit,
} from "#/lib/units";

/**
 * The draw-mode scene, drawn directly on the wall **graph** (Phase 9): every
 * edge is a centerline stroke, every node a draggable handle, every edge a
 * click-to-edit length pill, and each derived face carries an area label.
 * Dragging a node moves every wall that shares it (rooms deform together);
 * the wall tool chains open walls click-by-click (welding onto existing
 * nodes/edges), the rect tool draws a rectangle in one step, and a click on a
 * wall in select mode splits it and drags the new node. Delete removes the
 * hovered node or edge. All edits go through `lib/graph-edit.ts` with normal
 * undo — no draft/commit session. Geometry lives in `src/lib/draw.ts` +
 * `src/lib/graph-edit.ts`; every color/proportion is lifted from the mockup.
 */

const WALL_COLOR = "#16213e";
const SNAP_COLOR = "#3a5bf0";
/** Snap radius in screen px, converted per-event to meters via camera zoom. */
const SNAP_TOLERANCE_PX = 12;
/** Clicks that travelled further than this (px) were pans, not placements. */
const CLICK_SLOP_PX = 4;
/** Ignore clicks that would stack a node onto the chain's last one (meters). */
const MIN_SEGMENT = 0.01;
/** Perpendicular offset from a segment to its length label (meters). */
const LABEL_OFFSET = 0.4;

/** Stacked heights above the ground grid, same trick as the plan lens. */
const GUIDE_Y = 0.012;
const WALL_Y = 0.014;
const PREVIEW_Y = 0.016;
const LABEL_Y = 0.02;

/** Corner pick-handle radius, meters (the visual dot is smaller). */
const CORNER_PICK_RADIUS = 0.18;
/** Wall pick-strip half-width, meters. */
const STRIP_PAD = 0.12;
/** Invisible pick layers, above the visible strokes. */
const PICK_Y = 0.018;
/** Corner discs sit above the wall strips so a near-node press grabs the node
 * (drag) rather than the strip (split). */
const CORNER_PICK_Y = PICK_Y + 0.002;

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

/** Unit perpendicular of a→b pointing away from `centroid`, so length labels
 * sit outside the shape. Falls back to "up" (-y) for degenerate cases. */
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

/** White length pill of an edge; click to edit its true length, or the inline
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
              // Keep Enter/Esc away from the scene's chain-end/delete keys.
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

/** The dashed alignment guide from a matched node to the dragged point. */
function AlignmentGuide({ from, to }: { from: Point; to: Point }) {
  const dashes = useMemo(
    () => dashedPolyline([from, to], 0.14, 0.1),
    [from, to],
  );
  if (dashes.length === 0) return null;
  return (
    <Line
      segments
      points={dashes.map((p) => v3(p, GUIDE_Y))}
      color={SNAP_COLOR}
      lineWidth={2.5}
      transparent
      opacity={0.6}
      alphaToCoverage={false}
    />
  );
}

/** In-scene feedback for a chain lock onto the graph: a dashed overlay along
 * the matched wall, or an alignment guide from the matched node. */
function FloorSnapMarker({ snap, at }: { snap: FloorSnap; at: Point }) {
  const dashes = useMemo(
    () =>
      snap.kind === "wall"
        ? dashedPolyline([snap.wall.start, snap.wall.end], 0.14, 0.1)
        : [],
    [snap],
  );
  if (snap.kind === "align") {
    return <AlignmentGuide from={snap.at} to={at} />;
  }
  if (dashes.length === 0) return null;
  return (
    <Line
      segments
      points={dashes.map((p) => v3(p, GUIDE_Y))}
      color={SNAP_COLOR}
      lineWidth={2.5}
      transparent
      opacity={0.6}
      alphaToCoverage={false}
    />
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

/** The cyan rectangle preview between the rect tool's two clicks. Solid cyan
 * (not dashed) on purpose: a dashed loop stalls drei's `<Line>` on this GPU. */
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

/** Plan-coordinate polygon as a three Shape (mirrored so world z = plan y
 * after `rotation-x={-Math.PI / 2}`). */
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

/** A live node drag: which node and the screen point it started from. */
interface NodeDrag {
  nodeId: string;
  originScreen: { x: number; y: number };
}

/**
 * The window-listener half of a node drag (the pointer is already down when
 * this mounts): pointermoves project onto the floor plane and snap through
 * `snapNodeDrag` (axis locks to other nodes + grid quantize), previewing every
 * wall the node touches. Pointerup settles the move (welds fire here); esc
 * restores the node to where the drag began. Keys register in the capture
 * phase and stop propagation so the scene's chain-end/delete keys sit it out.
 */
function NodeDragSession({
  floor,
  snapEnabled,
  drag,
  onMove,
  onSettle,
  onCancel,
}: {
  floor: Floor;
  snapEnabled: boolean;
  drag: NodeDrag;
  onMove: (nodeId: string, point: Point) => void;
  onSettle: (nodeId: string, point: Point) => void;
  onCancel: (nodeId: string, original: Point) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [guides, setGuides] = useState<NodeGuide[]>([]);
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // The node's position at drag start — esc restores it, and a release that
  // never travelled settles back to it (no history step).
  const originalRef = useRef<Point | null>(null);
  if (originalRef.current === null) {
    const node = floor.nodes.find((n) => n.id === drag.nodeId);
    originalRef.current = node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }

  useEffect(() => {
    const toFloor = floorProjector(gl, camera);
    const original = originalRef.current ?? { x: 0, y: 0 };
    let moved = false;
    let last: Point = original;
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
      const snap = snapNodeDrag(
        floorRef.current,
        drag.nodeId,
        point,
        SNAP_TOLERANCE_PX / zoom,
        snapRef.current,
      );
      last = snap.point;
      moveRef.current(drag.nodeId, snap.point);
      setGuides(snap.guides);
    };
    const handleUp = () => {
      if (moved) settleRef.current(drag.nodeId, last);
      else cancelRef.current(drag.nodeId, original);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelRef.current(drag.nodeId, original);
      } else if (event.key === "Enter") {
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

  const at = floor.nodes.find((n) => n.id === drag.nodeId);
  if (!at) return null;
  return (
    <group>
      {guides.map((guide) => {
        const from = floor.nodes.find((n) => n.id === guide.nodeId);
        if (!from) return null;
        return (
          <AlignmentGuide
            key={`${guide.axis}-${guide.nodeId}`}
            from={from}
            to={at}
          />
        );
      })}
    </group>
  );
}

/** Draggable node handle: visual dot + invisible pick disc (select tool). */
function NodeHandle({
  at,
  nodeId,
  interactive,
  onDragStart,
  onHover,
}: {
  at: Point;
  nodeId: string;
  interactive: boolean;
  onDragStart: (nodeId: string, screen: { x: number; y: number }) => void;
  onHover: (nodeId: string | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, "grab");
  return (
    <group>
      {interactive && (
        // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
        <mesh
          rotation-x={-Math.PI / 2}
          position={[at.x, CORNER_PICK_Y, at.y]}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onDragStart(nodeId, { x: event.clientX, y: event.clientY });
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
            onHover(nodeId);
          }}
          onPointerOut={() => {
            setHovered(false);
            onHover(null);
          }}
        >
          <circleGeometry args={[CORNER_PICK_RADIUS, 24]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
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

export interface DrawSceneProps {
  /** The live wall graph — the whole draw lens edits it directly. */
  floor: Floor;
  /** Derived rooms (graph faces) for the area labels. */
  rooms: Room[];
  unit: Unit;
  /** Snap toggle: off means free-hand (no axis lock / quantize / weld line). */
  snapEnabled: boolean;
  tool: DrawTool;
  /** Id of the chain's last node (wall tool), or null for no active chain. */
  chainNode: string | null;
  /** Extend the chain: add a wall from `from` to `to` (route welds + reconciles
   * and sets the next chain node). */
  onExtendChain: (from: Point, to: Point) => void;
  /** Esc / ⏎ / double-click while a chain is active. */
  onEndChain: () => void;
  onPlaceRect: (a: Point, b: Point) => void;
  /** A node drag streaming its previews / settling / esc-restoring. */
  onNodeMovePreview: (nodeId: string, point: Point) => void;
  onNodeMoveSettle: (nodeId: string, point: Point) => void;
  onNodeMoveCancel: (nodeId: string, original: Point) => void;
  onNodeDragActiveChange: (active: boolean) => void;
  /** Split edge `edgeId` at the clicked point and return the new node's id to
   * drag (null when refused near a corner). */
  onBeginSplitDrag: (edgeId: string, point: Point) => string | null;
  /** Commit a length pill: `fixed` is which edge end stays put while the other
   * slides. The pill knows the wall's rendered orientation (it draws a→b), so
   * it names the fixed end rather than the state layer assuming one. */
  onSetEdgeLength: (edgeId: string, length: number, fixed: "a" | "b") => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export function DrawScene({
  floor,
  rooms,
  unit,
  snapEnabled,
  tool,
  chainNode,
  onExtendChain,
  onEndChain,
  onPlaceRect,
  onNodeMovePreview,
  onNodeMoveSettle,
  onNodeMoveCancel,
  onNodeDragActiveChange,
  onBeginSplitDrag,
  onSetEdgeLength,
  onDeleteNode,
  onDeleteEdge,
}: DrawSceneProps) {
  const nodeById = useMemo(
    () => new Map(floor.nodes.map((n) => [n.id, n])),
    [floor.nodes],
  );
  const centroid = useMemo(() => centroidOf(floor.nodes), [floor.nodes]);
  const targets = useMemo(() => snapTargetsOfGraph(floor), [floor]);

  const wallTool = tool === "wall";
  const rectMode = tool === "rect";
  const selectMode = tool === "select";

  const [snap, setSnap] = useState<DraftSnap | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  // The chain's first click before any node exists (the wall tool starts a
  // fresh point in empty space); once a wall lands, `chainNode` drives it.
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  // Rect tool: the first clicked corner and the live snapped cursor.
  const [rectAnchor, setRectAnchor] = useState<Point | null>(null);
  const [rectCursor, setRectCursor] = useState<Point | null>(null);
  // Select tool: the hovered node/edge, so delete knows what to remove.
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [drag, setDrag] = useState<NodeDrag | null>(null);
  const { begin, end } = useControlsPause(onNodeDragActiveChange);

  const chainAnchor = chainNode
    ? (nodeById.get(chainNode) ?? null)
    : pendingPoint;

  // Reset transient state when the tool changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tool` is the reset trigger, not a value read in the body.
  useEffect(() => {
    setPendingPoint(null);
    setRectAnchor(null);
    setRectCursor(null);
    setSnap(null);
  }, [tool]);

  /** Snap tolerance in meters at the event camera's current zoom. */
  const toleranceOf = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const zoom = (event.camera as ThreeOrthographicCamera).zoom || 80;
    return SNAP_TOLERANCE_PX / zoom;
  };

  // Esc / ⏎ / delete for the chain, in-progress rectangle, and hovered
  // node/edge (a node drag swallows esc in its own capture-phase handler).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      if (wallTool && (chainNode || pendingPoint)) {
        if (event.key === "Escape" || event.key === "Enter") {
          if (pendingPoint) setPendingPoint(null);
          else onEndChain();
          return;
        }
      }
      if (rectMode && rectAnchor && event.key === "Escape") {
        // Gesture-cancel only: drop the first corner, keep the tool armed;
        // the floor/history are untouched (nothing committed yet).
        setRectAnchor(null);
        return;
      }
      if (selectMode && (event.key === "Delete" || event.key === "Backspace")) {
        if (hoveredNode) {
          event.preventDefault();
          onDeleteNode(hoveredNode);
          setHoveredNode(null);
        } else if (hoveredEdge) {
          event.preventDefault();
          onDeleteEdge(hoveredEdge);
          setHoveredEdge(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    wallTool,
    rectMode,
    selectMode,
    chainNode,
    pendingPoint,
    rectAnchor,
    hoveredNode,
    hoveredEdge,
    onEndChain,
    onDeleteNode,
    onDeleteEdge,
  ]);

  const beginDrag = useCallback(
    (nodeId: string, screen: { x: number; y: number }) => {
      setDrag({ nodeId, originScreen: screen });
      begin();
    },
    [begin],
  );
  const endDrag = useCallback(() => {
    setDrag(null);
    end();
  }, [end]);

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    const cursor = { x: event.point.x, y: event.point.z };
    if (rectMode) {
      setRectCursor(
        snapRectPoint(cursor, snapEnabled, targets, toleranceOf(event)),
      );
      return;
    }
    if (!wallTool) return;
    setSnap(
      snapDraftPoint(
        chainAnchor ? [chainAnchor] : [],
        cursor,
        toleranceOf(event),
        snapEnabled,
        targets,
      ),
    );
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    // Clicks on DOM overlays (length pills) also raycast through; only true
    // canvas clicks may place points.
    if (!(event.nativeEvent.target instanceof HTMLCanvasElement)) return;
    if (event.delta > CLICK_SLOP_PX) return;
    const cursor = { x: event.point.x, y: event.point.z };
    if (rectMode) {
      const corner = snapRectPoint(
        cursor,
        snapEnabled,
        targets,
        toleranceOf(event),
      );
      if (!rectAnchor) {
        setRectAnchor(corner);
        return;
      }
      if (rectangleOutline(rectAnchor, corner)) {
        onPlaceRect(rectAnchor, corner);
        setRectAnchor(null);
      }
      return;
    }
    if (!wallTool) return;
    const { point } = snapDraftPoint(
      chainAnchor ? [chainAnchor] : [],
      cursor,
      toleranceOf(event),
      snapEnabled,
      targets,
    );
    if (chainAnchor) {
      if (distance(point, chainAnchor) < MIN_SEGMENT) return;
      onExtendChain(chainAnchor, point);
      setPendingPoint(null);
    } else {
      setPendingPoint(point);
    }
  };

  const preview = wallTool && chainAnchor && snap ? snap : null;
  const previewDashes = useMemo(
    () =>
      preview && chainAnchor
        ? dashedPolyline([chainAnchor, preview.point], 0.12, 0.08)
        : [],
    [preview, chainAnchor],
  );

  return (
    <group>
      {/* Invisible pick plane: the "grid plane" clicks land on. */}
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
        onDoubleClick={() => {
          if (wallTool && (chainNode || pendingPoint)) {
            if (pendingPoint) setPendingPoint(null);
            else onEndChain();
          }
        }}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Every edge as a navy centerline stroke (dangling walls included). */}
      {floor.edges.map((edge) => {
        const a = nodeById.get(edge.a);
        const b = nodeById.get(edge.b);
        if (!a || !b) return null;
        return (
          <Line
            key={edge.id}
            points={[v3(a, WALL_Y), v3(b, WALL_Y)]}
            color={WALL_COLOR}
            lineWidth={7}
            alphaToCoverage={false}
          />
        );
      })}

      {/* Face area labels. */}
      {rooms.map((room) => {
        if (room.outline.length < 3) return null;
        const at = faceLabelPoint(room.outline);
        return (
          <Html
            key={room.id}
            position={v3(at, LABEL_Y)}
            center
            style={{ pointerEvents: "none" }}
          >
            <div className="whitespace-nowrap rounded-lg border border-[rgba(15,27,61,0.10)] bg-white/90 px-2.5 py-1 text-center shadow-[0_6px_16px_rgba(15,27,61,0.08)]">
              {room.name && (
                <div className="font-semibold text-[12px] text-[#1A1A17]">
                  {room.name}
                </div>
              )}
              <div className="font-mono text-[11.5px] text-[#6B6B64]">
                {floorArea(room.outline).toFixed(2)} m²
              </div>
            </div>
          </Html>
        );
      })}

      {/* Per-edge length pills. */}
      {floor.edges.map((edge) => {
        const a = nodeById.get(edge.a);
        const b = nodeById.get(edge.b);
        if (!a || !b || distance(a, b) < MIN_SEGMENT) return null;
        return (
          <SegmentLabel
            key={edge.id}
            a={a}
            b={b}
            unit={unit}
            centroid={centroid}
            editing={editingEdge === edge.id}
            onBeginEdit={() => setEditingEdge(edge.id)}
            onCommit={(meters) => {
              // The pill draws from `a` (the rendered start), so keep `a`
              // fixed and let the far end (`b`) slide to the new length.
              onSetEdgeLength(edge.id, meters, "a");
              setEditingEdge(null);
            }}
            onCancel={() => setEditingEdge(null)}
          />
        );
      })}

      {/* Select-tool edge pick strips: click to split-then-drag; hover to
          delete. Inert while dragging or under the wall/rect tools. */}
      {selectMode &&
        !drag &&
        floor.edges.map((edge) => {
          const a = nodeById.get(edge.a);
          const b = nodeById.get(edge.b);
          if (!a || !b) return null;
          const shape = shapeFromPoints(wallStripPoints(a, b, STRIP_PAD));
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
            <mesh
              key={edge.id}
              rotation-x={-Math.PI / 2}
              position-y={PICK_Y}
              onPointerOver={(event) => {
                event.stopPropagation();
                setHoveredEdge(edge.id);
              }}
              onPointerOut={() => setHoveredEdge(null)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                const newId = onBeginSplitDrag(edge.id, {
                  x: event.point.x,
                  y: event.point.z,
                });
                if (newId) {
                  beginDrag(newId, { x: event.clientX, y: event.clientY });
                }
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <shapeGeometry args={[shape]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          );
        })}

      {/* Node handles — draggable in select mode. */}
      {floor.nodes.map((node) => (
        <NodeHandle
          key={node.id}
          at={node}
          nodeId={node.id}
          interactive={selectMode && !drag}
          onDragStart={beginDrag}
          onHover={setHoveredNode}
        />
      ))}

      {/* Wall-tool chain preview. */}
      {preview &&
        chainAnchor &&
        distance(chainAnchor, preview.point) > MIN_SEGMENT && (
          <group>
            <Line
              segments
              points={previewDashes.map((p) => v3(p, PREVIEW_Y))}
              color={SNAP_COLOR}
              lineWidth={3.5}
              alphaToCoverage={false}
            />
            <Html
              position={v3(
                labelPosition(chainAnchor, preview.point, centroid),
                LABEL_Y,
              )}
              center
              style={{ pointerEvents: "none" }}
            >
              <span className="whitespace-nowrap rounded-lg border-[1.5px] border-[#3a5bf0] bg-[rgba(58,91,240,0.10)] px-[11px] py-[3px] font-mono text-[13.5px] text-[#3a5bf0]">
                {formatLength(distance(chainAnchor, preview.point), unit)}
              </span>
            </Html>
          </group>
        )}

      {preview?.floorSnap && (
        <FloorSnapMarker snap={preview.floorSnap} at={preview.point} />
      )}

      {rectMode && rectAnchor && rectCursor && (
        <RectPreview a={rectAnchor} b={rectCursor} unit={unit} />
      )}
      {rectMode && rectCursor && <DrawCursor at={rectCursor} />}
      {wallTool && snap && <DrawCursor at={snap.point} />}

      {drag && (
        <NodeDragSession
          floor={floor}
          snapEnabled={snapEnabled}
          drag={drag}
          onMove={onNodeMovePreview}
          onSettle={(nodeId, point) => {
            onNodeMoveSettle(nodeId, point);
            endDrag();
          }}
          onCancel={(nodeId, original) => {
            onNodeMoveCancel(nodeId, original);
            endDrag();
          }}
        />
      )}
    </group>
  );
}
