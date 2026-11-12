// Clients are silent by default (AC-OBS-1): no Hearth Suite client package may depend
// on an analytics / telemetry / crash-reporting SDK. The optional cloud services
// (which DO emit aggregate metrics) are Rust crates excluded from the JS
// workspace, so they never appear here.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../../../", import.meta.url);

const FORBIDDEN = [
  "sentry",
  "segment",
  "mixpanel",
  "posthog",
  "amplitude",
  "analytics",
  "datadog",
  "rollbar",
  "bugsnag",
  "google-analytics",
  "gtag",
  "fullstory",
  "heap",
];

function workspacePackageJsons() {
  const files = [new URL("package.json", ROOT)];
  for (const group of ["apps/", "packages/"]) {
    const dir = new URL(group, ROOT);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = new URL(`${group}${entry.name}/package.json`, ROOT);
      if (existsSync(pkg)) files.push(pkg);
    }
  }
  return files;
}

test("AC-OBS-1: no client package depends on a telemetry/analytics SDK", () => {
  for (const file of workspacePackageJsons()) {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    });
    for (const dep of deps) {
      const lower = dep.toLowerCase();
      for (const bad of FORBIDDEN) {
        assert.ok(
          !lower.includes(bad),
          `${pkg.name ?? file.pathname} depends on a telemetry SDK matching "${bad}": ${dep}`,
        );
      }
    }
  }
});
