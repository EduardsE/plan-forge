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
  MeshBasicMaterial,
  Object3D,
  Path,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from "three";
import { ModelBody } from "#/components/model-body";
import {
  CLICK_SLOP_PX,
  MoveDragSession,
  useMoveDrag,
} from "#/components/move-drag";
import { RoomOpenings } from "#/components/room-openings";
import { SelectionChip } from "#/components/selection-chip";
import { overlappingFurnitureIds } from "#/lib/collision";
import {
  furnitureBaseColor,
  furnitureParts,
  type PartShape,
  partHullScale,
  partScale,
} from "#/lib/furniture-parts";
import { LIGHTING, type TimeOfDay } from "#/lib/lighting";
import type {
  Bounds,
  DerivedRoom,
  Floor,
  FurnitureItem,
  FurnitureUpdate,
  Point,
} from "#/lib/model";
import {
  allFurnitureOf,
  floorBounds,
  stackSurfaceHeight,
  wallHeightOf,
} from "#/lib/model";
import { modelForCatalogId } from "#/lib/model/models";
import {
  buildEdgeSolids,
  type NodePost,
  nodePosts,
  SLAB_THICKNESS,
  STUB_WALL_HEIGHT,
  stubSpans,
  WALL_THICKNESS,
  type WallSolid,
} from "#/lib/room-scene";
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
/** Doorway threshold over a back-to-back seam's slab strip (plank-toned). */
const THRESHOLD_COLOR = PLANK_COLORS[1];
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
 * Invisible occluder for the world-fixed sun: draws nothing (and leaves the
 * depth buffer alone) yet still casts into the shadow map, because the shadow
 * pass only skips `visible: false` objects. Walls the dollhouse cutaway drops
 * keep a proxy in this material, so the room's lighting never changes with
 * the orbit — only what's drawn does.
 */
const shadowOnlyMaterial = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
});

/**
 * Shadow-only variant for the ceiling lid: the shadow pass flips FrontSide
 * to BackSide, which would cull a flat upward-facing plane from an overhead
 * sun, so the lid must render both faces into the shadow map.
 */
const ceilingShadowMaterial = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  side: DoubleSide,
});

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
        receiveShadow
      >
        <meshLambertMaterial attach="material-0" map={plank} />
        <meshLambertMaterial attach="material-1" color={SLAB_SIDE_COLOR} />
      </mesh>
    </group>
  );
}

/**
 * Invisible lid at wall-top height: the roofless dollhouse would let the
 * world-fixed sun pour straight into the interior, so this proxy casts into
 * the shadow map (never the camera) and direct sun only reaches the room
 * through its door and window holes.
 */
function CeilingShadowProxy({
  outline,
  height,
}: {
  outline: Point[];
  height: number;
}) {
  const geometry = useMemo(() => {
    if (outline.length < 3) return null;
    return new ShapeGeometry(planShape(outline));
  }, [outline]);

  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      material={ceilingShadowMaterial}
      rotation-x={-Math.PI / 2}
      position-y={height}
      raycast={noRaycast}
      castShadow
    />
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

/** The frame/muntin bar layout of one window hole (wall-local): [key, x, y,
 * width, height, depth]. Shared by the visible dressing and the shadow
 * proxy, so the muntin cross in the sun patch matches the drawn frame. */
function windowBars(
  hole: WallSolid["holes"][number],
): Array<[string, number, number, number, number, number]> {
  const f = WINDOW_FRAME_SIZE;
  const cx = hole.start + hole.width / 2;
  const cy = (hole.bottom + hole.top) / 2;
  const height = hole.top - hole.bottom;
  const frameDepth = WALL_THICKNESS + 0.02;
  // Frame bars sit inside the hole, border-box style; the muntin cross
  // stays within the wall thickness.
  return [
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
  return (
    <group>
      <mesh position={[cx, cy, z]} raycast={noRaycast}>
        <planeGeometry args={[hole.width - f, height - f]} />
        <meshBasicMaterial map={pane} side={DoubleSide} />
      </mesh>
      {/* Shadows come from the wall's always-on proxy bars, not from here —
          this dressing vanishes with the cutaway, and the sun patch on the
          floor must not. */}
      {windowBars(hole).map(([id, x, y, w, h, d]) => (
        <mesh key={id} position={[x, y, z]} raycast={noRaycast}>
          <boxGeometry args={[w, h, d]} />
          <meshLambertMaterial color={WINDOW_FRAME_COLOR} />
        </mesh>
      ))}
      {/* A tight warm glow on the frame/reveal — kept local (short distance) so
          it dresses the window without flooding the floor and flattening the
          sun patch that rakes in through the same hole. */}
      <pointLight
        position={[cx, cy, z]}
        color="#ffd9a0"
        intensity={2.4}
        distance={4.5}
        decay={2}
      />
    </group>
  );
}

/**
 * The two per-frame display groups of one wall: full-height and cut-down
 * stub. The frame loop writes `visible` straight onto these — one solid per
 * edge, so a shared wall has a single pair (no more seam/plain split).
 */
interface WallDisplay {
  full: Group | null;
  stub: Group | null;
}

function WallMesh({
  solid,
  display,
}: {
  solid: WallSolid;
  /** Owned by `Walls`; the group refs below register themselves into it. */
  display: WallDisplay;
}) {
  const wall = wallTexture(solid.height);
  // One extrusion for the whole edge, holes cut for every opening on it, plus
  // its cut-down stub (door holes widened into full gaps, windows left as
  // solid stub — `stubSpans`). The stub reuses the wall texture for baseboard.
  const geometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(solid.length, 0);
    shape.lineTo(solid.length, solid.height);
    shape.lineTo(0, solid.height);
    shape.closePath();
    for (const hole of solid.holes) {
      const path = new Path();
      path.moveTo(hole.start, hole.bottom);
      path.lineTo(hole.start + hole.width, hole.bottom);
      path.lineTo(hole.start + hole.width, hole.top);
      path.lineTo(hole.start, hole.top);
      path.closePath();
      shape.holes.push(path);
    }
    const full = new ExtrudeGeometry(shape, {
      depth: WALL_THICKNESS,
      bevelEnabled: false,
    });
    const stubShapes = stubSpans(solid).map((span) => {
      const stub = new Shape();
      stub.moveTo(span.start, 0);
      stub.lineTo(span.end, 0);
      stub.lineTo(span.end, STUB_WALL_HEIGHT);
      stub.lineTo(span.start, STUB_WALL_HEIGHT);
      stub.closePath();
      return stub;
    });
    const stub =
      stubShapes.length > 0
        ? new ExtrudeGeometry(stubShapes, {
            depth: WALL_THICKNESS,
            bevelEnabled: false,
          })
        : null;
    return { full, stub };
  }, [solid]);

  const rotationY = Math.atan2(-solid.dir.y, solid.dir.x);
  // The extrusion runs local z 0..WALL_THICKNESS; shift it so the wall body
  // straddles the edge line (± half thickness), independent of `outward`.
  const zOffset = -WALL_THICKNESS / 2;
  const wallMesh = (geom: ExtrudeGeometry) => (
    // Receive so interior faces catch furniture and neighbour-wall shadows.
    // Sun *casting* lives on the shadow proxy below, never here — the display
    // meshes come and go with the cutaway, and the light must not.
    <mesh
      geometry={geom}
      position-z={zOffset}
      raycast={noRaycast}
      receiveShadow
    >
      <meshLambertMaterial attach="material-0" map={wall} />
      <meshLambertMaterial attach="material-1" color={WALL_EDGE_COLOR} />
    </mesh>
  );
  const windows = solid.holes.filter((hole) => hole.kind === "window");
  // A back-to-back doorway: the wall (centered on the line) covers the bare
  // strip between the two rooms' inset slabs, but the door hole cuts it, so
  // bridge that stretch at floor level. Only two-face edges have the strip.
  const thresholds =
    solid.faces === 2 ? solid.holes.filter((hole) => hole.kind === "door") : [];

  return (
    <group position={[solid.start.x, 0, solid.start.y]} rotation-y={rotationY}>
      {/* Invisible occluder: the full wall (holes and all) plus its window
          frames, always in the shadow pass whatever the cutaway shows. The
          world-fixed sun's window patches stay glued to the floor while the
          camera orbits. */}
      <group>
        <mesh
          geometry={geometry.full}
          material={shadowOnlyMaterial}
          position-z={zOffset}
          raycast={noRaycast}
          castShadow
        />
        {windows.map((hole) =>
          windowBars(hole).map(([id, x, y, w, h, d]) => (
            <mesh
              key={`${hole.id}-${id}`}
              material={shadowOnlyMaterial}
              position={[x, y, 0]}
              raycast={noRaycast}
              castShadow
            >
              <boxGeometry args={[w, h, d]} />
            </mesh>
          )),
        )}
      </group>
      <group
        ref={(group) => {
          display.full = group;
        }}
      >
        {wallMesh(geometry.full)}
        {windows.map((hole) => (
          <WindowDressing key={hole.id} hole={hole} zCenter={0} />
        ))}
      </group>
      <group
        ref={(group) => {
          display.stub = group;
        }}
        visible={false}
      >
        {geometry.stub && wallMesh(geometry.stub)}
      </group>
      {thresholds.map((hole) => (
        <mesh
          key={hole.id}
          position={[
            hole.start + hole.width / 2,
            FLOOR_TOP - SLAB_THICKNESS / 2,
            0,
          ]}
          raycast={noRaycast}
        >
          <boxGeometry args={[hole.width, SLAB_THICKNESS, WALL_THICKNESS]} />
          <meshLambertMaterial color={THRESHOLD_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Every wall of the floor (one solid per edge) plus filler posts at the
 * graph's corner/junction nodes, with the per-frame dollhouse cutaway: a
 * two-face wall always stubs while orbiting (it always occludes one of its
 * rooms), a 0/1-face wall stubs only when it faces the camera.
 */
function Walls({ solids, posts }: { solids: WallSolid[]; posts: NodePost[] }) {
  const displays = useMemo<WallDisplay[]>(
    () => solids.map(() => ({ full: null, stub: null })),
    [solids],
  );
  /** Solid index → array position, for a post's incident-edge tall-check. */
  const solidPosition = useMemo(
    () => new Map(solids.map((solid, i) => [solid.index, i])),
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
      const toCamY = camera.position.y - solid.height / 2;
      const toCamZ = camera.position.z - midZ;
      const distance = Math.hypot(toCamX, toCamY, toCamZ) || 1;
      const facing =
        (toCamX * solid.outward.x + toCamZ * solid.outward.y) / distance;
      // Straight-down (plan) views keep every wall full. Otherwise a two-face
      // wall always cuts down; a 0/1-face wall cuts down when it faces us.
      const planLike = toCamY / distance > PLAN_UPNESS;
      const full =
        planLike || (solid.faces < 2 && facing < HIDE_FACING_THRESHOLD);
      const display = displays[i];
      if (display.full) display.full.visible = full;
      if (display.stub) display.stub.visible = !full;
      tall[i] = full;
    }
    for (const [i, post] of posts.entries()) {
      // A post stands full while any wall meeting it still stands full.
      const postTall = post.edgeIndices.some((index) => {
        const p = solidPosition.get(index);
        return p !== undefined && tall[p];
      });
      const full = postFullRefs.current[i];
      const stub = postStubRefs.current[i];
      if (full) full.visible = postTall;
      if (stub) stub.visible = !postTall;
    }
  });

  return (
    <group>
      {solids.map((solid, i) => (
        <WallMesh key={solid.edgeId} solid={solid} display={displays[i]} />
      ))}
      {posts.map((post, i) => (
        <group key={post.nodeId} position={[post.center.x, 0, post.center.y]}>
          {/* Shadow proxy, like the walls' — a cut-down post must not open a
              slit of sunlight at the corner. */}
          <mesh
            material={shadowOnlyMaterial}
            position-y={post.height / 2}
            raycast={noRaycast}
            castShadow
          >
            <boxGeometry args={[WALL_THICKNESS, post.height, WALL_THICKNESS]} />
          </mesh>
          <mesh
            ref={(mesh) => {
              postFullRefs.current[i] = mesh;
            }}
            position-y={post.height / 2}
            raycast={noRaycast}
            receiveShadow
          >
            <boxGeometry args={[WALL_THICKNESS, post.height, WALL_THICKNESS]} />
            <meshLambertMaterial color={WALL_EDGE_COLOR} />
          </mesh>
          <mesh
            ref={(mesh) => {
              postStubRefs.current[i] = mesh;
            }}
            position-y={STUB_WALL_HEIGHT / 2}
            raycast={noRaycast}
            visible={false}
            receiveShadow
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
  const partsMeshes = (
    <>
      {parts.map((part, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are a static list per catalog id.
          key={i}
          position={part.position}
          rotation={part.rotation ?? [0, 0, 0]}
          scale={partScale(part.shape)}
          castShadow
          receiveShadow
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
    </>
  );
  // Real-mesh coverage: manifest hit renders the prepared GLB, with the
  // primitives fragment as its loading/failure fallback; a miss renders the
  // primitives directly — byte-for-byte the old path.
  const entry = modelForCatalogId(item.catalogId);
  const baseColor = item.colorway ?? furnitureBaseColor(item.catalogId);
  const bodyMeshes = entry ? (
    <ModelBody
      entry={entry}
      footprint={item.footprint}
      color={warning ? warnColor(baseColor) : baseColor}
      active={active}
      hullColor={SELECTION_COLOR}
      hullOpacity={selected ? 0.85 : 0.4}
      fallback={partsMeshes}
    />
  ) : (
    partsMeshes
  );
  const body = (
    <>
      {!item.mount && !isRug && shadow}
      <group position-y={lift}>{bodyMeshes}</group>
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

/**
 * The shadow-casting sun, fixed in world space: it sits outside the floor's
 * most-glazed wall (`sunAnchorAzimuth`), swung by the preset's rake, and does
 * not move with the camera — the room and its light hold still while the view
 * orbits, and the walls' shadow proxies keep the window patches alive even
 * when the cutaway drops the glazed wall itself. Elevation, distance and the
 * shadow frustum are sized from the room's bounding radius so the whole model
 * stays inside the shadow map.
 */
function SunLight({
  center,
  radius,
  color,
  intensity,
  elevationDeg,
  azimuth,
}: {
  center: [number, number, number];
  /** Half the floor's bounding diagonal, plus margin. */
  radius: number;
  /** Preset-driven sun colour, brightness and elevation (see #/lib/lighting). */
  color: string;
  intensity: number;
  elevationDeg: number;
  /** World azimuth in radians (`atan2(z, x)`): glazing anchor + preset rake. */
  azimuth: number;
}) {
  const lightRef = useRef<DirectionalLight | null>(null);
  const target = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    target.position.set(...center);
    if (lightRef.current) lightRef.current.target = target;
  }, [center, target]);

  const distance = Math.max(radius * 2.4, 9);
  const elevation = MathUtils.degToRad(elevationDeg);
  const ground = Math.cos(elevation) * distance;

  return (
    <>
      <directionalLight
        ref={lightRef}
        position={[
          center[0] + Math.cos(azimuth) * ground,
          center[1] + Math.sin(elevation) * distance,
          center[2] + Math.sin(azimuth) * ground,
        ]}
        color={color}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        // Negative bias + normalBias keep acne and light-leaks out of the thin
        // wall apertures without peter-panning the patch edges.
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={0.5}
        shadow-camera-far={distance + radius * 2}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
      />
      <primitive object={target} />
    </>
  );
}

/** Warm key light from the window side, aimed at the room center. */
function KeyLight({
  center,
  intensity,
}: {
  center: [number, number, number];
  intensity: number;
}) {
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
        intensity={intensity}
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

/** A bucket of furniture bodies (a room's, or the unassigned/open-canvas
 * items) with its own overlap-warning + stack-lift computation. Furniture is
 * floor-level now, so overlaps are scoped to the bucket (items in different
 * buckets can't overlap — containment keeps them apart at the walls). */
function FurnitureBucket({
  furniture,
  selectedId,
  onSelectItem,
  onDragStart,
}: {
  furniture: FurnitureItem[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onDragStart: (
    item: FurnitureItem,
    grabPoint: Point,
    screen: { x: number; y: number },
    grabHeight: number,
  ) => void;
}) {
  const warnings = useMemo(
    () => overlappingFurnitureIds(furniture),
    [furniture],
  );
  const stackTops = useMemo(() => stackTopsOf(furniture), [furniture]);
  return (
    <group>
      {furniture.map((item) => (
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
  /** Every derived room of the floor; walls are built from the graph edges. */
  rooms: DerivedRoom[];
  /** Furniture that lands in no room (dangling / open-canvas) — rendered and
   * editable like any other, its membership just reads "—". */
  unassignedFurniture: FurnitureItem[];
  /** The graph floor — walls are one solid per edge; mounts re-anchor to it. */
  floor: Floor;
  selectedId: string | null;
  /** Opening selection — doors/windows pick and drag in this lens too. */
  selectedOpeningId: string | null;
  unit: Unit;
  /** Snap toggle: off means free furniture moves (no flush/quantize). */
  snapEnabled: boolean;
  /** The lighting preset driving the sun, ambient and fill (3D lens). */
  timeOfDay: TimeOfDay;
  /** World sun-anchor azimuth in degrees — the route owns the dial override
   * vs automatic (`sunAnchorAzimuth`) choice. */
  sunAnchorDeg: number;
  onSelectItem: (id: string) => void;
  /** Live update during a move drag (already snapped; wall items carry
   * mount). Furniture is floor-level — the write-back re-partitions the item
   * into whichever room now contains it (or the unassigned bucket). */
  onMoveItem: (id: string, update: FurnitureUpdate) => void;
  /** A move drag started/ended — the canvas locks orbit while it runs. */
  onMoveActiveChange: (active: boolean) => void;
  onSelectOpening: (id: string) => void;
  /** One combined opening-drag preview: along-wall offset + (windows) the
   * raw whole-hole bottom, applied to one floor by the canvas. */
  onDragOpening: (
    id: string,
    offset: number | null,
    bottom: number | null,
  ) => void;
}

export function RoomScene({
  rooms,
  unassignedFurniture,
  floor,
  selectedId,
  selectedOpeningId,
  unit,
  snapEnabled,
  timeOfDay,
  sunAnchorDeg,
  onSelectItem,
  onMoveItem,
  onMoveActiveChange,
  onSelectOpening,
  onDragOpening,
}: RoomSceneProps) {
  // Lights aim at the whole floor's center, so a two-room flat reads as one
  // warmly lit model rather than per-room hotspots.
  const bounds = useMemo(() => floorBounds(rooms), [rooms]);
  // One wall solid per graph edge (dangling walls included), plus filler
  // posts at the corner/junction nodes — all floor-level now, drawn once.
  const solids = useMemo(() => buildEdgeSolids(floor, rooms), [floor, rooms]);
  const posts = useMemo(() => nodePosts(floor, solids), [floor, solids]);
  // Per-edge wall heights: the ceiling clamp for free-vertical mount drags.
  const edgeHeights = useMemo(
    () => new Map(solids.map((solid) => [solid.edgeId, solid.height])),
    [solids],
  );
  const center: [number, number, number] = bounds
    ? [(bounds.min.x + bounds.max.x) / 2, 0, (bounds.min.y + bounds.max.y) / 2]
    : [0, 0, 0];
  // Half the floor's bounding diagonal (+1 m margin) — the square shadow
  // frustum this sizes wraps the room at any sun azimuth.
  const sunRadius = bounds
    ? Math.hypot(bounds.width, bounds.height) / 2 + 1
    : 6;
  // Selection and drags are floor-wide; the item is found across every room
  // plus the unassigned bucket, with mount/stack positions already derived.
  const allFurniture = useMemo(
    () => allFurnitureOf(rooms, unassignedFurniture),
    [rooms, unassignedFurniture],
  );
  const selectedItem =
    allFurniture.find((item) => item.id === selectedId) ?? null;
  const selectedStackTop = useMemo(
    () => stackTopsOf(allFurniture),
    [allFurniture],
  );

  const { drag, beginDrag, endDrag } = useMoveDrag(onMoveActiveChange);
  const lighting = LIGHTING[timeOfDay];
  return (
    <group>
      {/* The time-of-day preset drives all four lights. Ambient + key + fill sit
          well below white so the shadowed floor keeps headroom — that headroom
          is what lets the sun patch read as genuinely brighter under the flat
          (untone-mapped) renderer. */}
      <ambientLight
        color={lighting.ambient.color}
        intensity={lighting.ambient.intensity}
      />
      <KeyLight center={center} intensity={lighting.key} />
      {/* Cool fill from the open side so hidden-wall views don't go flat. */}
      <directionalLight
        position={[center[0] - 6, 5, center[2] + 7]}
        color="#e8eef7"
        intensity={lighting.fill}
      />
      <SunLight
        center={center}
        radius={sunRadius}
        color={lighting.sun.color}
        intensity={lighting.sun.intensity}
        elevationDeg={lighting.sun.elevationDeg}
        azimuth={MathUtils.degToRad(sunAnchorDeg + lighting.sun.rakeDeg)}
      />
      {bounds && <FloorContactShadow bounds={bounds} />}
      <Walls solids={solids} posts={posts} />
      <RoomOpenings
        solids={solids}
        selectedId={selectedOpeningId}
        unit={unit}
        snapEnabled={snapEnabled}
        onSelect={onSelectOpening}
        onDrag={onDragOpening}
        onDragActiveChange={onMoveActiveChange}
      />
      {rooms.map((room) => (
        <group key={room.id}>
          <Platform outline={room.outline} />
          <CeilingShadowProxy
            outline={room.outline}
            height={wallHeightOf(room)}
          />
          <FurnitureBucket
            furniture={room.furniture}
            selectedId={selectedId}
            onSelectItem={onSelectItem}
            onDragStart={beginDrag}
          />
        </group>
      ))}
      {unassignedFurniture.length > 0 && (
        <FurnitureBucket
          furniture={unassignedFurniture}
          selectedId={selectedId}
          onSelectItem={onSelectItem}
          onDragStart={beginDrag}
        />
      )}
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
          furniture={allFurniture}
          floor={floor}
          drag={drag}
          unit={unit}
          snapEnabled={snapEnabled}
          freeVerticalMounts
          edgeHeights={edgeHeights}
          onMove={(update) => onMoveItem(drag.id, update)}
          onEnd={endDrag}
        />
      )}
    </group>
  );
}
