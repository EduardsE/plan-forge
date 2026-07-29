import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves a project repo from a subfolder, so the deploy workflow
// sets BASE_PATH=/plan-forge/. Locally it stays "/" — dev and preview keep
// serving from the root. Everything that builds a URL to a public asset by
// hand must go through `assetUrl()` (src/lib/asset-url.ts) to pick this up;
// Vite rewrites bundled imports on its own. TanStack Start derives the
// router's basepath from this too.
const base = process.env.BASE_PATH ?? "/";

const config = defineConfig({
  base,
  resolve: { tsconfigPaths: true },
  plugins: [
    // Disable click-to-source injection: it stamps `data-tsd-source` onto
    // every JSX element, and R3F reads hyphenated props as nested paths
    // (`data-tsd-source` → `object.data.tsd.source`), so the attribute
    // crashes the three.js scene ("Cannot set data-tsd-source"). The rest
    // of the devtools stays on.
    devtools({ injectSource: { enabled: false } }),
    tailwindcss(),
    // GitHub Pages is a static host: no request-time server. Prerendering the
    // one route to dist/client/index.html turns the build into a plain
    // static bundle that hydrates on load.
    tanstackStart({ prerender: { enabled: true }, pages: [{ path: "/" }] }),
    viteReact(),
  ],
});

export default config;
