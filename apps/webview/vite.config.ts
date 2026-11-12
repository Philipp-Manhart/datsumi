import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

// @ts-expect-error Build-only JavaScript license collector.
import { collectLicenses } from "../../scripts/licenses.mjs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "datsumi-third-party-notices",
      async generateBundle(_options, bundle) {
        const inputs = Object.values(bundle).flatMap((item) =>
          item.type === "chunk" ? Object.keys(item.modules) : [],
        );
        // CSS/font components are asset modules as well as JavaScript dependencies.
        inputs.push(
          ...this.getModuleIds(),
          fileURLToPath(new URL("./node_modules/tailwindcss/index.css", import.meta.url)),
        );
        const { text, inventory } = await collectLicenses(inputs);
        this.emitFile({ type: "asset", fileName: "WEBVIEW.NOTICES.txt", source: text });
        this.emitFile({
          type: "asset",
          fileName: "WEBVIEW.components.json",
          source: JSON.stringify(inventory, null, 2) + "\n",
        });
      },
    },
  ],
  base: "./",
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
