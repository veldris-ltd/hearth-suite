#!/usr/bin/env node
// Tauri configuration overrides for one desktop build, derived from the build
// environment (P12.2, ADR-HS-007, ADR-HS-010). ci/desktop/package.sh writes the
// result to a file and passes it to `tauri build --config`. The committed
// tauri.conf.json stays the stable-channel baseline; nothing here weakens it.
//
//   HEARTH_APP_VERSION       installer/app version for this build (e.g. 0.1.42)
//   TAURI_SIGNING_PRIVATE_KEY  absent -> no updater artefacts (unsigned build)
//   HEARTH_UPDATER_PUBKEY    Tauri updater (minisign) public key for this channel
//   HEARTH_UPDATE_URL        update feed base URL; with HEARTH_UPDATE_CHANNEL it
//                            sets the updater endpoint to <url>/<channel>/latest.json
//   HEARTH_UPDATE_CHANNEL    beta | stable (default stable)
//   HEARTH_WIN_SIGN_MODE     test | production -> Windows signCommand
//   HEARTH_WIN_SIGN_SCRIPT   absolute path to ci/desktop/windows-sign.ps1
//
// Usage: node ci/desktop/tauri-overrides.mjs   (prints JSON, "{}" when none)

import { pathToFileURL } from "node:url";

/** Windows MSI versions must be major.minor.patch with numeric parts (WiX). */
const MSI_VERSION = /^(\d{1,3})\.(\d{1,3})\.(\d{1,5})$/;

/**
 * Build the override object for an environment.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, unknown>}
 */
export function tauriOverrides(env) {
  const overrides = {};
  const bundle = {};
  const value = (name) => (env[name] ?? "").trim();

  const version = value("HEARTH_APP_VERSION");
  if (version) {
    const match = MSI_VERSION.exec(version);
    if (!match || Number(match[1]) > 255 || Number(match[2]) > 255 || Number(match[3]) > 65535) {
      throw new Error(
        `HEARTH_APP_VERSION "${version}" is not a valid MSI version (major.minor.patch, at most 255.255.65535)`,
      );
    }
    overrides.version = version;
  }

  if (!value("TAURI_SIGNING_PRIVATE_KEY")) {
    // Updater artefacts must be signed; without the key, build installers only.
    bundle.createUpdaterArtifacts = false;
  }

  const mode = value("HEARTH_WIN_SIGN_MODE");
  if (mode) {
    if (mode !== "test" && mode !== "production") {
      throw new Error(`HEARTH_WIN_SIGN_MODE must be "test" or "production", got "${mode}"`);
    }
    const script = value("HEARTH_WIN_SIGN_SCRIPT");
    if (!script) {
      throw new Error("HEARTH_WIN_SIGN_SCRIPT is required when HEARTH_WIN_SIGN_MODE is set");
    }
    bundle.windows = {
      signCommand: {
        cmd: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "%1"],
      },
    };
  }

  if (Object.keys(bundle).length > 0) {
    overrides.bundle = bundle;
  }

  const pubkey = value("HEARTH_UPDATER_PUBKEY");
  const url = value("HEARTH_UPDATE_URL");
  if (pubkey || url) {
    if (!pubkey || !url) {
      throw new Error("HEARTH_UPDATER_PUBKEY and HEARTH_UPDATE_URL must be set together");
    }
    if (!url.startsWith("https://")) {
      throw new Error(`HEARTH_UPDATE_URL must be https, got "${url}"`);
    }
    const channel = value("HEARTH_UPDATE_CHANNEL") || "stable";
    overrides.plugins = {
      updater: {
        pubkey,
        endpoints: [`${url.replace(/\/+$/, "")}/${channel}/latest.json`],
      },
    };
  }

  return overrides;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${JSON.stringify(tauriOverrides(process.env))}\n`);
}
