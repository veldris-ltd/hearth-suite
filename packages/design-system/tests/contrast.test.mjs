// WCAG 2.1 AA verification for the Hearth Suite design tokens v1.0 (AC-A11Y-1, AC-DS-2).
//
// Computes contrast ratios from src/tokens.json for both themes and asserts the
// documented v1.0 pairings, plus the brand identity invariants (accent = the seal
// teal trust colour, the hero/flame stays warm, elevation shadows stay warm).
//
// Run with `node --test`. No build step or browser required. Only opaque 6-digit
// hex tokens are asserted; the rgba `overlay`/`ring` tokens are never measured.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync(new URL("../src/tokens.json", import.meta.url), "utf8"));

function channelToLinear(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Foreground/background pairs and the minimum ratio each must meet. Thresholds
// track the v1.0 handoff's documented ratios (text 12.4:1, text-muted 5.6:1,
// white-on-primary 4.95:1, white-on-accent 6.34:1, sealed-text 6.6:1).
const PAIRS = [
  ["text", "surface", 12],
  ["text", "bg", 12],
  ["text-muted", "surface", 5.5],
  ["text-muted", "bg", 5.5],
  ["text-on-primary", "primary", 4.5],
  ["sealed-text", "sealed-bg", 6.6],
];

for (const theme of ["light", "dark"]) {
  const c = tokens.semantic[theme];

  test(`${theme} theme: documented contrast pairings hold`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(c[fg], c[bg]);
      assert.ok(ratio >= min, `${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need >= ${min})`);
    }
  });
}

// The sealed/trust accent carries white text only in light (light teal #5FB3A8 in
// dark is paired with dark text, not white). Measured 6.34:1, see README.
test("light: white text on the seal/trust accent meets AA (>= 6.3)", () => {
  const c = tokens.semantic.light;
  const ratio = contrast(c["text-on-primary"], c.accent);
  assert.ok(ratio >= 6.3, `light: white on accent = ${ratio.toFixed(2)}:1 (need >= 6.3)`);
});

function channels(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), b: parseInt(h.slice(4, 6), 16) };
}

test("the accent is the seal teal trust colour (cool, not warm)", () => {
  for (const theme of ["light", "dark"]) {
    const { r, b } = channels(tokens.semantic[theme].accent);
    assert.ok(b > r, `${theme}: accent should read as teal (blue channel > red channel)`);
  }
});

test("the brand hero stays warm ember (not corporate blue)", () => {
  for (const theme of ["light", "dark"]) {
    for (const key of ["brand-flame", "primary"]) {
      const { r, b } = channels(tokens.semantic[theme][key]);
      assert.ok(r > b, `${theme}: ${key} should be warm (red channel > blue channel)`);
    }
  }
});

test("the seal/trust accent is distinct from the brand hero", () => {
  for (const theme of ["light", "dark"]) {
    const c = tokens.semantic[theme];
    assert.notEqual(c.accent, c["brand-flame"], `${theme}: accent and brand-flame must differ`);
  }
});

test("elevation shadows stay warm in light and neutral-black in dark", () => {
  assert.ok(
    tokens.elevation.light["2"].includes("rgba(45,29,18"),
    "light elevation should use warm brown shadow",
  );
  assert.ok(
    tokens.elevation.dark["2"].includes("rgba(0,0,0"),
    "dark elevation should use black shadow",
  );
});
