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
  ShaderMaterial,
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
import { CHIP_CLEARANCE, SelectionChip } from "#/components/selection-chip";
import { StairMesh } from "#/components/stair-mesh";
import { overlappingFurnitureIds } from "#/lib/collision";
import {
  furnitureBaseColor,
  furnitureParts,
  type PartShape,
  partHullScale,
  partScale,
} from "#/lib/furniture-parts";
import { LIGHTING, type LightingPreset, type TimeOfDay } from "#/lib/lighting";
import type {
  Bounds,
  DerivedFloor,
  DerivedRoom,
  Floor,
  FurnitureItem,
  FurnitureUpdate,
  Point,
  Stair,
} from "#/lib/model";
import {
  allFurnitureOf,
  floorBounds,
  pointInOutline,
  stackSurfaceHeight,
  unionBounds,
  wallHeightOf,
} from "#/lib/model";
import { modelForCatalogId } from "#/lib/model/models";
import type { Obstacle } from "#/lib/place";
import {
  buildEdgeSolids,
  ceilingSlabShape,
  type NodePost,
  nodePosts,
  SLAB_THICKNESS,
  STUB_WALL_HEIGHT,
  sillBox,
  stubSpans,
  type WallSolid,
  WINDOW_FRAME_SIZE,
  wallStandsFull,
  wallZCenter,
  wallZOffset,
  windowBars,
  windowUnitZ,
} from "#/lib/room-scene";
import { stairPolygon, stairRun } from "#/lib/stairs";
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
const SILL_WOOD_COLOR = "#b98a5f";

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
 * Window glass: the hour's sky as a vertical gradient (horizon at the sill,
 * zenith at the head) plus a Fresnel sheen that brightens toward glancing
 * angles — the angle-dependence is what makes the pane read as glass rather
 * than a backlit card while the camera orbits. Unlit on purpose, like the
 * old glow texture: the pane is the light source, not a lit surface.
 */
const PANE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
	vUv = uv;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vNormal = normalize(normalMatrix * normal);
	vView = normalize(-mv.xyz);
	gl_Position = projectionMatrix * mv;
}
`;
const PANE_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
	vec3 sky = mix(horizon, zenith, vUv.y);
	float grazing = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
	float fresnel = pow(grazing, 3.0);
	gl_FragColor = vec4(mix(sky, vec3(1.0), fresnel * 0.55), 1.0);
	#include <colorspace_fragment>
}
`;

/** One shared pane material; `WindowDressing` syncs its sky uniforms to the
 * active preset (idempotent — every window shows the same hour). */
const paneMaterial = new ShaderMaterial({
  uniforms: {
    zenith: { value: new Color("#9cc6ee") },
    horizon: { value: new Color("#e8f3fb") },
  },
  vertexShader: PANE_VERTEX,
  fragmentShader: PANE_FRAGMENT,
  side: DoubleSide,
});

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

  // Radial alpha falloff shared by every soft blob shadow.
  const blob = makeTexture(256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });

  textureCache = { plank, blob };
  return textureCache;
}

/** Stable empty fallbacks — a stairless floor/room hits these instead of
 * minting a fresh `[]`/`Map` every render. */
const EMPTY_HOLES: Point[][] = [];
const EMPTY_VOID_MAP: Map<string, Point[][]> = new Map();

/**
 * The void polygons `stairs` cut (already run-sized via `stairRun` for the
 * storey they climb from), grouped by whichever of `rooms`' outlines
 * contains each stair's position — the ceiling/platform hole belongs to
 * that one room, not every room sharing the floor. A stair whose position
 * falls in no room (the dead band, the open canvas) cuts no hole: there is
 * no single outline to subtract it from.
 */
function stairVoidsByRoom(
  stairs: Stair[],
  run: number,
  rooms: DerivedRoom[],
): Map<string, Point[][]> {
  if (stairs.length === 0) return EMPTY_VOID_MAP;
  const byRoom = new Map<string, Point[][]>();
  for (const stair of stairs) {
    const room = rooms.find((r) => pointInOutline(r.outline, stair.position));
    if (!room) continue;
    const poly = stairPolygon(stair, run);
    const list = byRoom.get(room.id);
    if (list) list.push(poly);
    else byRoom.set(room.id, [poly]);
  }
  return byRoom;
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

/**
 * Floor slab: plank top, navy skirt. `holes` cuts a stair void from the floor
 * below straight through the platform (a stair-bearing entry passes its
 * stairs' polygons into the *entry above's* Platform, keyed by whichever of
 * that entry's rooms the hole falls in) — the same Shape-holes path
 * `CeilingSlab` uses (`ceilingSlabShape`).
 */
function Platform({
  outline,
  holes = EMPTY_HOLES,
}: {
  outline: Point[];
  holes?: Point[][];
}) {
  const { plank } = sharedTextures();
  const geometry = useMemo(() => {
    const slab = ceilingSlabShape(outline, holes);
    if (!slab) return null;
    return new ExtrudeGeometry(slab.shape, {
      depth: SLAB_THICKNESS,
      bevelEnabled: false,
    });
  }, [outline, holes]);

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

/** Plaster-white ceiling slab, for a capped lower storey. */
const CEILING_COLOR = "#f5f2ea";

/**
 * A capped lower storey's ceiling: the room's interior outline extruded
 * `SLAB_THICKNESS` up from the wall top, solid and opaque — unlike the
 * roofless active floor's shadow-only proxy above, this is what the storey
 * above actually stands on, and it blocks the world-fixed sun from pouring
 * into the room below through wherever the storey above's cutaway opens up.
 */
function CeilingSlab({
  outline,
  wallHeight,
  holes = EMPTY_HOLES,
}: {
  outline: Point[];
  wallHeight: number;
  /** Void polygons this storey's own stairs cut into its ceiling. */
  holes?: Point[][];
}) {
  const geometry = useMemo(() => {
    const slab = ceilingSlabShape(outline, holes);
    if (!slab) return null;
    return new ExtrudeGeometry(slab.shape, {
      depth: SLAB_THICKNESS,
      bevelEnabled: false,
    });
  }, [outline, holes]);

  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      position-y={wallHeight}
      raycast={noRaycast}
      receiveShadow
      castShadow
    >
      {/* The storey above's Platform occupies this same slab volume (its
			    elevation is wallHeight + SLAB_THICKNESS), so their side faces are
			    exactly coplanar; the offset pushes this slab behind in the depth
			    buffer so the platform's navy skirt wins instead of z-fighting. */}
      <meshStandardMaterial
        color={CEILING_COLOR}
        roughness={0.92}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
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

/** Frame, muntin cross and sky-filled pane for one window hole (wall-local). */
function WindowDressing({
  solid,
  hole,
  lighting,
}: {
  solid: WallSolid;
  hole: WallSolid["holes"][number];
  lighting: LightingPreset;
}) {
  const f = WINDOW_FRAME_SIZE;
  const cx = hole.start + hole.width / 2;
  const cy = (hole.bottom + hole.top) / 2;
  const height = hole.top - hole.bottom;
  useLayoutEffect(() => {
    (paneMaterial.uniforms.zenith?.value as Color).set(lighting.sky.zenith);
    (paneMaterial.uniforms.horizon?.value as Color).set(lighting.sky.horizon);
  }, [lighting]);
  // The unit hugs the exterior face (outer windowUnitDepth of the wall); on a
  // default wall that's the centered placement, unchanged.
  const z = windowUnitZ(solid, hole);
  return (
    <group>
      <mesh position={[cx, cy, z]} material={paneMaterial} raycast={noRaycast}>
        <planeGeometry args={[hole.width - f, height - f]} />
      </mesh>
      {/* Shadows come from the wall's always-on proxy bars, not from here —
          this dressing vanishes with the cutaway, and the sun patch on the
          floor must not. */}
      {windowBars(solid, hole).map(([id, x, y, w, h, d]) => (
        <mesh key={id} position={[x, y, z]} raycast={noRaycast}>
          <boxGeometry args={[w, h, d]} />
          <meshLambertMaterial color={WINDOW_FRAME_COLOR} />
        </mesh>
      ))}
      {(() => {
        const sill = sillBox(solid, hole);
        if (!sill) return null;
        return (
          <mesh position={[sill.x, sill.y, sill.z]} raycast={noRaycast}>
            <boxGeometry args={[sill.width, sill.height, sill.depth]} />
            {/* The board's top face is coplanar with the hole's reveal ledge
                (and, at overhang 0, its front face with the wall face); bias
                the depth so the board wins those ties instead of shimmering. */}
            <meshLambertMaterial
              color={
                sill.material === "wood" ? SILL_WOOD_COLOR : WINDOW_FRAME_COLOR
              }
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </mesh>
        );
      })()}
      {/* A tight glow on the frame/reveal, tinted to the hour's sun — kept
          local (short distance) so it dresses the window without flooding the
          floor and flattening the sun patch raking in through the same hole. */}
      <pointLight
        position={[cx, cy, z]}
        color={lighting.sun.color}
        intensity={2.0}
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
  lighting,
  selected,
  onSelectWall,
}: {
  solid: WallSolid;
  /** Owned by `Walls`; the group refs below register themselves into it. */
  display: WallDisplay;
  lighting: LightingPreset;
  selected: boolean;
  onSelectWall: (edgeId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
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
      depth: solid.thickness,
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
            depth: solid.thickness,
            bevelEnabled: false,
          })
        : null;
    return { full, stub };
  }, [solid]);

  const rotationY = Math.atan2(-solid.dir.y, solid.dir.x);
  // The extrusion runs local z 0..solid.thickness; shift it so the wall body
  // sits at its outward-shifted band, independent of `outward`.
  const zOffset = wallZOffset(solid);
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
          windowBars(solid, hole).map(([id, x, y, w, h, d]) => (
            <mesh
              key={`${hole.id}-${id}`}
              material={shadowOnlyMaterial}
              position={[x, y, windowUnitZ(solid, hole)]}
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
          <WindowDressing
            key={hole.id}
            solid={solid}
            hole={hole}
            lighting={lighting}
          />
        ))}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element. */}
        <mesh
          geometry={geometry.full}
          position-z={zOffset}
          onClick={(event) => {
            if (event.delta > CLICK_SLOP_PX) return;
            // The cutaway may have swapped this group out this frame.
            if (display.full && !display.full.visible) return;
            event.stopPropagation();
            onSelectWall(solid.edgeId);
          }}
          onPointerOver={(event) => {
            // R3F hit-tests each mesh's own visibility, not its ancestors' —
            // the cutaway may have swapped this group out this frame, same
            // as the click guard above.
            if (display.full && !display.full.visible) return;
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {(hovered || selected) && (
          <mesh
            position={[solid.length / 2, solid.height / 2, wallZCenter(solid)]}
            raycast={noRaycast}
          >
            <boxGeometry
              args={[
                solid.length + 0.03,
                solid.height + 0.03,
                solid.thickness + 0.03,
              ]}
            />
            <meshBasicMaterial
              color={SELECTION_COLOR}
              transparent
              opacity={selected ? 0.25 : 0.12}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
      <group
        ref={(group) => {
          display.stub = group;
        }}
        visible={false}
      >
        {geometry.stub && wallMesh(geometry.stub)}
        {geometry.stub && (
          // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is an R3F scene node, not a DOM element.
          <mesh
            geometry={geometry.stub}
            position-z={zOffset}
            onClick={(event) => {
              if (event.delta > CLICK_SLOP_PX) return;
              if (display.stub && !display.stub.visible) return;
              event.stopPropagation();
              onSelectWall(solid.edgeId);
            }}
            onPointerOver={(event) => {
              if (display.stub && !display.stub.visible) return;
              event.stopPropagation();
              setHovered(true);
            }}
            onPointerOut={() => setHovered(false)}
          >
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
        {geometry.stub && (hovered || selected) && (
          <mesh
            position={[
              solid.length / 2,
              STUB_WALL_HEIGHT / 2,
              wallZCenter(solid),
            ]}
            raycast={noRaycast}
          >
            <boxGeometry
              args={[
                solid.length + 0.03,
                STUB_WALL_HEIGHT + 0.03,
                solid.thickness + 0.03,
              ]}
            />
            <meshBasicMaterial
              color={SELECTION_COLOR}
              transparent
              opacity={selected ? 0.25 : 0.12}
              depthWrite={false}
            />
          </mesh>
        )}
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
          <boxGeometry args={[hole.width, SLAB_THICKNESS, solid.thickness]} />
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
 * rooms), a 0/1-face wall stubs only when it faces the camera. Every storey
 * in the stack runs the cutaway — a capped lower floor peels open toward the
 * camera exactly like the active one, just under its ceiling slab.
 */
function Walls({
  solids,
  posts,
  lighting,
  selectedEdgeId,
  onSelectWall,
  elevation = 0,
}: {
  solids: WallSolid[];
  posts: NodePost[];
  lighting: LightingPreset;
  selectedEdgeId: string | null;
  onSelectWall: (edgeId: string) => void;
  /** This storey's slab-top height: the parent group lifts the walls there,
   * so the facing math must compare the camera against wall mid-height in
   * *world* y, not local. */
  elevation?: number;
}) {
  const displays = useMemo<WallDisplay[]>(
    () => solids.map(() => ({ full: null, stub: null })),
    [solids],
  );
  /** Solid index → array position, for a post's incident-edge tall-check. */
  const solidPosition = useMemo(
    () => new Map(solids.map((solid, i) => [solid.index, i])),
    [solids],
  );
  // Each post's polygon extruded to its own height and to the cutaway stub
  // height — shared between the shadow proxy and the display mesh below.
  const postGeometries = useMemo(
    () =>
      posts.map((post) => {
        const shape = planShape(post.corners);
        return {
          full: new ExtrudeGeometry(shape, {
            depth: post.height,
            bevelEnabled: false,
          }),
          stub: new ExtrudeGeometry(shape, {
            depth: STUB_WALL_HEIGHT,
            bevelEnabled: false,
          }),
        };
      }),
    [posts],
  );
  const postFullRefs = useRef<(Mesh | null)[]>([]);
  const postStubRefs = useRef<(Mesh | null)[]>([]);
  const tallRef = useRef<boolean[]>([]);

  useFrame(({ camera }) => {
    const tall = tallRef.current;
    // Camera in this storey's floor-local frame (walls stand at local y 0).
    const cam = {
      x: camera.position.x,
      y: camera.position.y - elevation,
      z: camera.position.z,
    };
    for (const [i, solid] of solids.entries()) {
      const full = wallStandsFull(solid, cam);
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
        <WallMesh
          key={solid.edgeId}
          solid={solid}
          display={displays[i]}
          lighting={lighting}
          selected={solid.edgeId === selectedEdgeId}
          onSelectWall={onSelectWall}
        />
      ))}
      {posts.map((post, i) => {
        const geom = postGeometries[i];
        return (
          <group key={post.nodeId}>
            {/* Shadow proxy, like the walls' — a cut-down post must not open
                a slit of sunlight at the corner. */}
            <mesh
              geometry={geom.full}
              material={shadowOnlyMaterial}
              rotation-x={-Math.PI / 2}
              raycast={noRaycast}
              castShadow
            />
            <mesh
              ref={(mesh) => {
                postFullRefs.current[i] = mesh;
              }}
              geometry={geom.full}
              rotation-x={-Math.PI / 2}
              raycast={noRaycast}
              receiveShadow
            >
              <meshLambertMaterial color={WALL_EDGE_COLOR} />
            </mesh>
            <mesh
              ref={(mesh) => {
                postStubRefs.current[i] = mesh;
              }}
              geometry={geom.stub}
              rotation-x={-Math.PI / 2}
              raycast={noRaycast}
              visible={false}
              receiveShadow
            >
              <meshLambertMaterial color={WALL_EDGE_COLOR} />
            </mesh>
          </group>
        );
      })}
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

/** One rendered storey of the 3D stack: a graph floor at its derived
 * elevation, with `active` marking the one storey that renders roofless
 * (shadow-only ceiling proxy) — every entry below it is capped by a solid
 * ceiling slab. All storeys share the live camera-facing wall cutaway. */
export interface FloorStackEntry {
  floor: Floor;
  derived: DerivedFloor;
  elevation: number;
  storeyHeight: number;
  active: boolean;
}

/** One storey's walls/openings/platform/furniture, positioned by its
 * elevation. `entry.active` switches the ceiling between today's roofless
 * shadow proxy and a capped lower storey's solid slab; the wall cutaway
 * runs on every storey either way. */
function FloorLayer({
  entry,
  belowFloor,
  belowStoreyHeight,
  lighting,
  selectedId,
  selectedOpeningId,
  selectedEdgeId,
  selectedStairId,
  unit,
  snapEnabled,
  onSelectItem,
  onDragStart,
  onSelectOpening,
  onDragOpening,
  onMoveActiveChange,
  onSelectWall,
  onSelectStair,
}: {
  entry: FloorStackEntry;
  /** The floor immediately below `entry` in the stack, or null for the
   * ground storey — its stairs cut a void into `entry`'s Platform. */
  belowFloor: Floor | null;
  /** `belowFloor`'s own storey height (its stairs' run size); ignored when
   * `belowFloor` is null. */
  belowStoreyHeight: number;
  lighting: LightingPreset;
  selectedId: string | null;
  selectedOpeningId: string | null;
  selectedEdgeId: string | null;
  /** Stair selection reaches across the whole stack — a capped lower
   * storey's stair picks and selects too. */
  selectedStairId: string | null;
  unit: Unit;
  snapEnabled: boolean;
  onSelectItem: (id: string) => void;
  onDragStart: (
    item: FurnitureItem,
    grabPoint: Point,
    screen: { x: number; y: number },
    grabHeight: number,
  ) => void;
  onSelectOpening: (id: string) => void;
  onDragOpening: (id: string, offset: number, bottom: number | null) => void;
  onMoveActiveChange: (active: boolean) => void;
  onSelectWall: (edgeId: string) => void;
  onSelectStair: (id: string) => void;
}) {
  // One wall solid per graph edge (dangling walls included), plus filler
  // posts at the corner/junction nodes — keyed on this entry's own floor/
  // derived rooms, so an edit confined to another storey never recomputes
  // this one's geometry.
  const solids = useMemo(
    () => buildEdgeSolids(entry.floor, entry.derived.rooms),
    [entry.floor, entry.derived],
  );
  const posts = useMemo(
    () => nodePosts(entry.floor, solids),
    [entry.floor, solids],
  );
  // This storey's own stairs cut its own ceiling (capped storeys only —
  // the active storey's roofless proxy needs no hole).
  const ownVoidRun = useMemo(
    () => stairRun(entry.storeyHeight).run,
    [entry.storeyHeight],
  );
  const ownVoidsByRoom = useMemo(
    () => stairVoidsByRoom(entry.floor.stairs, ownVoidRun, entry.derived.rooms),
    [entry.floor.stairs, ownVoidRun, entry.derived.rooms],
  );
  // The floor below's stairs cut *this* storey's platform — keyed by this
  // storey's own room outlines (the hole's plan position is shared, but the
  // room it falls in is a fact of this floor, not the one below).
  const belowVoidRun = useMemo(
    () => (belowFloor ? stairRun(belowStoreyHeight).run : 0),
    [belowFloor, belowStoreyHeight],
  );
  const belowVoidsByRoom = useMemo(
    () =>
      belowFloor
        ? stairVoidsByRoom(belowFloor.stairs, belowVoidRun, entry.derived.rooms)
        : EMPTY_VOID_MAP,
    [belowFloor, belowVoidRun, entry.derived.rooms],
  );
  return (
    <group position-y={entry.elevation}>
      <Walls
        solids={solids}
        posts={posts}
        lighting={lighting}
        selectedEdgeId={selectedEdgeId}
        onSelectWall={onSelectWall}
        elevation={entry.elevation}
      />
      <RoomOpenings
        solids={solids}
        selectedId={selectedOpeningId}
        unit={unit}
        snapEnabled={snapEnabled}
        onSelect={onSelectOpening}
        onDrag={onDragOpening}
        onDragActiveChange={onMoveActiveChange}
      />
      {entry.floor.stairs.map((stair) => (
        <StairMesh
          key={stair.id}
          stair={stair}
          storeyHeight={entry.storeyHeight}
          selected={stair.id === selectedStairId}
          onSelect={onSelectStair}
        />
      ))}
      {entry.derived.rooms.map((room) => (
        <group key={room.id}>
          <Platform
            outline={room.outline}
            holes={belowVoidsByRoom.get(room.id) ?? EMPTY_HOLES}
          />
          {entry.active ? (
            <CeilingShadowProxy
              outline={room.outline}
              height={wallHeightOf(room)}
            />
          ) : (
            <CeilingSlab
              outline={room.outline}
              wallHeight={wallHeightOf(room)}
              holes={ownVoidsByRoom.get(room.id) ?? EMPTY_HOLES}
            />
          )}
          <FurnitureBucket
            furniture={room.furniture}
            selectedId={selectedId}
            onSelectItem={onSelectItem}
            onDragStart={onDragStart}
          />
        </group>
      ))}
      {entry.derived.unassignedFurniture.length > 0 && (
        <FurnitureBucket
          furniture={entry.derived.unassignedFurniture}
          selectedId={selectedId}
          onSelectItem={onSelectItem}
          onDragStart={onDragStart}
        />
      )}
    </group>
  );
}

export interface RoomSceneProps {
  /** Every visible storey, ground-up through the active floor, at its
   * derived elevation — replaces the single-floor `rooms`/`unassignedFurniture`/
   * `floor` this scene used to take (the active entry carries their values). */
  stack: FloorStackEntry[];
  selectedId: string | null;
  /** Opening selection — doors/windows pick and drag in this lens too. */
  selectedOpeningId: string | null;
  /** Wall selection — a graph edge picked by clicking its body. */
  selectedEdgeId: string | null;
  /** Stair selection — reaches across the whole stack, like furniture. */
  selectedStairId: string | null;
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
   * into whichever room now contains it (or the unassigned bucket); the
   * route resolves which floor owns `id`. */
  onMoveItem: (id: string, update: FurnitureUpdate) => void;
  /** A move drag started/ended — the canvas locks orbit while it runs. */
  onMoveActiveChange: (active: boolean) => void;
  onSelectOpening: (id: string) => void;
  /** One combined opening-drag preview: the raw along-wall target + (windows)
   * the raw whole-hole bottom, resolved onto one floor by the canvas. */
  onDragOpening: (id: string, offset: number, bottom: number | null) => void;
  onSelectWall: (edgeId: string) => void;
  onSelectStair: (id: string) => void;
  /** Containment obstacles beyond the active floor's own wall slabs: stair
   * voids cut into it by the floor below (empty when there's none). Applied
   * only to a drag confined to the active floor — a drag on a lower stack
   * entry (through a doorway-side pick) doesn't get these; a known scope
   * limit (V7 only threads the active floor's voids through). */
  activeExtraObstacles: Obstacle[];
}

export function RoomScene({
  stack,
  selectedId,
  selectedOpeningId,
  selectedEdgeId,
  selectedStairId,
  unit,
  snapEnabled,
  timeOfDay,
  sunAnchorDeg,
  onSelectItem,
  onMoveItem,
  onMoveActiveChange,
  onSelectOpening,
  onDragOpening,
  onSelectWall,
  onSelectStair,
  activeExtraObstacles,
}: RoomSceneProps) {
  const activeEntry =
    stack.find((entry) => entry.active) ?? stack[stack.length - 1] ?? null;
  // Lights, the camera/pool framing and the contact shadow all cover every
  // visible storey together, so a tall stack reads as one warmly lit model
  // instead of a lit ground floor under dark upper storeys.
  const bounds = useMemo(
    () =>
      stack.reduce<Bounds | null>(
        (acc, entry) => unionBounds(acc, floorBounds(entry.derived.rooms)),
        null,
      ),
    [stack],
  );
  const center: [number, number, number] = bounds
    ? [(bounds.min.x + bounds.max.x) / 2, 0, (bounds.min.y + bounds.max.y) / 2]
    : [0, 0, 0];
  // Half the union bounding diagonal (+1 m margin) — the square shadow
  // frustum this sizes wraps every visible storey at any sun azimuth.
  const sunRadius = bounds
    ? Math.hypot(bounds.width, bounds.height) / 2 + 1
    : 6;
  // Selection and drags reach across the whole stack: a lower storey's
  // furniture picks (and drags) through the doorway-side view exactly like
  // the active floor's. Keyed by floor id so a pick's owning entry (for the
  // chip's/drag's elevation) is a cheap lookup.
  const furnitureByFloor = useMemo(
    () =>
      new Map(
        stack.map((entry) => [
          entry.floor.id,
          allFurnitureOf(
            entry.derived.rooms,
            entry.derived.unassignedFurniture,
          ),
        ]),
      ),
    [stack],
  );
  const combinedFurniture = useMemo(
    () => stack.flatMap((entry) => furnitureByFloor.get(entry.floor.id) ?? []),
    [stack, furnitureByFloor],
  );
  const selectedEntry =
    stack.find((entry) =>
      (furnitureByFloor.get(entry.floor.id) ?? []).some(
        (item) => item.id === selectedId,
      ),
    ) ?? null;
  const selectedItem = selectedEntry
    ? ((furnitureByFloor.get(selectedEntry.floor.id) ?? []).find(
        (item) => item.id === selectedId,
      ) ?? null)
    : null;
  const selectedStackTop = useMemo(
    () => stackTopsOf(combinedFurniture),
    [combinedFurniture],
  );

  const { drag, beginDrag, endDrag } = useMoveDrag(onMoveActiveChange);
  const lighting = LIGHTING[timeOfDay];
  // The drag session's data (which floor's furniture/graph it snaps and
  // contains against) comes from the entry that OWNS `drag.floorId` — the
  // active floor when the drag started there, a lower one when it started
  // through a doorway-side pick. Its guides/highlight render in a group at
  // that entry's elevation so they land on the right storey's platform.
  const dragEntry = drag
    ? (stack.find((entry) => entry.floor.id === drag.floorId) ?? activeEntry)
    : null;
  const dragFloor = dragEntry?.floor ?? null;
  const dragDerived = dragEntry?.derived ?? null;
  const dragWallSolids = useMemo(() => {
    if (!dragFloor || !dragDerived) return undefined;
    return buildEdgeSolids(dragFloor, dragDerived.rooms);
  }, [dragFloor, dragDerived]);

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
      {/* One shadow for the whole stack, grounded at the studio pool (y≈0) —
          not per storey, which would stack dark seams under a tall model. */}
      {bounds && <FloorContactShadow bounds={bounds} />}
      {stack.map((entry, i) => (
        <FloorLayer
          key={entry.floor.id}
          entry={entry}
          belowFloor={i > 0 ? stack[i - 1].floor : null}
          belowStoreyHeight={i > 0 ? stack[i - 1].storeyHeight : 0}
          lighting={lighting}
          selectedId={selectedId}
          selectedOpeningId={selectedOpeningId}
          selectedEdgeId={selectedEdgeId}
          selectedStairId={selectedStairId}
          unit={unit}
          snapEnabled={snapEnabled}
          onSelectItem={onSelectItem}
          onDragStart={(item, grabPoint, screen, grabHeight) =>
            beginDrag(item, grabPoint, screen, grabHeight, entry.floor.id)
          }
          onSelectOpening={onSelectOpening}
          onDragOpening={onDragOpening}
          onMoveActiveChange={onMoveActiveChange}
          onSelectWall={onSelectWall}
          onSelectStair={onSelectStair}
        />
      ))}
      {selectedItem && selectedEntry && (
        <SelectionChip
          item={selectedItem}
          // Mounted items hang up the wall and riders stand on furniture;
          // anchor the chip above the elevated body instead of the default
          // floor-relative top — and always add the owning storey's
          // elevation, since the chip renders outside any per-entry group.
          anchor={[
            selectedItem.position.x,
            selectedEntry.elevation +
              (selectedItem.mount
                ? selectedItem.mount.elevation +
                  selectedItem.footprint.height / 2 +
                  0.14
                : selectedStackTop.has(selectedItem.id)
                  ? (selectedStackTop.get(selectedItem.id) ?? 0) +
                    selectedItem.footprint.height +
                    0.14
                  : selectedItem.footprint.height + CHIP_CLEARANCE),
            selectedItem.position.y,
          ]}
        />
      )}
      {drag && dragEntry && (
        <group position-y={dragEntry.elevation}>
          <MoveDragSession
            furniture={furnitureByFloor.get(dragEntry.floor.id) ?? []}
            floor={dragEntry.floor}
            drag={drag}
            unit={unit}
            snapEnabled={snapEnabled}
            freeVerticalMounts
            wallSolids={dragWallSolids}
            elevationY={dragEntry.elevation}
            extraObstacles={dragEntry.active ? activeExtraObstacles : undefined}
            onMove={(update) => onMoveItem(drag.id, update)}
            onEnd={endDrag}
          />
        </group>
      )}
    </group>
  );
}
