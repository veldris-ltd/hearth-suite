// AC-WIN-4 (feed side): the beta channel build overrides and the Tauri updater
// manifest name the same installers the TUF metadata signs (P12.2, ADR-HS-010).
// The client side (signature, tamper, rollback, exact-name match) is tested in
// crates/release/tests/ac_win_4.rs. `node --test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { tauriOverrides } from "../../../ci/desktop/tauri-overrides.mjs";
import { buildManifest } from "../../../ci/tuf/tauri-manifest.mjs";

test("ac_win_4: an unconfigured build only switches updater artefacts off", () => {
  assert.deepEqual(tauriOverrides({}), { bundle: { createUpdaterArtifacts: false } });
  assert.deepEqual(tauriOverrides({ TAURI_SIGNING_PRIVATE_KEY: "k" }), {});
});

test("ac_win_4: a beta build pins its own updater key and channel feed", () => {
  const overrides = tauriOverrides({
    TAURI_SIGNING_PRIVATE_KEY: "k",
    HEARTH_APP_VERSION: "0.1.42",
    HEARTH_UPDATER_PUBKEY: "beta-pub",
    HEARTH_UPDATE_URL: "https://feed.example/hearth/",
    HEARTH_UPDATE_CHANNEL: "beta",
  });
  assert.deepEqual(overrides, {
    version: "0.1.42",
    plugins: {
      updater: {
        pubkey: "beta-pub",
        endpoints: ["https://feed.example/hearth/beta/latest.json"],
      },
    },
  });
});

test("ac_win_4: half an updater configuration or plain http is refused", () => {
  assert.throws(() => tauriOverrides({ HEARTH_UPDATER_PUBKEY: "p" }), /set together/);
  assert.throws(
    () => tauriOverrides({ HEARTH_UPDATER_PUBKEY: "p", HEARTH_UPDATE_URL: "http://x" }),
    /must be https/,
  );
});

test("ac_win_4: versions the MSI cannot carry are refused", () => {
  for (const version of ["1.0.0-beta.3", "256.0.0", "0.1", "0.1.70000"]) {
    assert.throws(() => tauriOverrides({ HEARTH_APP_VERSION: version }), /MSI version/);
  }
});

test("ac_win_3: test signing goes through windows-sign.ps1", () => {
  const overrides = tauriOverrides({
    TAURI_SIGNING_PRIVATE_KEY: "k",
    HEARTH_WIN_SIGN_MODE: "test",
    HEARTH_WIN_SIGN_SCRIPT: "D:\\a\\hearth\\ci\\desktop\\windows-sign.ps1",
  });
  assert.deepEqual(overrides.bundle.windows.signCommand, {
    cmd: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "D:\\a\\hearth\\ci\\desktop\\windows-sign.ps1",
      "%1",
    ],
  });
  assert.throws(() => tauriOverrides({ HEARTH_WIN_SIGN_MODE: "test" }), /HEARTH_WIN_SIGN_SCRIPT/);
  assert.throws(() => tauriOverrides({ HEARTH_WIN_SIGN_MODE: "maybe" }), /test" or "production/);
});

const files = [
  "Hearth Suite_0.1.42_x64-setup.exe",
  "Hearth Suite_0.1.42_x64-setup.exe.sig",
  "Hearth Suite_0.1.42_x64_en-US.msi",
  "Hearth Suite_0.1.42_x64_en-US.msi.sig",
  "targets.json",
];

test("ac_win_4: the Windows manifest entry is the MSI the TUF metadata signs", () => {
  const manifest = buildManifest({
    files,
    readSig: (name) => `sig-of ${name}\n`,
    version: "0.1.42",
    baseUrl: "https://feed.example/hearth/",
    channel: "beta",
    pubDate: "2026-10-27T10:00:00Z",
  });
  assert.deepEqual(manifest, {
    version: "0.1.42",
    notes: "Hearth Suite 0.1.42",
    pub_date: "2026-10-27T10:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature: "sig-of Hearth Suite_0.1.42_x64_en-US.msi",
        url: "https://feed.example/hearth/beta/Hearth%20Suite_0.1.42_x64_en-US.msi",
      },
    },
  });
});

test("ac_win_4: an installer without a Tauri signature is never offered", () => {
  assert.throws(
    () =>
      buildManifest({
        files: ["Hearth Suite_0.1.42_x64_en-US.msi"],
        readSig: () => "",
        version: "0.1.42",
        baseUrl: "https://feed.example",
        channel: "beta",
        pubDate: "2026-10-27T10:00:00Z",
      }),
    /no signed installer/,
  );
});
