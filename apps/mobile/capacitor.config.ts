import type { CapacitorConfig } from "@capacitor/cli";

// Hearth Suite mobile (Capacitor). The web UI is the shared client shell, built by
// Vite into `dist/` and copied into the native projects by `cap sync`.
//
// App icons & splash: source images live in `resources/` (generated from the
// design-system SVG masters via `pnpm --filter @hearth/design-system build:icons`)
// and are projected into the native iOS/Android sets with
// `pnpm run assets` (@capacitor/assets, fetched pinned on demand). See resources/README.md.
const config: CapacitorConfig = {
  appId: "io.veldris.hearthsuite",
  appName: "Hearth Suite",
  webDir: "dist",
  // Offline-first: never load from a remote server; bundle the web assets.
  server: {
    androidScheme: "https",
  },
  android: {
    // Allow the FOSS/F-Droid flavour to be built without proprietary services.
    flavor: "foss",
  },
};

export default config;
