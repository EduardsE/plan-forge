import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import { fitModelScale, hullModelClone, tintedModelClone } from "./model-scene";

/** A two-mesh stand-in for a loaded kit model: fabric seat + wood legs. */
function sampleModel() {
  const fabric = new MeshStandardMaterial({ color: "#ff0000" });
  fabric.name = "fabric";
  const wood = new MeshStandardMaterial({ color: "#00ff00" });
  wood.name = "wood";
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), fabric));
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), wood));
  return { scene, fabric, wood };
}

function meshes(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof Mesh) found.push(obj);
  });
  return found;
}

describe("fitModelScale", () => {
  it("is 1 when the footprint equals the natural size", () => {
    const size = { width: 1.68, depth: 0.88, height: 0.82 };
    expect(fitModelScale(size, { ...size })).toBe(1);
  });

  it("shrinks uniformly to the tightest axis", () => {
    const natural = { width: 2, depth: 1, height: 1 };
    expect(fitModelScale(natural, { width: 1, depth: 1, height: 1 })).toBe(0.5);
  });

  it("leaves scale at the limiting axis when one dimension grows (underfill)", () => {
    const natural = { width: 2, depth: 1, height: 1 };
    expect(fitModelScale(natural, { width: 3, depth: 1, height: 1 })).toBe(1);
  });
});

describe("tintedModelClone", () => {
  const slots = { fabric: "body", wood: "neutral" } as const;

  it("tints body-slot materials and keeps neutral ones", () => {
    const { scene } = sampleModel();
    const clone = tintedModelClone(scene, slots, "#ce7b52");
    const colors = meshes(clone).map(
      (m) => `#${(m.material as MeshStandardMaterial).color.getHexString()}`,
    );
    expect(colors).toContain("#ce7b52");
    expect(colors).toContain("#00ff00");
  });

  it("never mutates the source scene or shares materials with it", () => {
    const { scene, fabric, wood } = sampleModel();
    const clone = tintedModelClone(scene, slots, "#ce7b52");
    expect(`#${fabric.color.getHexString()}`).toBe("#ff0000");
    const cloneMaterials = meshes(clone).map((m) => m.material);
    expect(cloneMaterials).not.toContain(fabric);
    expect(cloneMaterials).not.toContain(wood);
  });
});

describe("hullModelClone", () => {
  it("swaps every mesh onto the hull material and disables raycasting", () => {
    const { scene } = sampleModel();
    const hullMaterial = new MeshBasicMaterial();
    const hull = hullModelClone(scene, hullMaterial);
    for (const mesh of meshes(hull)) {
      expect(mesh.material).toBe(hullMaterial);
      const hits: unknown[] = [];
      // biome-ignore lint/suspicious/noExplicitAny: exercising the raycast stub.
      mesh.raycast(null as any, hits as any);
      expect(hits).toHaveLength(0);
    }
  });
});
