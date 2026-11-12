import { defineConfig } from "vite";

// The Admin Control Panel web app. Built by Vite; served by the admin-cp API
// (or any static host) behind the operator's authenticated origin.
export default defineConfig({
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
});
