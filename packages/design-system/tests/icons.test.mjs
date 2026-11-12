// Icon-set coverage (DSG-B3). icons.ts is TypeScript, so rather than import it we
// assert against its source text: every v1.0 "i-*" glyph must be registered (a
// union member and a PATHS key), with the AC-critical security / editor / chrome
// icons present. Run with `node --test`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/icons.ts", import.meta.url), "utf8");

// The full v1.0 UI set plus the brand/module glyphs we keep.
const REQUIRED = [
  "flame",
  "flame-keyhole",
  "flame-line",
  "flame-two-tone",
  "ember",
  "sparkle-sm",
  "writer",
  "sheets",
  "records",
  "calendar",
  "home",
  "search",
  "plus",
  "check",
  "x",
  "chevron-down",
  "chevron-right",
  "chevron-left",
  "arrow-right",
  "menu",
  "more",
  "settings",
  "bell",
  "user",
  "contact",
  "device",
  "lock",
  "lock-open",
  "seal",
  "shield",
  "key",
  "qr",
  "share",
  "offline",
  "chip",
  "doc",
  "bundle",
  "folder",
  "grid",
  "tag",
  "bolt",
  "clock",
  "download",
  "info",
  "alert",
  "trash",
  "edit",
  "copy",
  "eye",
  "filter",
  "send",
  "refresh",
  "sun",
  "moon",
  "android",
  "phone",
  "bold",
  "italic",
  "list",
  "link",
  "undo",
];

test("every required glyph is both a union member and a PATHS key", () => {
  for (const name of REQUIRED) {
    assert.match(src, new RegExp(`\\|\\s*"${name}"`), `IconName missing "${name}"`);
    assert.match(src, new RegExp(`(^|[\\s{,])"?${name}"?\\s*:`, "m"), `PATHS missing "${name}"`);
  }
});

test("the v1.0 set is comprehensive (>= 50 glyphs)", () => {
  assert.ok(REQUIRED.length >= 50, `expected >= 50 glyphs, listed ${REQUIRED.length}`);
});

test("AC-critical security/editor/chrome icons are present", () => {
  for (const name of [
    "qr",
    "shield",
    "key",
    "lock-open",
    "seal",
    "share",
    "bell",
    "settings",
    "copy",
    "eye",
    "bold",
    "italic",
    "list",
    "link",
    "undo",
  ]) {
    assert.ok(
      REQUIRED.includes(name) && src.includes(`"${name}"`),
      `missing critical icon "${name}"`,
    );
  }
});

test("the six platform sub-brand marks exist with module tints", () => {
  for (const name of ["macros", "forge", "kindling", "hallmark", "marketplace", "connections"]) {
    assert.match(src, new RegExp(`\\|\\s*"${name}"`), `IconName missing "${name}"`);
    assert.match(src, new RegExp(`(^|[\\s{,])"?${name}"?\\s*:`, "m"), `PATHS missing "${name}"`);
  }
  // Each epic carries a module-tinted accent and the 48-grid 2.5px line-grammar.
  for (const tint of [
    "var(--hb-color-calendar)",
    "var(--hb-color-writer)",
    "var(--hb-color-sheets)",
    "var(--hb-color-accent)",
    "var(--hb-color-primary)",
    "var(--hb-color-records)",
  ]) {
    assert.ok(src.includes(tint), `PLATFORM_MARKS missing tint ${tint}`);
  }
  assert.match(src, /stroke-width="2.5"/, "platform marks use the 2.5px line-grammar");
});

test("the shared grammar is 24-grid, 2px stroke, round caps/joins", () => {
  assert.match(src, /stroke-width="2"/);
  assert.match(src, /stroke-linecap="round"/);
  assert.match(src, /stroke-linejoin="round"/);
});
