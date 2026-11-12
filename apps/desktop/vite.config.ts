import { defineConfig } from "vite";

// Vite config tuned for Tauri: a fixed dev port the Rust side points its webview
// at, no automatic screen-clearing (so Cargo/Tauri logs stay visible), and a
// build target matching the platform webviews Tauri ships.
export default defineConfig({
  clearScreen: false,
  // Build stamp for Settings > About (AC-WIN-1). ci/desktop/package.sh exports
  // the short commit and the CI job sets the update channel; dev runs show neither.
  define: {
    __HEARTH_BUILD_COMMIT__: JSON.stringify(process.env.HEARTH_BUILD_COMMIT ?? ""),
    __HEARTH_UPDATE_CHANNEL__: JSON.stringify(process.env.HEARTH_UPDATE_CHANNEL ?? ""),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Edge (Windows), WKWebView (macOS), and WebKitGTK (Linux) all support es2021.
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
});
