import { useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BackSide,
  CanvasTexture,
  Color,
  type DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  MathUtils,
  type Mesh,
  Object3D,
  Path,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
} from "three";
import {
  CLICK_SLOP_PX,
  MoveDragSession,
  useMoveDrag,
} from "#/components/move-drag";
import { SelectionChip } from "#/components/selection-chip";
import { overlappingFurnitureIds } from "#/lib/collision";
import {
  furnitureParts,
  type PartShape,
  partHullScale,
  partScale,
} from "#/lib/furniture-parts";
import type {
  Bounds,
  FurnitureItem,
  FurnitureUpdate,
  Point,
  Room,
} from "#/lib/model";
import { floorBounds, stackSurfaceHeight, wallHeightOf } from "#/lib/model";
import {
  buildWallSolids,
  cornerPosts,
  SLAB_THICKNESS,
  STUB_WALL_HEIGHT,
  stubSpans,
  WALL_THICKNESS,
  type WallSolid,
  wallPieces,
} from "#/lib/room-scene";
import { floorSeamData, type RoomSeamData } from "#/lib/seams";
import type { Unit } from "#/lib/units";

/**
 * The warm room rendered from the model: dollhouse floor platform, walls
 * extruded with door/window holes cut out, placeholder furniture from
 * footprints. Every color below is lifted from the mockup's 3D scene
 * (`design/planforge-mockups.html`, screen 1a), not invented.
 *
 * Walls between the camera and the interior cut themselves down to a low
 * stub each frame (Sims-style dollhouse cutaway — the wall line stays
 * legible while furniture shows), and shared party walls stay cut down at
 * every orbit since they always occlude one of their two rooms.
 */

/** Everything sits a hair above the y=0 grid plane to avoid z-fighting. */
const FLOOR_TOP = 0.001;
const PLANK_PERIOD = 0.8;
const PLANK_COLORS = ["#eaddc6", "#decfb2", "#e4d6bc"] as const;
const SLAB_SIDE_COLOR = "#2b3452";
const WALL_TOP_COLOR = "#f8f2e7";
const WALL_BOTTOM_COLOR = "#efe5d3";
const BASEBOARD_COLOR = "#e9dec9";
const BASEBOARD_HEIGHT = 0.12;
/** Wall edges, tops and opening jambs. */
const WALL_EDGE_COLOR = "#ede2ce";
const WINDOW_FRAME_COLOR = "#e6dbc6";
const WINDOW_FRAME_SIZE = 0.09;
const PANE_COLORS = ["#fff6de", "#ffe9c2"] as const;

/** Mockup's selection stroke: rgba(58,91,240,.7) on the desk chair faces. */
const SELECTION_COLOR = "#3a5bf0";
/** Collision-warning tint mixed into a body that overlaps a neighbor. */
const WARNING_COLOR = "#e0533a";
const WARNING_MIX = 0.55;
/** Blend a furniture color toward the warning red (soft overlap cue). */
function warnColor(base: string): string {
  return new Color(base).lerp(new Color(WARNING_COLOR), WARNING_MIX).getStyle();
}
/** Raycast opt-out for scenery: only furniture is pickable, so any other
 * click reaches the canvas's pointer-missed handler and deselects. */
const noRaycast = () => null;

/**
 * Cutaway threshold on the wall-to-camera facing dot: slightly negative so
 * near-edge-on walls cut down too instead of lingering as slivers.
 */
const HIDE_FACING_THRESHOLD = -0.06;
/** Above this upness the camera is plan-like and every wall stays full. */
const PLAN_UPNESS = 0.94;

function makeTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Shared textures, created lazily on first client render (this module only
 * runs client-side — the canvas is lazy-loaded after mount).
 */
let textureCache: {
  plank: CanvasTexture;
  pane: CanvasTexture;
  blob: CanvasTexture;
} | null = null;

/**
 * Wall-face texture for a given wall height, cached per height: the baseboard
 * band must stay a fixed 0.12 m regardless of how tall the gradient above it
 * runs, so the texture bakes the height in (one vertical tile = one wall).
 */
const wallTextureCache = new Map<number, CanvasTexture>();

function wallTexture(wallHeight: number): CanvasTexture {
  const cached = wallTextureCache.get(wallHeight);
  if (cached) return cached;
  // Wall face, floor to ceiling: baseboard band, then a soft warm gradient.
  // flipY puts canvas-bottom at v=0, which the repeat maps to wall-bottom.
  const wall = makeTexture(4, 512, (ctx) => {
    const baseboardPx = Math.round((BASEBOARD_HEIGHT / wallHeight) * 512);
    const gradient = ctx.createLinearGradient(0, 0, 0, 512 - baseboardPx);
    gradient.addColorStop(0, WALL_TOP_COLOR);
    gradient.addColorStop(1, WALL_BOTTOM_COLOR);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 512);
    ctx.fillStyle = BASEBOARD_COLOR;
    ctx.fillRect(0, 512 - baseboardPx, 4, baseboardPx);
  });
  wall.repeat.set(1, 1 / wallHeight);
  wallTextureCache.set(wallHeight, wall);
  return wall;
}

function sharedTextures() {
  if (textureCache) return textureCache;

  // One plank period: plank, dark seam, light seam (mockup: 76/2/2 of 80 px).
  const plank = makeTexture(256, 4, (ctx) => {
    ctx.fillStyle = PLANK_COLORS[0];
    ctx.fillRect(0, 0, 256, 4);
    ctx.fillStyle = PLANK_COLORS[1];
    ctx.fillRect(243, 0, 7, 4);
    ctx.fillStyle = PLANK_COLORS[2];
    ctx.fillRect(250, 0, 6, 4);
  });
  plank.wrapS = RepeatWrapping;
  plank.wrapT = RepeatWrapping;
  plank.repeat.set(1 / PLANK_PERIOD, 1 / PLANK_PERIOD);

  // Daylight glow for window panes.
  const pane = makeTexture(4, 128, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, PANE_COLORS[0]);
    gradient.addColorStop(1, PANE_COLORS[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 128);
  });

  // Radial alpha falloff shared by every soft blob shadow.
  const blob = makeTexture(256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });

  textureCache = { plank, pane, blob };
  return textureCache;
}

/** Plan outline as a three Shape: plan y is mirrored so world z = plan y. */
function planShape(outline: Point[]): Shape {
  const shape = new Shape();
  for (const [i, point] of outline.entries()) {
    if (i === 0) shape.moveTo(point.x, -point.y);
    else shape.lineTo(point.x, -point.y);
  }
  shape.closePath();
  return shape;
}

/** A soft elliptical shadow lying on the floor (or the canvas below). */
function BlobShadow({
  width,
  depth,
  y,
  color,
  opacity,
}: {
  width: number;
  depth: number;
  y: number;
  color: string;
  opacity: number;
}) {
  const { blob } = sharedTextures();
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position-y={y}
      renderOrder={-1}
      raycast={noRaycast}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        color={color}
        alphaMap={blob}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Floor slab: plank top, navy skirt. */
function Platform({ outline }: { outline: Point[] }) {
  const { plank } = sharedTextures();
  const geometry = useMemo(() => {
    if (outline.length < 3) return null;
    return new ExtrudeGeometry(planShape(outline), {
      depth: SLAB_THICKNESS,
      bevelEnabled: false,
    });
  }, [outline]);

  if (!geometry) return null;
  return (
    <group>
      {/* Extrusion runs up from the shape plane; sink it so the plank cap
			    lands at FLOOR_TOP. Material 0 = caps, 1 = extruded sides. */}
      <mesh
        geometry={geometry}
        rotation-x={-Math.PI / 2}
        position-y={FLOOR_TOP - SLAB_THICKNESS}
        raycast={noRaycast}
      >
        <meshLambertMaterial attach="material-0" map={plank} />
        <meshLambertMaterial attach="material-1" color={SLAB_SIDE_COLOR} />
      </mesh>
    </group>
  );
}

/**
 * Studio contact shadow grounding the model in the spotlight pool (screen
 * 3d: rgba(18,24,44,.30)). One shadow for the whole floor — per-room blobs
 * would overlap into dark seams under a multi-room flat.
 */
function FloorContactShadow({ bounds }: { bounds: Bounds }) {
  return (
    <group
      position={[
        (bounds.min.x + bounds.max.x) / 2,
        0,
        (bounds.min.y + bounds.max.y) / 2,
      ]}
    >
      <BlobShadow
        width={bounds.width * 1.28}
        depth={bounds.height * 1.18}
        y={FLOOR_TOP - SLAB_THICKNESS - 0.004}
        color="#12182c"
        opacity={0.3}
      />
    </group>
  );
}

/** Frame, muntin cross and glowing pane for one window hole (wall-local). */
function WindowDressing({
  hole,
  zCenter,
}: {
  hole: WallSolid["holes"][number];
  /** Wall-local z of the dressing's center plane (mid-thickness; on shared
   * walls the seam line, so the frame straddles both rooms' halves). */
  zCenter: number;
}) {
  const { pane } = sharedTextures();
  const f = WINDOW_FRAME_SIZE;
  const cx = hole.start + hole.width / 2;
  const cy = (hole.bottom + hole.top) / 2;
  const height = hole.top - hole.bottom;
  // Centered in the wall, slightly deeper than it, so the frame reads as a
  // lip on both faces without caring which side is the interior.
  const z = zCenter;
  const frameDepth = WALL_THICKNESS + 0.02;
  // Frame bars sit inside the hole, border-box style; the muntin cross
  // stays within the wall thickness.
  const bars: Array<[string, number, number, number, number, number]> = [
    ["sill", cx, hole.bottom + f / 2, hole.width, f, frameDepth],
    ["head", cx, hole.top - f / 2, hole.width, f, frameDepth],
    ["jamb-l", hole.start + f / 2, cy, f, height - 2 * f, frameDepth],
    [
      "jamb-r",
      hole.start + hole.width - f / 2,
      cy,
      f,
      height - 2 * f,
      frameDepth,
    ],
    ["muntin-v", cx, cy, 0.06, height - 2 * f, WALL_THICKNESS],
    ["muntin-h", cx, cy, hole.width - 2 * f, 0.06, WALL_THICKNESS],
  ];
  return (
    <group>
      <mesh position={[cx, cy, z]} raycast={noRaycast}>
        <planeGeometry args={[hole.width - f, height - f]} />
        <meshBasicMaterial map={pane} side={DoubleSide} />
      </mesh>
      {bars.map(([id, x, y, w, h, d]) => (
        <mesh key={id} position={[x, y, z]} raycast={noRaycast}>
          <boxGeometry args={[w, h, d]} />
          <meshLambertMaterial color={WINDOW_FRAME_COLOR} />
        </mesh>
      ))}
      {/* Daylight spilling in, standing in for the mockup's window glow. */}
      <pointLight
        position={[cx, cy, z]}
        color="#ffd9a0"
        intensity={4}
        distance={7}
        decay={2}
      />
    </group>
  );
}

/**
 * The four per-frame display groups of one wall: seam (shared) and plain
 * stretches cut down independently, each flipping between its full-height
 * and stub rendition. The frame loop writes `visible` straight onto these.
 */
interface WallDisplay {
  plainFull: Group | null;
  plainStub: Group | null;
  seamFull: Group | null;
  seamStub: Group | null;
}

function WallMesh({
  solid,
  wallHeight,
  display,
}: {
  solid: WallSolid;
  wallHeight: number;
  /** Owned by `Walls`; the group refs below register themselves into it. */
  display: WallDisplay;
}) {
  const wall = wallTexture(wallHeight);
  // One extrusion per constant-thickness piece: shared (seam) stretches are
  // half as thick — the abutting room extrudes the other half on its side of
  // the wall line, so together the party wall reads as one, not doubled.
  // Each piece also builds its cut-down stub: the same footprint at stub
  // height, with door/portal holes widened into full gaps (`stubSpans`).
  // The stub reuses the full wall texture, so it keeps the real baseboard.
  const pieces = useMemo(
    () =>
      wallPieces(solid).map((piece) => {
        const shape = new Shape();
        shape.moveTo(piece.start, 0);
        shape.lineTo(piece.end, 0);
        shape.lineTo(piece.end, wallHeight);
        shape.lineTo(piece.start, wallHeight);
        shape.closePath();
        for (const hole of piece.holes) {
          const path = new Path();
          path.moveTo(hole.start, hole.bottom);
          path.lineTo(hole.start + hole.width, hole.bottom);
          path.lineTo(hole.start + hole.width, hole.top);
          path.lineTo(hole.start, hole.top);
          path.closePath();
          shape.holes.push(path);
        }
        const thickness = piece.seam ? WALL_THICKNESS / 2 : WALL_THICKNESS;
        const stubShapes = stubSpans(piece).map((span) => {
          const stub = new Shape();
          stub.moveTo(span.start, 0);
          stub.lineTo(span.end, 0);
          stub.lineTo(span.end, STUB_WALL_HEIGHT);
          stub.lineTo(span.start, STUB_WALL_HEIGHT);
          stub.closePath();
          return stub;
        });
        return {
          start: piece.start,
          seam: piece.seam,
          thickness,
          geometry: new ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: false,
          }),
          stubGeometry:
            stubShapes.length > 0
              ? new ExtrudeGeometry(stubShapes, {
                  depth: thickness,
                  bevelEnabled: false,
                })
              : null,
        };
      }),
    [solid, wallHeight],
  );

  // rotation-y mapping local +X onto the wall direction sends local +Z to
  // plan (-dir.y, dir.x); when that lands inward, shift the extrusion so the
  // wall body sits outside the outline.
  const rotationY = Math.atan2(-solid.dir.y, solid.dir.x);
  const localZOutward =
    solid.outward.x * -solid.dir.y + solid.outward.y * solid.dir.x > 0;
  const zOffset = (thickness: number) => (localZOutward ? 0 : -thickness);
  /** Whether the (unclipped) hole sits on a shared stretch of this wall. */
  const onSeam = (hole: WallSolid["holes"][number]) => {
    const mid = hole.start + hole.width / 2;
    return (solid.seams ?? []).some(
      (span) => span.start <= mid && mid <= span.end,
    );
  };
  const pieceMesh = (
    piece: (typeof pieces)[number],
    geometry: ExtrudeGeometry,
  ) => (
    <mesh
      key={piece.start}
      geometry={geometry}
      position-z={zOffset(piece.thickness)}
      raycast={noRaycast}
    >
      <meshLambertMaterial attach="material-0" map={wall} />
      <meshLambertMaterial attach="material-1" color={WALL_EDGE_COLOR} />
    </mesh>
  );
  // Window dressing (frame + glowing pane + light) rides in its stretch's
  // full-height group: a cut-down wall can't host a floating window. A
  // phantom window is a neighbor's portal — the owning side draws the one
  // frame, centered on the seam so it spans both halves.
  const dressings = (seam: boolean) =>
    solid.holes
      .filter(
        (hole) =>
          hole.kind === "window" && !hole.phantom && onSeam(hole) === seam,
      )
      .map((hole) => (
        <WindowDressing
          key={hole.start}
          hole={hole}
          zCenter={seam ? 0 : zOffset(WALL_THICKNESS) + WALL_THICKNESS / 2}
        />
      ));

  return (
    <group position={[solid.start.x, 0, solid.start.y]} rotation-y={rotationY}>
      <group
        ref={(group) => {
          display.plainFull = group;
        }}
      >
        {pieces
          .filter((piece) => !piece.seam)
          .map((piece) => pieceMesh(piece, piece.geometry))}
        {dressings(false)}
      </group>
      <group
        ref={(group) => {
          display.seamFull = group;
        }}
      >
        {pieces
          .filter((piece) => piece.seam)
          .map((piece) => pieceMesh(piece, piece.geometry))}
        {dressings(true)}
      </group>
      <group
        ref={(group) => {
          display.plainStub = group;
        }}
        visible={false}
      >
        {pieces
          .filter((piece) => !piece.seam && piece.stubGeometry)
          .map((piece) =>
            pieceMesh(piece, piece.stubGeometry as ExtrudeGeometry),
          )}
      </group>
      <group
        ref={(group) => {
          display.seamStub = group;
        }}
        visible={false}
      >
        {pieces
          .filter((piece) => piece.seam && piece.stubGeometry)
          .map((piece) =>
            pieceMesh(piece, piece.stubGeometry as ExtrudeGeometry),
          )}
      </group>
    </group>
  );
}

/** Walls + corner posts with the per-frame dollhouse cutaway. */
function Walls({ room, seamData }: { room: Room; seamData?: RoomSeamData }) {
  const wallHeight = wallHeightOf(room);
  const solids = useMemo(
    () => buildWallSolids(room, wallHeightOf(room), seamData),
    [room, seamData],
  );
  const posts = useMemo(() => cornerPosts(solids), [solids]);
  /** Wall index → position in `solids` (zero-length walls are skipped). */
  const solidPosition = useMemo(
    () => new Map(solids.map((solid, i) => [solid.index, i])),
    [solids],
  );
  /** Which stretch kinds each wall has (drives the tall-post decision). */
  const stretchKinds = useMemo(
    () =>
      solids.map((solid) => {
        const pieces = wallPieces(solid);
        return {
          hasPlain: pieces.some((piece) => !piece.seam),
          hasSeam: pieces.some((piece) => piece.seam),
        };
      }),
    [solids],
  );
  const displays = useMemo<WallDisplay[]>(
    () =>
      solids.map(() => ({
        plainFull: null,
        plainStub: null,
        seamFull: null,
        seamStub: null,
      })),
    [solids],
  );
  const postFullRefs = useRef<(Mesh | null)[]>([]);
  const postStubRefs = useRef<(Mesh | null)[]>([]);
  const tallRef = useRef<boolean[]>([]);

  useFrame(({ camera }) => {
    const tall = tallRef.current;
    for (const [i, solid] of solids.entries()) {
      const midX = solid.start.x + (solid.dir.x * solid.length) / 2;
      const midZ = solid.start.y + (solid.dir.y * solid.length) / 2;
      const toCamX = camera.position.x - midX;
      const toCamY = camera.position.y - wallHeight / 2;
      const toCamZ = camera.position.z - midZ;
      const distance = Math.hypot(toCamX, toCamY, toCamZ) || 1;
      const facing =
        (toCamX * solid.outward.x + toCamZ * solid.outward.y) / distance;
      // Straight-down (plan) views keep every wall full; the cutaway only
      // applies while orbiting. Plain stretches cut down when they face the
      // camera; shared (seam) stretches cut down at every orbit — a party
      // wall always occludes one of its two rooms.
      const planLike = toCamY / distance > PLAN_UPNESS;
      const plainFull = planLike || facing < HIDE_FACING_THRESHOLD;
      const seamFull = planLike;
      const display = displays[i];
      if (display.plainFull) display.plainFull.visible = plainFull;
      if (display.plainStub) display.plainStub.visible = !plainFull;
      if (display.seamFull) display.seamFull.visible = seamFull;
      if (display.seamStub) display.seamStub.visible = !seamFull;
      tall[i] =
        (stretchKinds[i].hasPlain && plainFull) ||
        (stretchKinds[i].hasSeam && seamFull);
    }
    for (const [i, post] of posts.entries()) {
      const a = solidPosition.get(post.walls[0]);
      const b = solidPosition.get(post.walls[1]);
      // A post stands full only next to a wall that still stands full;
      // between two stubs it cuts down with them.
      const postTall =
        (a !== undefined && tall[a]) || (b !== undefined && tall[b]);
      const full = postFullRefs.current[i];
      const stub = postStubRefs.current[i];
      if (full) full.visible = postTall;
      if (stub) stub.visible = !postTall;
    }
  });

  return (
    <group>
      {solids.map((solid, i) => (
        <WallMesh
          key={solid.index}
          solid={solid}
          wallHeight={wallHeight}
          display={displays[i]}
        />
      ))}
      {posts.map((post, i) => (
        <group
          key={`${post.walls[0]}-${post.walls[1]}`}
          position={[post.center.x, 0, post.center.y]}
        >
          <mesh
            ref={(mesh) => {
              postFullRefs.current[i] = mesh;
            }}
            position-y={wallHeight / 2}
            raycast={noRaycast}
          >
            <boxGeometry args={[WALL_THICKNESS, wallHeight, WALL_THICKNESS]} />
            <meshLambertMaterial color={WALL_EDGE_COLOR} />
          </mesh>
          <mesh
            ref={(mesh) => {
              postStubRefs.current[i] = mesh;
            }}
            position-y={STUB_WALL_HEIGHT / 2}
            raycast={noRaycast}
            visible={false}
          >
            <boxGeometry
              args={[WALL_THICKNESS, STUB_WALL_HEIGHT, WALL_THICKNESS]}
            />
            <meshLambertMaterial color={WALL_EDGE_COLOR} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The geometry element for one composed-primitive part. */
function PartGeometry({ shape }: { shape: PartShape }) {
  switch (shape.kind) {
    case "box":
      return <boxGeometry args={shape.size} />;
    case "cylinder":
      return (
        <cylinderGeometry
          args={[shape.radiusTop, shape.radiusBottom, shape.height, 24]}
        />
      );
    case "sphere":
      return <sphereGeometry args={[shape.radius, 24, 18]} />;
  }
}

function FurnitureMesh({
  item,
  stackTop,
  selected,
  warning,
  onSelect,
  onDragStart,
}: {
  item: FurnitureItem;
  /** Present for a stacked rider: its host's top-surface height. */
  stackTop?: number;
  selected: boolean;
  /** Footprint overlaps a neighbor: tint the body as a soft warning. */
  warning: boolean;
  onSelect: (id: string) => void;
  /** Pointer went down on the selected item: begin a move drag. */
  onDragStart: (
    item: FurnitureItem,
    grabPoint: Point,
    screen: { x: number; y: number },
    grabHeight: number,
  ) => void;
}) {
  const { width, depth, height } = item.footprint;
  const yaw = MathUtils.degToRad(item.rotation);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const active = selected || hovered;
  // The highlight is a hand-rolled inverted hull: the same geometry inflated
  // by a constant rim and drawn back-face-only, which reads as a silhouette
  // stroke (the mockup's cyan selection outline). drei's <Outlines> renders
  // nothing under this drei 10 / three r185 combination.
  const hullMaterial = (
    <meshBasicMaterial
      color={SELECTION_COLOR}
      side={BackSide}
      transparent
      opacity={selected ? 0.85 : 0.4}
    />
  );
  const shadow = (
    <BlobShadow
      width={width * 1.5}
      depth={depth * 1.5}
      // A rider's shadow falls on its host's top, not the floor.
      y={stackTop !== undefined ? stackTop + 0.004 : FLOOR_TOP + 0.015}
      color="#462d14"
      opacity={0.35}
    />
  );

  // Composed-primitive body (src/lib/furniture-parts.ts), positioned in
  // bottom-relative part space: floor items rest on the platform, rugs lie
  // nearly flat on it, wall mounts hang centered at their elevation (and
  // cast no floor shadow), stacked riders stand on their host's top.
  const parts = useMemo(
    () => furnitureParts(item.catalogId, item.footprint, item.colorway),
    [item.catalogId, item.footprint, item.colorway],
  );
  const isRug = item.catalogId === "rug";
  const lift = item.mount
    ? item.mount.elevation - height / 2
    : stackTop !== undefined
      ? stackTop + 0.002
      : FLOOR_TOP + (isRug ? 0.001 : 0.017);
  const body = (
    <>
      {!item.mount && !isRug && shadow}
      <group position-y={lift}>
        {parts.map((part, i) => (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are a static list per catalog id.
            key={i}
            position={part.position}
            rotation={part.rotation ?? [0, 0, 0]}
            scale={partScale(part.shape)}
          >
            <PartGeometry shape={part.shape} />
            <meshLambertMaterial
              color={warning ? warnColor(part.color) : part.color}
            />
          </mesh>
        ))}
        {active &&
          parts.map((part, i) => (
            <mesh
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are a static list per catalog id.
              key={i}
              position={part.position}
              rotation={part.rotation ?? [0, 0, 0]}
              scale={partHullScale(part.shape)}
              raycast={noRaycast}
            >
              <PartGeometry shape={part.shape} />
              {hullMaterial}
            </mesh>
          ))}
      </group>
    </>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <group> is an R3F scene node, not a DOM element.
    <group
      position={[item.position.x, 0, item.position.y]}
      rotation-y={yaw}
      onClick={(event) => {
        // A drag that ends on furniture is camera movement, not a pick.
        if (event.delta > CLICK_SLOP_PX) return;
        event.stopPropagation();
        onSelect(item.id);
      }}
      onPointerDown={(event) => {
        // Only a selected item arms a move drag — the first press picks,
        // the next press-and-drag moves (right button still pans).
        if (!selected || event.button !== 0) return;
        // Grab at the actual hit on the item, not a floor-plane raycast:
        // from a low camera a grab above the horizon never reaches y=0,
        // which used to fall through to OrbitControls and orbit instead.
        event.stopPropagation();
        onDragStart(
          item,
          { x: event.point.x, y: event.point.z },
          { x: event.clientX, y: event.clientY },
          event.point.y,
        );
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {body}
    </group>
  );
}

/** Warm key light from the window side, aimed at the room center. */
function KeyLight({ center }: { center: [number, number, number] }) {
  const lightRef = useRef<DirectionalLight | null>(null);
  const target = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    target.position.set(...center);
    if (lightRef.current) lightRef.current.target = target;
  }, [center, target]);
  return (
    <>
      <directionalLight
        ref={lightRef}
        position={[center[0] + 3.5, 7, center[2] - 6.5]}
        color="#ffe9c4"
        intensity={1.25}
      />
      <primitive object={target} />
    </>
  );
}

/** Host top-surface height per stacked rider of one room's furniture. */
function stackTopsOf(furniture: FurnitureItem[]): Map<string, number> {
  const byId = new Map(furniture.map((item) => [item.id, item]));
  const tops = new Map<string, number>();
  for (const item of furniture) {
    if (!item.stack) continue;
    const host = byId.get(item.stack.hostId);
    if (host) tops.set(item.id, stackSurfaceHeight(host));
  }
  return tops;
}

/** One room of the floor: platform, cutaway walls, furniture bodies. */
function RoomLayer({
  room,
  seamData,
  selectedId,
  onSelectItem,
  onDragStart,
}: {
  room: Room;
  /** The room's shared-wall data (portal cuts + half-thickness seams). */
  seamData?: RoomSeamData;
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onDragStart: (
    item: FurnitureItem,
    grabPoint: Point,
    screen: { x: number; y: number },
    grabHeight: number,
  ) => void;
}) {
  // Overlap warnings and stack lifts are per-room concerns: furniture
  // belongs to exactly one room, and containment keeps footprints inside it.
  const warnings = useMemo(
    () => overlappingFurnitureIds(room.furniture),
    [room.furniture],
  );
  const stackTops = useMemo(
    () => stackTopsOf(room.furniture),
    [room.furniture],
  );
  return (
    <group>
      <Platform outline={room.outline} />
      <Walls room={room} seamData={seamData} />
      {room.furniture.map((item) => (
        <FurnitureMesh
          key={item.id}
          item={item}
          stackTop={stackTops.get(item.id)}
          selected={item.id === selectedId}
          warning={warnings.has(item.id)}
          onSelect={onSelectItem}
          onDragStart={onDragStart}
        />
      ))}
    </group>
  );
}

export interface RoomSceneProps {
  /** Every room of the floor, all drawn; "which room" is derived per item. */
  rooms: Room[];
  selectedId: string | null;
  unit: Unit;
  /** Snap toggle: off means free furniture moves (no flush/quantize). */
  snapEnabled: boolean;
  onSelectItem: (id: string) => void;
  /** Live update during a move drag (already snapped; wall items carry
   * mount). `targetRoomId` set and different from the item's current room
   * reparents it there — the drag crossed a seam. */
  onMoveItem: (
    id: string,
    update: FurnitureUpdate,
    targetRoomId?: string,
  ) => void;
  /** A move drag started/ended — the canvas locks orbit while it runs. */
  onMoveActiveChange: (active: boolean) => void;
}

export function RoomScene({
  rooms,
  selectedId,
  unit,
  snapEnabled,
  onSelectItem,
  onMoveItem,
  onMoveActiveChange,
}: RoomSceneProps) {
  // Lights aim at the whole floor's center, so a two-room flat reads as one
  // warmly lit model rather than per-room hotspots.
  const bounds = useMemo(() => floorBounds({ rooms }), [rooms]);
  // Shared walls + portal cuts, derived from the outlines every render pass
  // (never stored): each room draws its half of a party wall and cuts gaps
  // for the neighbor's doors/windows on it.
  const seamData = useMemo(() => floorSeamData(rooms), [rooms]);
  const center: [number, number, number] = bounds
    ? [(bounds.min.x + bounds.max.x) / 2, 0, (bounds.min.y + bounds.max.y) / 2]
    : [0, 0, 0];
  // Selection and drags are floor-wide; the owning room is derived from the
  // item id, and a drag crossing a seam reparents the item (M5).
  const selectedRoom = selectedId
    ? rooms.find((room) =>
        room.furniture.some((item) => item.id === selectedId),
      )
    : undefined;
  const selectedItem =
    selectedRoom?.furniture.find((item) => item.id === selectedId) ?? null;
  const selectedStackTop = useMemo(
    () =>
      selectedRoom
        ? stackTopsOf(selectedRoom.furniture)
        : new Map<string, number>(),
    [selectedRoom],
  );

  const { drag, beginDrag, endDrag } = useMoveDrag(onMoveActiveChange);
  return (
    <group>
      <ambientLight color="#fff2de" intensity={1.15} />
      <KeyLight center={center} />
      {/* Cool fill from the open side so hidden-wall views don't go flat. */}
      <directionalLight
        position={[center[0] - 6, 5, center[2] + 7]}
        color="#e8eef7"
        intensity={0.45}
      />
      {bounds && <FloorContactShadow bounds={bounds} />}
      {rooms.map((room) => (
        <RoomLayer
          key={room.id}
          room={room}
          seamData={seamData.get(room.id)}
          selectedId={selectedId}
          onSelectItem={onSelectItem}
          onDragStart={(item, grabPoint, screen, grabHeight) =>
            beginDrag(item, room.id, grabPoint, screen, grabHeight)
          }
        />
      ))}
      {selectedItem && (
        <SelectionChip
          item={selectedItem}
          // Mounted items hang up the wall and riders stand on furniture;
          // anchor the chip above the elevated body instead of the default
          // floor-relative top.
          anchor={
            selectedItem.mount
              ? [
                  selectedItem.position.x,
                  selectedItem.mount.elevation +
                    selectedItem.footprint.height / 2 +
                    0.14,
                  selectedItem.position.y,
                ]
              : selectedStackTop.has(selectedItem.id)
                ? [
                    selectedItem.position.x,
                    (selectedStackTop.get(selectedItem.id) ?? 0) +
                      selectedItem.footprint.height +
                      0.14,
                    selectedItem.position.y,
                  ]
                : undefined
          }
        />
      )}
      {drag && (
        <MoveDragSession
          rooms={rooms}
          drag={drag}
          unit={unit}
          snapEnabled={snapEnabled}
          onMove={(update, targetRoomId) =>
            onMoveItem(drag.id, update, targetRoomId)
          }
          onEnd={endDrag}
        />
      )}
    </group>
  );
}
