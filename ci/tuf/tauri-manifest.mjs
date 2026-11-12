#!/usr/bin/env node
// Write the Tauri updater manifest (latest.json) for a channel feed (P12.2,
// AC-WIN-4, ADR-HS-010). It sits next to the TUF targets.json in the feed: the
// app verifies targets.json first, then lets tauri-plugin-updater download the
// installer named here and check its minisign signature, then matches the bytes
// against the TUF target of the same file name before installing.
//
// Each platform entry points at an installer in <dir> that has a Tauri .sig
// beside it. Windows uses the MSI; the setup.exe stays a manual download.
//
// Usage:
//   node ci/tuf/tauri-manifest.mjs --dir dist --version 0.1.42 \
//     --base-url https://updates.example --channel beta [--notes "..."] [--out dist/latest.json]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Tauri platform keys and the installer that serves each, in preference order. */
const PLATFORMS = [
  ["windows-x86_64", (name) => /_x64_[^/]*\.msi$/.test(name)],
  ["linux-x86_64", (name) => name.endsWith("_amd64.AppImage")],
  ["darwin-aarch64", (name) => name.endsWith(".app.tar.gz")],
];

/**
 * Build the manifest object for the installers in a directory listing.
 * @param {{ files: string[], readSig: (name: string) => string, version: string,
 *   baseUrl: string, channel: string, notes?: string, pubDate: string }} input
 */
export function buildManifest({ files, readSig, version, baseUrl, channel, notes, pubDate }) {
  if (!baseUrl.startsWith("https://")) {
    throw new Error(`base URL must be https, got "${baseUrl}"`);
  }
  const root = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(channel)}`;
  const platforms = {};
  for (const [key, matches] of PLATFORMS) {
    const installer = files.find((name) => matches(name) && files.includes(`${name}.sig`));
    if (installer) {
      platforms[key] = {
        signature: readSig(installer).trim(),
        url: `${root}/${encodeURIComponent(installer)}`,
      };
    }
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("no signed installer found (an installer needs a Tauri .sig beside it)");
  }
  return { version, notes: notes ?? `Hearth Suite ${version}`, pub_date: pubDate, platforms };
}

function arg(argv, name) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const dir = arg(argv, "dir");
  const version = arg(argv, "version");
  const baseUrl = arg(argv, "base-url");
  const channel = arg(argv, "channel");
  if (!dir || !version || !baseUrl || !channel || !existsSync(dir)) {
    console.error(
      "usage: tauri-manifest.mjs --dir <dist> --version <v> --base-url <https://...> --channel <c> [--notes <text>] [--out <file>]",
    );
    process.exit(2);
  }
  const manifest = buildManifest({
    files: readdirSync(dir),
    readSig: (name) => readFileSync(join(dir, `${name}.sig`), "utf8"),
    version,
    baseUrl,
    channel,
    notes: arg(argv, "notes"),
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const out = arg(argv, "out") ?? join(dir, "latest.json");
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Wrote Tauri updater manifest: ${out} (${Object.keys(manifest.platforms).join(", ")})`,
  );
}
