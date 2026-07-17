import { Html, Line, useCursor } from "@react-three/drei";
import { type ReactNode, useMemo, useState } from "react";
import {
  CanvasTexture,
  MathUtils,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import {
  CLICK_SLOP_PX,
  FLOOR_PLANE,
  MoveDragSession,
  useMoveDrag,
} from "#/components/move-drag";
import { PlanOpenings } from "#/components/plan-openings";
import { RotateHandle } from "#/components/rotate-handle";
import { SelectionChip } from "#/components/selection-chip";
import { overlappingFurnitureIds } from "#/lib/collision";
import type {
  DerivedRoom,
  Floor,
  FurnitureItem,
  FurnitureUpdate,
  Point,
  Room,
} from "#/lib/model";
import {
  allFurnitureOf,
  catalogItemById,
  floorArea,
  floorBounds,
  furnitureDisplayName,
  outlineBounds,
  portalLabel,
} from "#/lib/model";
import { edgeWallObstacles, rotatedFootprintSize } from "#/lib/place";
import {
  circlePoints,
  dashedPolyline,
  doorSwing,
  roundedRectPoints,
  solidSpans,
  wallPoint,
} from "#/lib/plan-scene";
import {
  buildEdgeSolids,
  type NodePost,
  nodePosts,
  type Span,
  WALL_THICKNESS,
  type WallHole,
  type WallSolid,
} from "#/lib/room-scene";
import type { Unit } from "#/lib/units";

/**
 * The 2D plan lens (mockup screen 1b): the same room model presented as an
 * architectural drawing — navy wall fills, window/door symbols, tinted
 * furniture footprints — with DOM (`<Html>`) overlays for labels, external
 * dimension lines and the room area card, so text stays crisp at any zoom.
 * Every color and proportion is lifted from `design/planforge-mockups.html`.
 * Footprints pick like the 3D lens's furniture: hover/selected strokes go
 * accent-blue, selection adds a halo ring plus the shared label chip, and
 * dragging a selected footprint moves it through the shared move-drag session.
 *
 * Every stroke disables the line material's alpha-to-coverage: with it on,
 * some GPUs resolve a line's coverage-discarded fragments as opaque
 * background over the whole expanded quad (seen here as a white rectangle
 * swallowing the ground grid around the door arc). Dashes are pre-chopped
 * into explicit segments (`dashedPolyline`) instead of using the dashed
 * material, which misrendered the same way.
 */

const WALL_COLOR = "#16213e";
const FLOOR_COLOR = "#fcfdff";
/** Mockup interior grid rgba(48,106,190,.09), pre-blended onto the floor. */
const FLOOR_GRID_COLOR = "#eaf0f9";
const FLOOR_GRID_CELL = 0.5;
const SYMBOL_COLOR = "#33415c";
const DOOR_ARC_COLOR = "#8fa3c8";
const DIMENSION_COLOR = "#7e93be";
/** Distance from the outer wall face to a dimension line. */
const DIMENSION_GAP = 0.4;
/** Half-length of a dimension line's end tick (mockup: 14 px). */
const DIMENSION_TICK = 0.065;

/** Stacked heights above the ground grid; the plan is only ever seen from
 * straight above, so tiny offsets are all the layering needed. */
const SHADOW_Y = 0.002;
const FLOOR_Y = 0.004;
const WALL_Y = 0.006;
const OPENING_Y = 0.008;
const RUG_FILL_Y = 0.009;
const FILL_Y = 0.01;
const RUG_LINE_Y = 0.013;
const LINE_Y = 0.014;
/** Extra lift for stacked riders, so a lamp draws over its desk's footprint. */
const STACK_LIFT = 0.008;

interface FootprintStyle {
  label: string;
  fill: string;
  fillOpacity: number;
  /** Corner radius, uniform or CSS-order [tl, tr, br, bl]. */
  radius: number | [number, number, number, number];
  dashed?: boolean;
}

/** Plan styling per catalog item, straight from mockup screen 1b. */
const FOOTPRINT_STYLES: Record<string, FootprintStyle> = {
  desk: { label: "DESK", fill: "#b98a5f", fillOpacity: 0.16, radius: 0.055 },
  "desk-chair": {
    label: "CHAIR",
    fill: "#ce7b52",
    fillOpacity: 0.18,
    radius: [0.13, 0.13, 0.055, 0.055],
  },
  credenza: {
    label: "CABINET",
    fill: "#a9805a",
    fillOpacity: 0.18,
    radius: 0.036,
  },
  shelf: { label: "SHELF", fill: "#a9805a", fillOpacity: 0.18, radius: 0.036 },
  rug: {
    label: "RUG",
    fill: "#c9805f",
    fillOpacity: 0.08,
    radius: 0.09,
    dashed: true,
  },
};
const FOOTPRINT_FALLBACK: FootprintStyle = {
  label: "",
  fill: "#a9805a",
  fillOpacity: 0.18,
  radius: 0.04,
};
const PLANT_FILL = "#4f7d46";

/** Hover/selection stroke on the white plan sheet — the Paper accent blue. */
const SELECTION_COLOR = "#3a5bf0";
/** Gap between a selected footprint's edge and its halo ring, meters. */
const HALO_GAP = 0.06;
/** Extra fill strength while an item is selected. */
const SELECTED_FILL_BOOST = 0.08;
/** Collision-warning tint on a footprint that overlaps another (soft cue). */
const WARNING_COLOR = "#e0533a";
/** Extra fill strength while an item overlaps a neighbor. */
const WARNING_FILL_BOOST = 0.12;
/** Gap between a footprint's screen-top edge and the chip's leader line. */
const CHIP_GAP = 0.12;

/** Raycast opt-out for the strokes inside a pickable footprint group — the
 * fill mesh alone defines the hit area (drei Line quads overshoot it). */
const noRaycast = () => null;

/** The halo ring keeps a constant gap, so its corners round a touch more. */
function haloRadius(
  radius: number | [number, number, number, number],
): number | [number, number, number, number] {
  return Array.isArray(radius)
    ? (radius.map((r) => r + HALO_GAP) as [number, number, number, number])
    : radius + HALO_GAP;
}

const LABEL_CLASS =
  "whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#475569]";
const FAINT_LABEL_CLASS =
  "whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#8a97b1]";

/** Plan point → world vector on the floor plane (world z = plan y). */
function v3(p: Point, y: number): [number, number, number] {
  return [p.x, y, p.y];
}

/** Plan-coordinate polygon as a three Shape (mirrored so world z = plan y
 * after the standard `rotation-x={-Math.PI / 2}`). */
function shapeFromPoints(points: Point[]): Shape {
  const shape = new Shape();
  for (const [i, p] of points.entries()) {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  }
  shape.closePath();
  return shape;
}

/** The plan footprint of a wall span: a rect straddling the edge line
 * (± half thickness), as 4 corners in plan coordinates. */
function bandRect(solid: WallSolid, span: Span): [Point, Point, Point, Point] {
  const half = WALL_THICKNESS / 2;
  return [
    wallPoint(solid, span.start, -half),
    wallPoint(solid, span.end, -half),
    wallPoint(solid, span.end, half),
    wallPoint(solid, span.start, half),
  ];
}

/** A mesh lying flat on the floor built from plan-coordinate shapes. */
function FlatShape({
  shapes,
  y,
  color,
  opacity = 1,
}: {
  shapes: Shape | Shape[];
  y: number;
  color: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => new ShapeGeometry(shapes), [shapes]);
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} position-y={y}>
      <meshBasicMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </mesh>
  );
}

/** Interior floor grid, one 0.5 m cell (module-cached; client-only file). */
let floorTextureCache: CanvasTexture | null = null;
function floorTexture(): CanvasTexture {
  if (floorTextureCache) return floorTextureCache;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = FLOOR_GRID_COLOR;
  ctx.fillRect(0, 0, 128, 2);
  ctx.fillRect(0, 0, 2, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // ShapeGeometry UVs are plan meters; one tile per grid cell.
  texture.repeat.set(1 / FLOOR_GRID_CELL, 1 / FLOOR_GRID_CELL);
  floorTextureCache = texture;
  return texture;
}

/** Soft drop shadow under the whole plan (mockup: large blurred box-shadow),
 * baked into a texture so it hugs the plan's shape instead of ringing it the
 * way a radial blob would. The outline path is filled and stroked with a
 * round join twice the wall thickness — a polygon dilation — so the shadow
 * follows non-rectangular (L-shaped) rooms instead of boxing their bounds. */
const SHADOW_MARGIN = 1;
const SHADOW_SCALE = 48;
function PlanShadow({
  outline,
  min,
  max,
}: {
  outline: Point[];
  min: Point;
  max: Point;
}) {
  const width = max.x - min.x + 2 * WALL_THICKNESS;
  const height = max.y - min.y + 2 * WALL_THICKNESS;
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((width + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
    canvas.height = Math.ceil((height + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    ctx.filter = `blur(${0.35 * SHADOW_SCALE}px)`;
    ctx.fillStyle = "#0f1b3d";
    ctx.strokeStyle = "#0f1b3d";
    ctx.lineWidth = 2 * WALL_THICKNESS * SHADOW_SCALE;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const [i, p] of outline.entries()) {
      const x = (p.x - min.x + WALL_THICKNESS + SHADOW_MARGIN) * SHADOW_SCALE;
      // Shadow falls slightly downward, like the mockup's 0 34px 90px.
      const y =
        (p.y - min.y + WALL_THICKNESS + SHADOW_MARGIN + 0.2) * SHADOW_SCALE;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return new CanvasTexture(canvas);
  }, [outline, width, height, min.x, min.y]);
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[(min.x + max.x) / 2, SHADOW_Y, (min.y + max.y) / 2]}
    >
      <planeGeometry
        args={[width + 2 * SHADOW_MARGIN, height + 2 * SHADOW_MARGIN]}
      />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Window symbol: three parallel lines crossing the wall band, centered on
 * the edge line (the wall now straddles it ± half thickness). */
function WindowSymbol({ solid, hole }: { solid: WallSolid; hole: WallHole }) {
  const inset = 0.02;
  const half = WALL_THICKNESS / 2;
  const lines: Array<{ offset: number; width: number }> = [
    { offset: -half + inset, width: 3 },
    { offset: 0, width: 2 },
    { offset: half - inset, width: 3 },
  ];
  return (
    <group>
      {lines.map(({ offset, width }) => (
        <Line
          key={offset}
          points={[
            v3(wallPoint(solid, hole.start, offset), LINE_Y),
            v3(wallPoint(solid, hole.start + hole.width, offset), LINE_Y),
          ]}
          color={WALL_COLOR}
          lineWidth={width}
          alphaToCoverage={false}
        />
      ))}
    </group>
  );
}

/** Door symbol: open leaf plus the dashed quarter-circle swing arc. */
function DoorSymbol({ solid, hole }: { solid: WallSolid; hole: WallHole }) {
  const swing = useMemo(() => doorSwing(solid, hole), [solid, hole]);
  const arcDashes = useMemo(
    () => dashedPolyline(swing.arc, 0.09, 0.06),
    [swing],
  );
  return (
    <group>
      <Line
        points={[v3(swing.hinge, LINE_Y), v3(swing.leafEnd, LINE_Y)]}
        color={SYMBOL_COLOR}
        lineWidth={3}
        alphaToCoverage={false}
      />
      <Line
        segments
        points={arcDashes.map((p) => v3(p, LINE_Y))}
        color={DOOR_ARC_COLOR}
        lineWidth={2.5}
        alphaToCoverage={false}
      />
    </group>
  );
}

/** One wall's openings: the white break in the navy fill, then the symbol.
 * A break paints over the plan's drop shadow behind an exterior wall's band;
 * a two-face (shared) wall has no break — the doorway shows the neighbor's
 * floor running through the portal. There is one solid per edge, so both
 * rooms' openings are here and each draws exactly once. */
function WallOpenings({ solid }: { solid: WallSolid }) {
  const breakShapes = useMemo(
    () =>
      solid.faces < 2
        ? solid.holes.map((hole) =>
            shapeFromPoints(
              bandRect(solid, {
                start: hole.start,
                end: hole.start + hole.width,
              }),
            ),
          )
        : [],
    [solid],
  );
  if (solid.holes.length === 0) return null;
  return (
    <group>
      {breakShapes.length > 0 && (
        <FlatShape shapes={breakShapes} y={OPENING_Y} color={FLOOR_COLOR} />
      )}
      {solid.holes.map((hole) =>
        hole.kind !== "window" ? (
          <DoorSymbol key={hole.id} solid={solid} hole={hole} />
        ) : (
          <WindowSymbol key={hole.id} solid={solid} hole={hole} />
        ),
      )}
    </group>
  );
}

/** True when the item's long axis runs vertically on the plan, so its label
 * should read top-to-bottom (mockup: CABINET, SHELF). */
function labelReadsVertically(item: FurnitureItem): boolean {
  const quarterTurned = Math.round(item.rotation / 90) % 2 !== 0;
  const { width, depth } = item.footprint;
  return quarterTurned ? width > depth : depth > width;
}

/**
 * Picking behavior shared by every plan footprint, mirroring the 3D lens's
 * FurnitureMesh contract: hover cursor, click-to-select with the drag slop
 * guard, and a pointerdown on the already-selected item arming a move drag.
 * `children` renders the footprint at the origin, styled for `active`
 * (hovered or selected); rotation stays inside so plant symbols can skip it.
 */
function PickableFootprint({
  item,
  selected,
  onSelect,
  onDragStart,
  children,
}: {
  item: FurnitureItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (
    item: FurnitureItem,
    floorPoint: Point,
    screen: { x: number; y: number },
  ) => void;
  children: (active: boolean) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <group> is an R3F scene node, not a DOM element.
    <group
      position={[item.position.x, 0, item.position.y]}
      onClick={(event) => {
        // A drag that ends on a footprint is a camera pan, not a pick.
        if (event.delta > CLICK_SLOP_PX) return;
        event.stopPropagation();
        onSelect(item.id);
      }}
      onPointerDown={(event) => {
        // Only a selected item arms a move drag — the first press picks,
        // the next press-and-drag moves (right button still pans).
        if (!selected || event.button !== 0) return;
        const hit = new Vector3();
        if (!event.ray.intersectPlane(FLOOR_PLANE, hit)) return;
        event.stopPropagation();
        onDragStart(
          item,
          { x: hit.x, y: hit.z },
          { x: event.clientX, y: event.clientY },
        );
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children(selected || hovered)}
    </group>
  );
}

function PlantFootprint({
  item,
  active,
  selected,
  warning,
}: {
  item: FurnitureItem;
  active: boolean;
  selected: boolean;
  warning: boolean;
}) {
  const radius = item.footprint.width / 2;
  const outline = useMemo(() => circlePoints(radius), [radius]);
  const shape = useMemo(() => shapeFromPoints(outline), [outline]);
  const halo = useMemo(() => circlePoints(radius + HALO_GAP), [radius]);
  const cross = 0.66 * radius * Math.SQRT1_2;
  // Stacked riders draw over their host's footprint.
  const lift = item.stack ? STACK_LIFT : 0;
  const fillY = FILL_Y + lift;
  const lineY = LINE_Y + lift;
  return (
    <group>
      <FlatShape
        shapes={shape}
        y={fillY}
        color={warning ? WARNING_COLOR : PLANT_FILL}
        opacity={
          (selected ? 0.16 + SELECTED_FILL_BOOST : 0.16) +
          (warning ? WARNING_FILL_BOOST : 0)
        }
      />
      <Line
        points={[...outline, outline[0]].map((p) => v3(p, lineY))}
        color={
          active ? SELECTION_COLOR : warning ? WARNING_COLOR : SYMBOL_COLOR
        }
        lineWidth={selected ? 2.5 : 2}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      {[1, -1].map((sign) => (
        <Line
          key={sign}
          points={[
            v3({ x: -cross, y: -sign * cross }, lineY),
            v3({ x: cross, y: sign * cross }, lineY),
          ]}
          color={SYMBOL_COLOR}
          lineWidth={2}
          alphaToCoverage={false}
          raycast={noRaycast}
        />
      ))}
      {selected && (
        <Line
          points={[...halo, halo[0]].map((p) => v3(p, lineY))}
          color={SELECTION_COLOR}
          lineWidth={1.5}
          transparent
          opacity={0.45}
          alphaToCoverage={false}
          raycast={noRaycast}
        />
      )}
      <Html
        position={[0, lineY, radius + 0.18]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className={FAINT_LABEL_CLASS}>PLANT</span>
      </Html>
    </group>
  );
}

function FurnitureFootprint({
  item,
  active,
  selected,
  warning,
}: {
  item: FurnitureItem;
  active: boolean;
  selected: boolean;
  warning: boolean;
}) {
  const style = FOOTPRINT_STYLES[item.catalogId] ?? {
    ...FOOTPRINT_FALLBACK,
    label: furnitureDisplayName(item.catalogId).toUpperCase(),
  };
  const { width, depth } = item.footprint;
  const outline = useMemo(
    () => roundedRectPoints(width, depth, style.radius),
    [width, depth, style.radius],
  );
  const shape = useMemo(() => shapeFromPoints(outline), [outline]);
  const halo = useMemo(
    () =>
      roundedRectPoints(
        width + 2 * HALO_GAP,
        depth + 2 * HALO_GAP,
        haloRadius(style.radius),
      ),
    [width, depth, style.radius],
  );
  const isRug = style.dashed === true;
  const border = useMemo(() => {
    const loop = [...outline, outline[0]];
    return isRug ? dashedPolyline(loop, 0.07, 0.05) : loop;
  }, [outline, isRug]);
  // Stacked riders draw over their host's footprint.
  const lift = item.stack ? STACK_LIFT : 0;
  const lineY = (isRug ? RUG_LINE_Y : LINE_Y) + lift;
  const label = isRug ? (
    <Html
      position={[-width / 2 + 0.16, lineY, depth / 2 - 0.14]}
      center
      style={{ pointerEvents: "none" }}
    >
      <span className={FAINT_LABEL_CLASS}>{style.label}</span>
    </Html>
  ) : (
    <Html position={[0, lineY, 0]} center style={{ pointerEvents: "none" }}>
      <span
        className={LABEL_CLASS}
        style={
          labelReadsVertically(item)
            ? { writingMode: "vertical-rl" }
            : undefined
        }
      >
        {style.label}
      </span>
    </Html>
  );
  return (
    <group rotation-y={MathUtils.degToRad(item.rotation)}>
      <FlatShape
        shapes={shape}
        y={(isRug ? RUG_FILL_Y : FILL_Y) + lift}
        color={warning ? WARNING_COLOR : style.fill}
        opacity={
          (selected
            ? style.fillOpacity + SELECTED_FILL_BOOST
            : style.fillOpacity) + (warning ? WARNING_FILL_BOOST : 0)
        }
      />
      <Line
        segments={isRug}
        points={border.map((p) => v3(p, lineY))}
        color={
          active
            ? SELECTION_COLOR
            : warning
              ? WARNING_COLOR
              : isRug
                ? "#9aa9c7"
                : SYMBOL_COLOR
        }
        lineWidth={selected ? 2.5 : 2}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      {selected && (
        <Line
          points={[...halo, halo[0]].map((p) => v3(p, lineY))}
          color={SELECTION_COLOR}
          lineWidth={1.5}
          transparent
          opacity={0.45}
          alphaToCoverage={false}
          raycast={noRaycast}
        />
      )}
      {label}
    </group>
  );
}

/** External dimension line with end ticks and a centered value pill. */
function DimensionLine({
  from,
  to,
  label,
}: {
  from: Point;
  to: Point;
  label: string;
}) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return null;
  const perp = {
    x: -(to.y - from.y) / length,
    y: (to.x - from.x) / length,
  };
  const tick = (p: Point): [number, number, number][] => [
    v3(
      { x: p.x - perp.x * DIMENSION_TICK, y: p.y - perp.y * DIMENSION_TICK },
      LINE_Y,
    ),
    v3(
      { x: p.x + perp.x * DIMENSION_TICK, y: p.y + perp.y * DIMENSION_TICK },
      LINE_Y,
    ),
  ];
  return (
    <group>
      <Line
        points={[v3(from, LINE_Y), v3(to, LINE_Y)]}
        color={DIMENSION_COLOR}
        lineWidth={1.5}
        alphaToCoverage={false}
      />
      <Line
        segments
        points={[...tick(from), ...tick(to)]}
        color={DIMENSION_COLOR}
        lineWidth={1.5}
        alphaToCoverage={false}
      />
      <Html
        position={[(from.x + to.x) / 2, LINE_Y, (from.y + to.y) / 2]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className="whitespace-nowrap rounded-lg border border-[rgba(15,27,61,0.12)] bg-white px-[11px] py-[3px] font-mono text-[13px] text-[#33415C]">
          {label}
        </span>
      </Html>
    </group>
  );
}

/**
 * Every wall of the floor as architectural fill (one navy rect per solid
 * span, straddling the edge line), the filler posts at the graph's junction
 * nodes, and each wall's opening symbols. Floor-level, since a shared wall
 * belongs to two rooms — drawn once by `PlanScene`.
 */
function WallLayer({
  solids,
  posts,
}: {
  solids: WallSolid[];
  posts: NodePost[];
}) {
  const wallShapes = useMemo(() => {
    const shapes = solids.flatMap((solid) =>
      solidSpans(solid).map((span) => shapeFromPoints(bandRect(solid, span))),
    );
    const half = WALL_THICKNESS / 2;
    for (const post of posts) {
      shapes.push(
        shapeFromPoints([
          { x: post.center.x - half, y: post.center.y - half },
          { x: post.center.x + half, y: post.center.y - half },
          { x: post.center.x + half, y: post.center.y + half },
          { x: post.center.x - half, y: post.center.y + half },
        ]),
      );
    }
    return shapes;
  }, [solids, posts]);
  return (
    <group>
      {wallShapes.length > 0 && (
        <FlatShape shapes={wallShapes} y={WALL_Y} color={WALL_COLOR} />
      )}
      {solids.map((solid) => (
        <WallOpenings key={solid.edgeId} solid={solid} />
      ))}
    </group>
  );
}

/**
 * A bucket of plan footprints (a room's, or the unassigned/open-canvas items),
 * pickable and draggable in the 2D lens. Overlap warnings are scoped to the
 * bucket — items in different buckets can't overlap, containment keeps them
 * apart at the walls. Static (non-interactive) rendering is DrawScene's
 * backdrop.
 */
function PlanFootprints({
  furniture,
  selectedId = null,
  interactive = false,
  onSelectItem,
  onDragStart,
}: {
  furniture: FurnitureItem[];
  selectedId?: string | null;
  interactive?: boolean;
  onSelectItem?: (id: string) => void;
  onDragStart?: (
    item: FurnitureItem,
    floorPoint: Point,
    screen: { x: number; y: number },
  ) => void;
}) {
  const warnings = useMemo(
    () => overlappingFurnitureIds(furniture),
    [furniture],
  );
  return (
    <>
      {furniture.map((item) => {
        const footprint = (active: boolean) =>
          catalogItemById(item.catalogId)?.category === "plants" ? (
            <PlantFootprint
              item={item}
              active={active}
              selected={item.id === selectedId}
              warning={warnings.has(item.id)}
            />
          ) : (
            <FurnitureFootprint
              item={item}
              active={active}
              selected={item.id === selectedId}
              warning={warnings.has(item.id)}
            />
          );
        return interactive && onSelectItem && onDragStart ? (
          <PickableFootprint
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={onSelectItem}
            onDragStart={onDragStart}
          >
            {footprint}
          </PickableFootprint>
        ) : (
          <group key={item.id} position={[item.position.x, 0, item.position.y]}>
            {footprint(false)}
          </group>
        );
      })}
    </>
  );
}

export interface PlanRoomLayerProps {
  room: Room;
  /** Floor-wide furniture selection; only this room's items can match. */
  selectedId?: string | null;
  /** Interactive rendering (the 2D lens): pickable footprints. */
  interactive?: boolean;
  onSelectItem?: (id: string) => void;
  onDragStart?: (
    item: FurnitureItem,
    floorPoint: Point,
    screen: { x: number; y: number },
  ) => void;
}

/**
 * One room of the floor as an architectural drawing: shadow, floor sheet,
 * furniture footprints, and the room's area card. Walls, opening symbols and
 * the floor-level concerns (selection chip, rotate handle, move-drag session,
 * dimension lines, opening tools) live in `PlanScene`.
 */
export function PlanRoomLayer({
  room,
  selectedId = null,
  interactive = false,
  onSelectItem,
  onDragStart,
}: PlanRoomLayerProps) {
  const bounds = useMemo(() => outlineBounds(room.outline), [room.outline]);
  const area = useMemo(() => floorArea(room.outline), [room.outline]);
  const floorShape = useMemo(
    () => (room.outline.length >= 3 ? shapeFromPoints(room.outline) : null),
    [room.outline],
  );

  if (!bounds || !floorShape) return null;
  return (
    <group>
      <PlanShadow outline={room.outline} min={bounds.min} max={bounds.max} />
      <mesh rotation-x={-Math.PI / 2} position-y={FLOOR_Y}>
        <shapeGeometry args={[floorShape]} />
        <meshBasicMaterial map={floorTexture()} />
      </mesh>
      <PlanFootprints
        furniture={room.furniture}
        selectedId={selectedId}
        interactive={interactive}
        onSelectItem={onSelectItem}
        onDragStart={onDragStart}
      />
      <Html
        position={[
          (bounds.min.x + bounds.max.x) / 2,
          LINE_Y,
          (bounds.min.y + bounds.max.y) / 2,
        ]}
        center
        style={{ pointerEvents: "none" }}
      >
        <div className="flex flex-col items-center gap-1 whitespace-nowrap rounded-[14px] border border-[rgba(15,27,61,0.08)] bg-white/85 px-[22px] py-3 shadow-[0_12px_30px_rgba(15,27,61,0.08)] backdrop-blur-[10px]">
          <span className="text-[15px] font-bold tracking-[0.14em] text-[#33415C]">
            {(room.name ?? "Room").toUpperCase()}
          </span>
          <span className="font-mono text-[12.5px] text-[#3a5bf0]">
            {area.toFixed(2)} m² floor area
          </span>
        </div>
      </Html>
    </group>
  );
}

export interface PlanSceneProps {
  /** Every derived room of the floor; walls are built from the graph edges. */
  rooms: DerivedRoom[];
  /** Furniture that lands in no room (dangling / open-canvas). */
  unassignedFurniture: FurnitureItem[];
  /** The graph floor — walls are one solid per edge; mounts re-anchor to it. */
  floor: Floor;
  selectedId: string | null;
  /** Selected opening id — never set together with `selectedId`. */
  selectedOpeningId: string | null;
  unit: Unit;
  /** Snap toggle: off means free furniture moves (no flush/quantize). */
  snapEnabled: boolean;
  onSelectItem: (id: string) => void;
  /** Live update during a move drag (already snapped; wall items carry
   * mount). Furniture is floor-level — the write-back re-partitions the item
   * into whichever room now contains it (or the unassigned bucket). */
  onMoveItem: (id: string, update: FurnitureUpdate) => void;
  /** A move drag started/ended — the canvas locks pan/zoom while it runs. */
  onMoveActiveChange: (active: boolean) => void;
  onSelectOpening: (id: string) => void;
  /** Live re-offset during an opening drag (already snapped). */
  onMoveOpening: (id: string, offset: number) => void;
  onFlipDoorHinge: (id: string) => void;
  /** Flip which room a portal door opens into (edges with two faces only). */
  onFlipOpeningSide: (id: string) => void;
  onDeleteOpening: (id: string) => void;
  /** A committed width from the opening chip's field. */
  onResizeOpening: (id: string, width: number) => void;
}

export function PlanScene({
  rooms,
  unassignedFurniture,
  floor,
  selectedId,
  selectedOpeningId,
  unit,
  snapEnabled,
  onSelectItem,
  onMoveItem,
  onMoveActiveChange,
  onSelectOpening,
  onMoveOpening,
  onFlipDoorHinge,
  onFlipOpeningSide,
  onDeleteOpening,
  onResizeOpening,
}: PlanSceneProps) {
  const bounds = useMemo(() => floorBounds(rooms), [rooms]);
  // One wall solid per graph edge + filler posts at the junction nodes, drawn
  // once (a shared wall belongs to two rooms). Portal labels come from the
  // graph's edge face-adjacency.
  const solids = useMemo(() => buildEdgeSolids(floor, rooms), [floor, rooms]);
  const posts = useMemo(() => nodePosts(floor, solids), [floor, solids]);
  // Wall slabs for the rotate handle's re-containment (same policy as nudge).
  const wallObstacles = useMemo(() => edgeWallObstacles(floor), [floor]);
  const portalLabels = useMemo(
    () =>
      new Map(
        floor.openings.map((opening) => [
          opening.id,
          portalLabel(rooms, floor, opening.id) ?? "",
        ]),
      ),
    [rooms, floor],
  );

  const { drag, beginDrag, endDrag } = useMoveDrag(onMoveActiveChange);
  // Selection and drags are floor-wide; the item is found across every room
  // plus the unassigned bucket. The owning room (for the rotate handle's
  // containment) is derived from the item id, undefined when unassigned.
  const allFurniture = useMemo(
    () => allFurnitureOf(rooms, unassignedFurniture),
    [rooms, unassignedFurniture],
  );
  const selectedItem =
    allFurniture.find((item) => item.id === selectedId) ?? null;
  const selectedRoom = selectedId
    ? rooms.find((room) =>
        room.furniture.some((item) => item.id === selectedId),
      )
    : undefined;

  if (!bounds) return null;
  const dimensionOffset = WALL_THICKNESS + DIMENSION_GAP;
  return (
    <group>
      {rooms.map((room) => (
        <PlanRoomLayer
          key={room.id}
          room={room}
          selectedId={selectedId}
          interactive
          onSelectItem={onSelectItem}
          onDragStart={beginDrag}
        />
      ))}
      {unassignedFurniture.length > 0 && (
        <PlanFootprints
          furniture={unassignedFurniture}
          selectedId={selectedId}
          interactive
          onSelectItem={onSelectItem}
          onDragStart={beginDrag}
        />
      )}
      <WallLayer solids={solids} posts={posts} />
      <PlanOpenings
        solids={solids}
        selectedId={selectedOpeningId}
        portalLabels={portalLabels}
        unit={unit}
        onSelect={onSelectOpening}
        onMove={onMoveOpening}
        onFlipHinge={onFlipDoorHinge}
        onFlipSide={onFlipOpeningSide}
        onDelete={onDeleteOpening}
        onResize={onResizeOpening}
        onDragActiveChange={onMoveActiveChange}
      />
      {selectedItem && !selectedItem.mount && !drag && (
        <RotateHandle
          item={selectedItem}
          // An unassigned item has no containing room — no wall-angle
          // detents, but the knob (and the 15° grid) still works.
          outline={selectedRoom?.outline ?? []}
          wallObstacles={wallObstacles}
          snapEnabled={snapEnabled}
          onRotate={(update) => onMoveItem(selectedItem.id, update)}
          onActiveChange={onMoveActiveChange}
        />
      )}
      {selectedItem && (
        <SelectionChip
          item={selectedItem}
          // Height doesn't project under the straight-down camera; hang
          // the chip off the footprint's screen-top edge instead.
          anchor={[
            selectedItem.position.x,
            LINE_Y,
            selectedItem.position.y -
              rotatedFootprintSize(
                selectedItem.footprint,
                selectedItem.rotation,
              ).depth /
                2 -
              CHIP_GAP,
          ]}
        />
      )}
      {drag && (
        <MoveDragSession
          furniture={allFurniture}
          floor={floor}
          drag={drag}
          unit={unit}
          snapEnabled={snapEnabled}
          onMove={(update) => onMoveItem(drag.id, update)}
          onEnd={endDrag}
        />
      )}
      {/* Whole-floor dimension lines: one width + one height along the
			    floor's bounding box (per-room lines would collide on flush rooms). */}
      <DimensionLine
        from={{ x: bounds.min.x, y: bounds.min.y - dimensionOffset }}
        to={{ x: bounds.max.x, y: bounds.min.y - dimensionOffset }}
        label={`${bounds.width.toFixed(2)} m`}
      />
      <DimensionLine
        from={{ x: bounds.min.x - dimensionOffset, y: bounds.min.y }}
        to={{ x: bounds.min.x - dimensionOffset, y: bounds.max.y }}
        label={`${bounds.height.toFixed(2)} m`}
      />
    </group>
  );
}
