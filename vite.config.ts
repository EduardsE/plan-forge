import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Disable click-to-source injection: it stamps `data-tsd-source` onto
    // every JSX element, and R3F reads hyphenated props as nested paths
    // (`data-tsd-source` → `object.data.tsd.source`), so the attribute
    // crashes the three.js scene ("Cannot set data-tsd-source"). The rest
    // of the devtools stays on.
    devtools({ injectSource: { enabled: false } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
