import { MODEL_MANIFEST as GENERATED } from "./model-manifest.gen";
import type { Footprint } from "./types";

/**
 * Real-mesh coverage (spec: docs/superpowers/specs/2026-07-17-real-furniture-
 * models-design.md). The generated manifest maps catalog ids to normalized
 * GLBs under public/models/; items without an entry render their composed-
 * primitives body (src/lib/furniture-parts.ts) — the universal fallback.
 */

/** How a material in a prepared model reacts to the item's colorway. */
export type ModelSlot = "body" | "accent" | "neutral";

export interface ModelManifestEntry {
  /** Static asset path, served from the site root. */
  file: string;
  /** Normalized mesh size in meters — the item's distortion-free proportions. */
  natural: Footprint;
  /** Material name → slot; "body" materials take the item's tint. */
  slots: Record<string, ModelSlot>;
}

export const MODEL_MANIFEST: Record<string, ModelManifestEntry> = GENERATED;

/** The real-mesh manifest entry for a catalog item, if one has been prepared. */
export function modelForCatalogId(id: string): ModelManifestEntry | undefined {
  return MODEL_MANIFEST[id];
}
