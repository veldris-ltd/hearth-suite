import { defineConfig } from "vite";

// Vite config for the Capacitor web layer. Capacitor copies `dist/` into the
// native iOS/Android projects (`webDir` in capacitor.config.ts).
export default defineConfig({
  build: {
    // iOS WKWebView and Android System WebView both support es2021.
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
});
