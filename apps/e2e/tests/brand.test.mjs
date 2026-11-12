// Trademark-safe branding (AC-LAUNCH-5): public-facing materials must NOT use the
// ® symbol until trademark registration completes (per the clearance dossier).
// The composite "Hearth Suite by Veldris Ltd." lockup is used instead.
//
// (Internal build docs under docs/build/ legitimately discuss the rule itself,
// so they are out of scope for this guard.)

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../../../", import.meta.url);

const PUBLIC_FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs/getting-started.md",
  "docs/user-guide.md",
  "docs/self-hosting.md",
  "docs/launch-checklist.md",
  "docs/brand.md",
  "docs/dependency-licences.md",
];

function siteFiles() {
  const out = [];
  for (const base of ["site", "pro/site"]) {
    const dir = new URL(`${base}/`, ROOT);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (e.isFile() && e.name.endsWith(".html")) {
        const parent = (e.parentPath ?? e.path).replace(/\\/g, "/");
        out.push(`${parent.slice(parent.indexOf(base))}/${e.name}`);
      }
    }
  }
  return out;
}

test("AC-LAUNCH-5: no ® symbol in public-facing materials", () => {
  for (const rel of [...PUBLIC_FILES, ...siteFiles()]) {
    const url = new URL(rel, ROOT);
    if (!existsSync(url)) continue;
    const text = readFileSync(url, "utf8");
    assert.ok(
      !text.includes("®"),
      `${rel} uses the ® symbol, not permitted until trademark registration (AC-LAUNCH-5)`,
    );
    assert.ok(
      !/Hearth\s*®/.test(text) && !/Hearth\(R\)/i.test(text),
      `${rel} renders a registered-mark form of Hearth Suite, use the "Hearth Suite by Veldris Ltd." lockup`,
    );
  }
});

test("AC-LAUNCH-5: the marketing site uses the composite lockup", () => {
  // The hearth-suite.app source lives in /site in the primary repository and is
  // excluded from the public export (oss-export.toml). Every page includes the
  // shared footer partial, which must carry the trademark-safe composite lockup.
  const candidates = ["site/_partials/footer.html"].map((rel) => new URL(rel, ROOT));
  const present = candidates.filter((u) => existsSync(u));
  if (present.length === 0) {
    return; // site excluded from this checkout (public export), nothing to enforce here
  }
  const usesLockup = present.some((u) =>
    readFileSync(u, "utf8").includes("Hearth Suite by Veldris Ltd."),
  );
  assert.ok(
    usesLockup,
    "the marketing site must use the 'Hearth Suite by Veldris Ltd.' composite lockup",
  );
});
