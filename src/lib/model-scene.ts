import { Color, type Material, Mesh, type Object3D } from "three";

import type { Footprint } from "#/lib/model";
import type { ModelSlot } from "#/lib/model/models";

/**
 * Pure three-object helpers behind the 3D lens's real-mesh bodies
 * (src/components/model-body.tsx). No R3F/drei imports — testable directly.
 */

/**
 * Uniform fit of a model's natural size into an item footprint — never
 * distorts; a user aspect-edit makes the mesh underfill instead (spec
 * decision). The footprint stays the single source of truth for snapping,
 * the 2D lens, and flush-to-wall.
 */
export function fitModelScale(
  natural: Footprint,
  footprint: Footprint,
): number {
  return Math.min(
    footprint.width / natural.width,
    footprint.depth / natural.depth,
    footprint.height / natural.height,
  );
}

/**
 * A render-ready deep clone with per-item materials: "body"-slot materials
 * take the item's tint (colorway / base color, warn-adjusted by the caller);
 * everything else keeps the model's own color. Materials are always cloned —
 * a loaded GLTF shares them across meshes and across items.
 */
export function tintedModelClone(
  source: Object3D,
  slots: Record<string, ModelSlot>,
  color: string,
): Object3D {
  const clone = source.clone(true);
  const tint = new Color(color);
  clone.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    // Real bodies drop shadows into the sun patch and shade themselves.
    obj.castShadow = true;
    obj.receiveShadow = true;
    const swap = (material: Material): Material => {
      const copy = material.clone();
      if (slots[material.name] === "body" && "color" in copy) {
        (copy as Material & { color: Color }).color.copy(tint);
      }
      return copy;
    };
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(swap)
      : swap(obj.material);
  });
  return clone;
}

const noRaycast = () => null;

/**
 * The selection silhouette's mesh: every surface on one shared back-side
 * material (the caller inflates it slightly via scale), invisible to picking.
 */
export function hullModelClone(source: Object3D, material: Material): Object3D {
  const clone = source.clone(true);
  clone.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.material = material;
    obj.raycast = noRaycast;
  });
  return clone;
}
