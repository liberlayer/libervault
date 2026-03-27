import { defineConfig } from "vite";
import react            from "@vitejs/plugin-react";
import webExtension     from "vite-plugin-web-extension";
import wasm             from "vite-plugin-wasm";
import topLevelAwait    from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    webExtension({
      manifest: "src/manifest.json",
      additionalInputs: ["src/inpage/index.ts"],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
