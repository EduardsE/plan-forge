import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { MathUtils } from "three";
import { type FurnitureItem, stackSurfaceHeight } from "#/lib/model";
import { roundedRectPoints } from "#/lib/plan-scene";

/**
 * The armed-host cue while a rider hovers over stackable furniture: a blue
 * outline ringing the host's top surface (with a whisper of fill), shared by
 * the placement ghost and the move-drag session. Under the 2D lens's
 * straight-down camera the same ring reads as a highlight around the host's
 * footprint.
 */

const HIGHLIGHT_COLOR = "#3a5bf0";
const CORNER_RADIUS = 0.04;
/** Above the host's top slab, clear of z-fighting. */
const SURFACE_LIFT = 0.006;

const noRaycast = () => null;

export function HostHighlight({ host }: { host: FurnitureItem }) {
  const y = stackSurfaceHeight(host) + SURFACE_LIFT;
  const { width, depth } = host.footprint;
  const loop = useMemo(() => {
    const rect = roundedRectPoints(width, depth, CORNER_RADIUS);
    return [...rect, rect[0]];
  }, [width, depth]);
  return (
    <group
      position={[host.position.x, 0, host.position.y]}
      rotation-y={MathUtils.degToRad(host.rotation)}
    >
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={y - 0.002}
        raycast={noRaycast}
      >
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={HIGHLIGHT_COLOR}
          transparent
          opacity={0.07}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={loop.map((p) => [p.x, y, p.y] as [number, number, number])}
        color={HIGHLIGHT_COLOR}
        lineWidth={2}
        transparent
        opacity={0.75}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
    </group>
  );
}
