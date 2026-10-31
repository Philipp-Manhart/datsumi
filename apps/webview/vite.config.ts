import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
