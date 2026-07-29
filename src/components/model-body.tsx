import { useGLTF } from "@react-three/drei";
import { Component, type ReactNode, Suspense, useMemo } from "react";
import { BackSide, MeshBasicMaterial } from "three";
import { assetUrl } from "#/lib/asset-url";
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
// few KB each, so the primitives fallback only ever shows for a blink. This
// is fire-and-forget — drei/suspend-react's preload() always returns
// undefined, so a failed warm-up (e.g. the asset host is briefly down) has
// no promise a caller can attach a .catch to and surfaces as an uncaught
// window error instead, even though the real per-item Suspense +
// ModelLoadBoundary below handles that exact failure cleanly once the model
// actually renders. Swallow just that one known error shape here; every
// other window error still reports normally.
const preloadModel = useGLTF.preload;
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const message = event.message;
    if (!message) return;
    const isKnownManifestFile = Object.values(MODEL_MANIFEST).some((entry) =>
      message.includes(entry.file),
    );
    if (!isKnownManifestFile) return;
    console.warn(
      "Model preload failed (primitives fallback will render):",
      message,
    );
    event.preventDefault();
  });
  for (const entry of Object.values(MODEL_MANIFEST))
    preloadModel(assetUrl(entry.file));
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
  const { scene } = useGLTF(assetUrl(entry.file));
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
