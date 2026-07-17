import { useGLTF } from "@react-three/drei";
import { Component, type ReactNode, Suspense, useMemo } from "react";
import { BackSide, MeshBasicMaterial } from "three";
import type { Footprint } from "#/lib/model";
import { MODEL_MANIFEST, type ModelManifestEntry } from "#/lib/model/models";
import {
  fitModelScale,
  hullModelClone,
  tintedModelClone,
} from "#/lib/model-scene";

/**
 * A furniture item's real-mesh body (spec: docs/superpowers/specs/2026-07-17-
 * real-furniture-models-design.md): the manifest's normalized GLB, uniformly
 * scaled into the footprint (never distorted — aspect edits underfill), body
 * materials tinted to the item's colorway. While the file loads — and if it
 * ever fails — the caller's composed-primitives body renders instead, so a
 * broken asset can never empty the room.
 */

/** Extra uniform scale on the hull clone — the silhouette stroke's rim. */
const HULL_INFLATE = 1.04;

// Warm the loader cache for every prepared model at startup; the files are a
// few KB each, so the primitives fallback only ever shows for a blink.
const preloadModel = useGLTF.preload;
if (typeof window !== "undefined") {
  for (const entry of Object.values(MODEL_MANIFEST)) preloadModel(entry.file);
}

interface ModelBodyProps {
  entry: ModelManifestEntry;
  footprint: Footprint;
  /** Body tint — colorway/base, already warn-adjusted by the caller. */
  color: string;
  /** Selected or hovered: show the silhouette hull. */
  active: boolean;
  hullColor: string;
  hullOpacity: number;
  /** The item's composed-primitives meshes: loading + failure fallback. */
  fallback: ReactNode;
}

export function ModelBody({ fallback, ...props }: ModelBodyProps) {
  return (
    <ModelLoadBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedModel {...props} />
      </Suspense>
    </ModelLoadBoundary>
  );
}

function LoadedModel({
  entry,
  footprint,
  color,
  active,
  hullColor,
  hullOpacity,
}: Omit<ModelBodyProps, "fallback">) {
  const { scene } = useGLTF(entry.file);
  const tinted = useMemo(
    () => tintedModelClone(scene, entry.slots, color),
    [scene, entry, color],
  );
  const hullMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: hullColor,
        side: BackSide,
        transparent: true,
      }),
    [hullColor],
  );
  hullMaterial.opacity = hullOpacity;
  const hull = useMemo(
    () => (active ? hullModelClone(tinted, hullMaterial) : null),
    [active, tinted, hullMaterial],
  );
  const scale = fitModelScale(entry.natural, footprint);
  return (
    <>
      <primitive object={tinted} scale={scale} />
      {hull && (
        <primitive
          object={hull}
          scale={scale * HULL_INFLATE}
          // Scaling about the floor-center origin grows upward only; recenter
          // the vertical inflation so the rim reads evenly.
          position-y={-((HULL_INFLATE - 1) * entry.natural.height * scale) / 2}
        />
      )}
    </>
  );
}

/** useGLTF failure surfaces as a render error; catch it per item. */
class ModelLoadBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
