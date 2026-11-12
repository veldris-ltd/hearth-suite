// Regenerate the Hearth Suite app-icon / favicon raster set from the SVG masters
// (DSG-B2). Renders with @resvg/resvg-js, packs favicon.ico / icon.icns, writes
// the canonical set into assets/app-icon/, and copies the web + native targets
// into the desktop (Vite public + Tauri icons) and mobile (Vite public +
// Capacitor resources) apps. Run with `node scripts/app-icon.mjs`.

import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ds = join(here, "..");
const repo = join(ds, "..", "..");
const out = join(ds, "assets", "app-icon");
mkdirSync(out, { recursive: true });

const svg = (name) => readFileSync(join(out, name), "utf8");
/** Render an SVG master to a PNG Buffer at the given pixel width (square). */
const png = (master, size) =>
  Buffer.from(
    new Resvg(svg(master), {
      fitTo: { mode: "width", value: size },
      background: "rgba(0,0,0,0)",
    })
      .render()
      .asPng(),
  );
const writePng = (dir, file, master, size) => {
  const p = png(master, size);
  writeFileSync(join(dir, file), p);
  return p;
};

// ---- Canonical set (assets/app-icon/) -----------------------------------
const f16 = writePng(out, "favicon-16.png", "favicon.svg", 16);
const f32 = writePng(out, "favicon-32.png", "favicon.svg", 32);
const f48 = writePng(out, "favicon-48.png", "icon.svg", 48);
writePng(out, "apple-touch-icon-180.png", "icon.svg", 180);
writePng(out, "icon-192.png", "icon.svg", 192);
writePng(out, "icon-512.png", "icon.svg", 512);
writePng(out, "icon-maskable-512.png", "icon-maskable.svg", 512);
writeFileSync(join(out, "favicon.ico"), await pngToIco([f16, f32, f48]));

const manifest = {
  name: "Hearth Suite",
  short_name: "Hearth Suite",
  description: "Your work, your fire, yours alone.",
  start_url: "/",
  display: "standalone",
  background_color: "#F4EEE7",
  theme_color: "#B5531F",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
writeFileSync(join(out, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);

// ---- Web copies into each app's Vite public/ dir ------------------------
const WEB = [
  "favicon.ico",
  "favicon.svg",
  "favicon-16.png",
  "favicon-32.png",
  "apple-touch-icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "manifest.webmanifest",
];
for (const app of ["desktop", "mobile"]) {
  const pub = join(repo, "apps", app, "public");
  mkdirSync(pub, { recursive: true });
  for (const f of WEB) copyFileSync(join(out, f), join(pub, f));
}

// ---- Tauri desktop icons -----------------------------------------------
const tauri = join(repo, "apps", "desktop", "src-tauri", "icons");
mkdirSync(tauri, { recursive: true });
writePng(tauri, "32x32.png", "icon.svg", 32);
writePng(tauri, "64x64.png", "icon.svg", 64);
writePng(tauri, "128x128.png", "icon.svg", 128);
writePng(tauri, "128x128@2x.png", "icon.svg", 256);
writePng(tauri, "icon.png", "icon.svg", 512);
writePng(tauri, "source.png", "icon.svg", 1024);
writePng(tauri, "StoreLogo.png", "icon.svg", 50);
for (const s of [30, 44, 71, 89, 107, 142, 150, 284, 310])
  writePng(tauri, `Square${s}x${s}Logo.png`, "icon.svg", s);
writeFileSync(
  join(tauri, "icon.ico"),
  await pngToIco([16, 32, 48, 64, 128, 256].map((s) => png("icon.svg", s))),
);
// macOS .icns (pure-JS pack; optional, skip cleanly if the lib is absent).
try {
  const { Icns, IcnsImage } = await import("@fiahfy/icns");
  const icns = new Icns();
  for (const [type, size] of [
    ["ic04", 16],
    ["ic05", 32],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    icns.append(IcnsImage.fromPNG(png("icon.svg", size), type));
  }
  writeFileSync(join(tauri, "icon.icns"), icns.data);
} catch (e) {
  console.warn("icon.icns not regenerated (@fiahfy/icns unavailable):", e.message);
}

// ---- Capacitor mobile resources (consumed by @capacitor/assets) ---------
const res = join(repo, "apps", "mobile", "resources");
mkdirSync(res, { recursive: true });
writePng(res, "icon.png", "icon.svg", 1024);
writePng(res, "icon-foreground.png", "icon-foreground.svg", 1024);
writePng(res, "icon-background.png", "icon-background.svg", 1024);

console.log(
  "Wrote app-icon set to assets/app-icon/, apps/*/public, Tauri icons, and mobile resources.",
);
