// AC-WIN-1: the Windows test client builds without production keys through one
// path (P12.1, ADR-HS-007). The configuration checks run everywhere; the
// installer checks run when HEARTH_DIST_DIR points at a built dist/ (the
// windows-test workflow sets it after ci/desktop/package.sh windows). `node --test`.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));

test("ac_win_1: the bundle targets both Windows installers", () => {
  assert.ok(tauri.bundle.targets.includes("msi"));
  assert.ok(tauri.bundle.targets.includes("nsis"));
  assert.equal(tauri.bundle.windows.nsis.installMode, "perMachine");
  assert.equal(tauri.bundle.windows.wix.language, "en-US");
});

test("ac_win_1: WebView2 ships with the installer instead of downloading at install", () => {
  assert.equal(tauri.bundle.windows.webviewInstallMode.type, "embedBootstrapper");
});

test("ac_win_1: just desktop and CI share ci/desktop/package.sh", () => {
  const recipe = read("justfile")
    .split(/^desktop:.*$/m)[1]
    .split(/^\S/m)[0];
  assert.match(recipe, /ci\/desktop\/package\.sh/);
  assert.match(read(".github/workflows/windows-test.yml"), /ci\/desktop\/package\.sh windows/);
});

test("ac_win_1: package.sh stamps the build commit, separate from the TUF floor", () => {
  const script = read("ci/desktop/package.sh");
  assert.match(script, /export HEARTH_BUILD_COMMIT/);
  // HEARTH_BUILD_VERSION is the integer rollback floor (updater.rs); the
  // package script must not overwrite it with a display string.
  assert.doesNotMatch(script, /HEARTH_BUILD_VERSION=/);
});

const dist = process.env.HEARTH_DIST_DIR;

test(
  "ac_win_1: dist holds one MSI and one setup exe with matching checksums",
  { skip: !dist },
  () => {
    const files = readdirSync(dist);
    const msi = files.filter((f) => f.endsWith(".msi"));
    const exe = files.filter((f) => f.endsWith("-setup.exe"));
    assert.equal(msi.length, 1, `expected one .msi, found ${msi.join(", ") || "none"}`);
    assert.equal(exe.length, 1, `expected one -setup.exe, found ${exe.join(", ") || "none"}`);
    for (const installer of [...msi, ...exe]) {
      assert.ok(files.includes(`${installer}.sha256`), `${installer}.sha256 missing`);
      const expected = readFileSync(join(dist, `${installer}.sha256`), "utf8")
        .trim()
        .split(/\s+/)[0];
      const actual = createHash("sha256")
        .update(readFileSync(join(dist, installer)))
        .digest("hex");
      assert.equal(actual, expected, `${installer} checksum mismatch`);
    }
  },
);

test("ac_win_1: installer names carry the configured version", { skip: !dist }, () => {
  const installers = readdirSync(dist).filter((f) => f.endsWith(".msi") || f.endsWith(".exe"));
  for (const installer of installers) {
    assert.ok(installer.includes(tauri.version), `${installer} lacks version ${tauri.version}`);
  }
});
