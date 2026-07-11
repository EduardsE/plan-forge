import { Html, Line, useCursor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { MathUtils, Vector3 } from "three";
import {
  CLICK_SLOP_PX,
  FLOOR_PLANE,
  floorProjector,
  useControlsPause,
} from "#/components/move-drag";
import type { FurnitureItem, FurnitureUpdate, Point } from "#/lib/model";
import {
  PLACEMENT_GRID,
  rotatedFootprintSize,
  snapPlacement,
} from "#/lib/place";
import {
  nearbyWallAngles,
  rotationAngleOf,
  snapRotationDeg,
} from "#/lib/rotate";

/**
 * The drag-to-rotate handle on a selected footprint (2D lens): a knob just
 * past the footprint's local +x edge — so the knob's bearing from the center
 * *is* the rotation angle — orbiting the item about its center. Dragging
 * snaps to 15° detents plus any nearby non-axis wall's tangent alignments
 * (so a table sits parallel to a 45° wall); holding alt/option — or turning
 * snap off — rotates freely in whole degrees. A pill beside the knob reads
 * the live angle. Esc restores the grab rotation; pointerup commits (the
 * route folds the streamed previews into one history step when the camera
 * controls release). Wall-mounted items never render one — their rotation is
 * derived from the wall.
 */

const HANDLE_COLOR = "#3a5bf0";
/** Gap from the footprint's edge to the knob center, meters. */
const KNOB_GAP = 0.34;
/** Leader starts past the selection halo (its 0.06 gap plus breath). */
const LEADER_START_GAP = 0.1;
/** Invisible pick disc around the knob (the visual dot is smaller). */
const PICK_RADIUS = 0.18;
/** Above the plan's footprint strokes (LINE_Y 0.014 + stack lift 0.008). */
const HANDLE_Y = 0.024;
const LABEL_Y = 0.032;

/** Raycast opt-out for the leader line (drei Line quads overshoot it). */
const noRaycast = () => null;

/** A live rotate drag, captured at grab time — the center never moves, so
 * the nearby-wall detents are computed once here. */
interface RotateDrag {
  originalRotation: number;
  /** Rotation pivot; also the containment base, so detenting back to the
   * grab angle returns the item exactly where it started. */
  originalPosition: Point;
  /** Pointer bearing at grab, rotation-space degrees — dragging applies the
   * bearing's delta, so the knob never jumps under the hand. */
  grabAngle: number;
  /** Nearby non-axis wall tangents joining the detent set. */
  wallAngles: number[];
  footprint: { width: number; depth: number };
  /** Floor items re-contain against the outline; a stacked rider's position
   * derives from its host (restack clamps it), so it passes through. */
  contain: boolean;
  originScreen: { x: number; y: number };
}

export function RotateHandle({
  item,
  outline,
  snapEnabled,
  onRotate,
  onActiveChange,
}: {
  item: FurnitureItem;
  outline: Point[];
  /** Snap toggle: off means free rotation (whole degrees, no detents). */
  snapEnabled: boolean;
  /** Live update per pointermove — a preview, settled by `onActiveChange`. */
  onRotate: (update: FurnitureUpdate) => void;
  /** The drag started/ended — pauses the camera and settles history. */
  onActiveChange: (active: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [drag, setDrag] = useState<RotateDrag | null>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, "grab");
  const { begin, end } = useControlsPause(onActiveChange);
  // Latest callbacks/toggles without resubscribing the listeners mid-drag
  // (every preview rebuilds the room they close over).
  const rotateRef = useRef(onRotate);
  rotateRef.current = onRotate;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;

  useEffect(() => {
    if (!drag) return;
    const toFloor = floorProjector(gl, camera);
    const endDrag = () => {
      setDrag(null);
      end();
    };
    // Pointer-still-down presses shouldn't detent the item: nothing turns
    // until the pointer clears the click slop.
    let moved = false;
    const handleMove = (event: PointerEvent) => {
      // A pointerup that landed before this effect ran was never seen —
      // a buttons-up move means the session is stale, not a drag.
      if (event.buttons === 0) {
        endDrag();
        return;
      }
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
      const bearing = rotationAngleOf({
        x: point.x - drag.originalPosition.x,
        y: point.y - drag.originalPosition.y,
      });
      const raw = drag.originalRotation + bearing - drag.grabAngle;
      const free = event.altKey || !snapRef.current;
      const rotation = snapRotationDeg(raw, drag.wallAngles, !free);
      // Spinning near a wall can poke the hull out; slide the center back
      // in from the grab position (containment only — no quantize/flush),
      // exactly like the inspector's Rotate button.
      let position = drag.originalPosition;
      if (drag.contain) {
        const hull = rotatedFootprintSize(drag.footprint, rotation);
        position = snapPlacement(
          outline,
          hull,
          drag.originalPosition,
          [],
          0,
          PLACEMENT_GRID,
          false,
        ).center;
      }
      rotateRef.current({ position, rotation });
    };
    const handleUp = () => endDrag();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      rotateRef.current({
        position: drag.originalPosition,
        rotation: drag.originalRotation,
      });
      endDrag();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drag, camera, gl, outline, end]);

  const { width, depth } = item.footprint;
  const knobDistance = width / 2 + KNOB_GAP;
  return (
    <group
      position={[item.position.x, 0, item.position.y]}
      rotation-y={MathUtils.degToRad(item.rotation)}
    >
      <Line
        points={[
          [width / 2 + LEADER_START_GAP, HANDLE_Y, 0],
          [knobDistance, HANDLE_Y, 0],
        ]}
        color={HANDLE_COLOR}
        lineWidth={1.5}
        transparent
        opacity={0.55}
        alphaToCoverage={false}
        raycast={noRaycast}
      />
      <mesh
        rotation-x={-Math.PI / 2}
        position={[knobDistance, HANDLE_Y + 0.004, 0]}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const hit = new Vector3();
          if (!event.ray.intersectPlane(FLOOR_PLANE, hit)) return;
          event.stopPropagation();
          setDrag({
            originalRotation: item.rotation,
            originalPosition: item.position,
            grabAngle: rotationAngleOf({
              x: hit.x - item.position.x,
              y: hit.z - item.position.y,
            }),
            wallAngles: nearbyWallAngles(
              outline,
              item.position,
              Math.hypot(width, depth) / 2,
            ),
            footprint: { width, depth },
            contain: !item.mount && !item.stack,
            originScreen: { x: event.clientX, y: event.clientY },
          });
          begin();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[PICK_RADIUS, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html
        position={[knobDistance, LABEL_Y, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <div
          className="h-3.5 w-3.5 rounded-full border-[2.5px] border-[#3a5bf0] bg-white"
          style={{
            boxShadow:
              hovered || drag
                ? "0 0 0 5px rgba(58,91,240,0.22)"
                : "0 1px 3px rgba(15,27,61,0.25)",
          }}
        />
      </Html>
      {drag && (
        <Html
          position={[knobDistance + 0.45, LABEL_Y, 0]}
          center
          style={{ pointerEvents: "none" }}
          zIndexRange={[30, 0]}
        >
          <span className="whitespace-nowrap rounded-[7px] bg-[#3a5bf0] px-2.5 py-[3px] font-mono text-[12.5px] text-white">
            {Math.round(item.rotation)}°
          </span>
        </Html>
      )}
    </group>
  );
}
