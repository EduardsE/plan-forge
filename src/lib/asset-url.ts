/**
 * Resolve a root-absolute `public/` path against the deployed base path.
 *
 * Vite rewrites asset URLs it can see at build time (imports, CSS `url()`),
 * but paths we assemble ourselves — the glTF files in the model manifest, the
 * catalog thumbnails — are opaque strings, so they need this. On GitHub Pages
 * the app lives under `/plan-forge/`; locally `BASE_URL` is `/` and this is a
 * no-op.
 */
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + path;
}
