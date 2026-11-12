// Dynamic accessibility pass with axe-core (P2-Q1, AC-A11Y-*).
//
// Runs in the CI `a11y` job (ci/jobs/a11y.sh), which installs `axe-core` and
// `jsdom` into a separate directory at job time (AXE_TOOLS_DIR) since they are
// not part of the offline workspace. It loads each app/site HTML into a DOM and runs axe, failing on any
// serious or critical violation. The static structural gate (a11y.test.mjs) runs
// in every test stage; this is the dynamic complement.
//
// Usage: node apps/e2e/axe-ci.mjs

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

function pages() {
  const list = ["apps/desktop/index.html", "apps/mobile/index.html", "apps/admin/index.html"];
  // hearth-suite.app is scanned as BUILT (node site/build.mjs -> dist/site), so
  // the shared head/header/footer partials are in place. Absent in the public
  // export, where /site is not shipped.
  const siteDir = new URL("dist/site/", ROOT);
  if (existsSync(siteDir)) {
    for (const e of readdirSync(siteDir, { withFileTypes: true, recursive: true })) {
      if (e.isFile() && e.name.endsWith(".html")) {
        const parent = (e.parentPath ?? e.path).replace(/\\/g, "/");
        list.push(`${parent.slice(parent.indexOf("dist/site")).replace(/\/$/, "")}/${e.name}`);
      }
    }
  }
  return list.filter((rel) => existsSync(new URL(rel, ROOT)));
}

async function main() {
  let JSDOM;
  let axeSource;
  try {
    // The tools are installed outside the pnpm workspace (AXE_TOOLS_DIR, see
    // ci/jobs/a11y.sh); without it they resolve from the repository root.
    const base = process.env.AXE_TOOLS_DIR
      ? join(process.env.AXE_TOOLS_DIR, "package.json")
      : fileURLToPath(new URL("../../package.json", import.meta.url));
    const require = createRequire(base);
    ({ JSDOM } = require("jsdom"));
    // axe-core ships a single UMD source we evaluate inside each jsdom window.
    axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    console.error(
      "axe-core / jsdom not installed. Run ci/jobs/a11y.sh, or set AXE_TOOLS_DIR to a\n" +
        "directory where `npm i axe-core jsdom` was run.\n" +
        "(They are intentionally not in the offline workspace lockfile.)",
    );
    process.exit(2);
  }

  let failures = 0;
  for (const rel of pages()) {
    const html = readFileSync(new URL(rel, ROOT), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
    const { window } = dom;
    window.eval(axeSource);
    const results = await window.axe.run(window.document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (serious.length > 0) {
      failures += serious.length;
      console.error(`\n${rel}: ${serious.length} serious/critical violation(s)`);
      for (const v of serious) {
        console.error(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
      }
    } else {
      console.log(`${rel}: no serious/critical violations`);
    }
  }

  if (failures > 0) {
    console.error(`\naxe found ${failures} serious/critical violation(s).`);
    process.exit(1);
  }
  console.log("\naxe: no serious or critical violations.");
}

await main();
