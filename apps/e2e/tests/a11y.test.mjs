// Accessibility gates (P2-Q1, AC-A11Y-*): substantiate the WCAG 2.1 AA claim
// with checks that run fully offline in the same node --test E2E suite.
//
// This is the static, dependency-free layer: it asserts the structural
// invariants axe would otherwise flag (page language, a working skip-to-content
// link, a single main landmark, an app-wide reduced-motion rule, visible focus
// styles). The dynamic axe-core pass runs in the CI `a11y` job (see
// apps/e2e/axe-ci.mjs + .github/workflows/ci.yml), where a browser DOM and the
// axe tooling are available.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

// Each app's HTML entry and the shell source that creates its main landmark.
const APP_PAGES = [
  { html: "apps/desktop/index.html", shell: "packages/client-shell/src/index.ts" },
  { html: "apps/mobile/index.html", shell: "packages/client-shell/src/index.ts" },
  { html: "apps/admin/index.html", shell: "apps/admin/src/app.ts" },
];

const SKIP_TARGET = "hb-main";

test("AC-A11Y: every app page declares a document language", () => {
  for (const { html } of APP_PAGES) {
    const doc = read(html);
    assert.match(doc, /<html[^>]*\slang="[a-z-]+"/i, `${html} must set <html lang="...">`);
  }
});

test("AC-A11Y: every app page has a skip-to-content link as the first focusable element", () => {
  for (const { html } of APP_PAGES) {
    const doc = read(html);
    const skip = doc.match(/<a\s+class="hb-skip-link"\s+href="#([\w-]+)"[^>]*>/i);
    assert.ok(skip, `${html} must include a .hb-skip-link`);
    assert.equal(skip[1], SKIP_TARGET, `${html} skip link must target #${SKIP_TARGET}`);
    // It must precede the app mount point, so it is the first thing focused.
    assert.ok(
      doc.indexOf("hb-skip-link") < doc.indexOf('id="app"'),
      `${html} skip link must come before the app root`,
    );
  }
});

test("AC-A11Y: the skip-link target is a real, focusable main landmark in each shell", () => {
  for (const { shell } of APP_PAGES) {
    const src = read(shell);
    assert.ok(
      src.includes(`id: "${SKIP_TARGET}"`) || src.includes(`"id": "${SKIP_TARGET}"`),
      `${shell} must create an element with id="${SKIP_TARGET}"`,
    );
    assert.ok(
      src.includes('tabindex: "-1"'),
      `${shell} must make the main landmark focusable (tabindex="-1") for the skip link`,
    );
  }
});

test("AC-A11Y: an app-wide reduced-motion rule neutralises non-essential motion", () => {
  const css = read("packages/design-system/styles/components.css");
  const block = css.match(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\*,[\s\S]*?\}/,
  );
  assert.ok(block, "components.css must have a global prefers-reduced-motion rule targeting *");
  assert.match(
    block[0],
    /animation-duration:\s*0\.01ms\s*!important/,
    "must neutralise animations",
  );
  assert.match(
    block[0],
    /transition-duration:\s*0\.01ms\s*!important/,
    "must neutralise transitions",
  );
});

test("AC-A11Y: visible focus styles and the skip-link affordance are defined", () => {
  const css = read("packages/design-system/styles/components.css");
  assert.match(css, /\.hb-skip-link\s*\{/, "the skip link needs a style");
  assert.match(css, /\.hb-skip-link:focus/, "the skip link must reveal on focus");
  assert.match(css, /focus-visible/, "keyboard focus styles must exist");
});

// hearth-suite.app lives in /site (and the /pro page in /pro/site) in the
// primary repository; both are excluded from the public export. When present,
// every page must honour the same a11y contract.
function sitePages() {
  const out = [];
  for (const base of ["site", "pro/site"]) {
    const dir = new URL(`${base}/`, ROOT);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      const parent = (e.parentPath ?? e.path).replace(/\\/g, "/");
      if (e.isFile() && e.name.endsWith(".html") && !parent.includes("_partials")) {
        out.push(`${parent.slice(parent.indexOf(base)).replace(/\/$/, "")}/${e.name}`);
      }
    }
  }
  return out;
}

test("AC-A11Y: website pages declare a language and carry the skip-link wiring", () => {
  const pages = sitePages();
  if (pages.length === 0) return; // site excluded from this checkout
  for (const rel of pages) {
    const doc = read(rel);
    assert.match(doc, /<html[^>]*\slang="[a-z-]+"/i, `${rel} must set <html lang="...">`);
    assert.ok(doc.includes("<main"), `${rel} must have a <main> landmark`);
    assert.match(doc, /@include header/, `${rel} must include the shared header (skip link)`);
  }
  assert.match(
    read("site/_partials/header.html"),
    /class="skip-link" href="#main"/,
    "the shared header must carry the skip link",
  );
  const css = read("site/styles/site.css");
  assert.match(
    css,
    /\*,\s*\*::before[\s\S]*?animation-duration:\s*0\.01ms/,
    "site must neutralise motion app-wide",
  );
});
