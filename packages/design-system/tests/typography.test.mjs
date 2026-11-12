// v1.0 typography verification (DSG-F2): the named type scale and the three
// vendored families. Asserts the scale matches the handoff (sizes, line-heights,
// letter-spacing) and that the serif/sans/mono assignment per step is correct.
//
// Run with `node --test`. Reads src/tokens.json, no build step required.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync(new URL("../src/tokens.json", import.meta.url), "utf8"));
const scale = tokens.type.scale;

// step -> [size, line-height, letter-spacing|null, family]
const EXPECTED = {
  display: ["3.75rem", "1.05", "-0.022em", "serif"],
  h1: ["2.5rem", "1.1", "-0.02em", "serif"],
  h2: ["2rem", "1.15", "-0.015em", "serif"],
  h3: ["1.5rem", "1.25", "-0.01em", "sans"],
  h4: ["1.25rem", "1.3", "-0.005em", "sans"],
  "body-lg": ["1.125rem", "1.6", null, "sans"],
  body: ["1rem", "1.6", null, "sans"],
  "body-sm": ["0.875rem", "1.5", null, "sans"],
  caption: ["0.75rem", "1.35", "0.01em", "sans"],
  code: ["0.875rem", "1.5", null, "mono"],
  overline: ["0.6875rem", "1.35", "0.12em", "sans"],
};

test("the type scale matches the v1.0 handoff (display -> overline)", () => {
  assert.deepEqual(
    Object.keys(scale),
    Object.keys(EXPECTED),
    "scale steps must match v1.0, in order",
  );
  for (const [step, [size, line, tracking, family]] of Object.entries(EXPECTED)) {
    const s = scale[step];
    assert.equal(s.size, size, `${step} size`);
    assert.equal(s.line, line, `${step} line-height`);
    assert.equal(s.tracking ?? null, tracking, `${step} letter-spacing`);
    assert.equal(s.family, family, `${step} serif/sans/mono assignment`);
  }
});

test("the three families are the vendored SIL OFL faces", () => {
  assert.match(tokens.type["font-serif"], /Literata/, "serif = Literata");
  assert.match(tokens.type["font-sans"], /Spline Sans/, "sans = Spline Sans");
  assert.match(tokens.type["font-mono"], /Spline Sans Mono/, "mono = Spline Sans Mono");
});

test("headings are serif, body/UI is sans, code is mono", () => {
  for (const step of ["display", "h1", "h2"])
    assert.equal(scale[step].family, "serif", `${step} serif`);
  for (const step of ["h3", "h4", "body", "body-sm", "caption", "overline"])
    assert.equal(scale[step].family, "sans", `${step} sans`);
  assert.equal(scale.code.family, "mono", "code is mono");
});
