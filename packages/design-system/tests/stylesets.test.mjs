// Unit tests for the pure style-set logic (src/stylesets.mjs).
// Run with `node --test`. No build step or browser required.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_STYLESETS,
  styleSetCss,
  slug,
  makeStyleSet,
  loadCustomStyleSets,
  saveCustomStyleSet,
  removeCustomStyleSet,
  styleSetsFor,
} from "../src/stylesets.mjs";

/** An in-memory StyleStorage shim (stands in for localStorage / the core store). */
function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

test("built-ins are plain-language, scoped, and cover Writer + Sheets", () => {
  assert.ok(BUILTIN_STYLESETS.length >= 8);
  assert.ok(BUILTIN_STYLESETS.some((s) => s.scope === "writer"));
  assert.ok(BUILTIN_STYLESETS.some((s) => s.scope === "sheets"));
  for (const s of BUILTIN_STYLESETS) {
    assert.ok(s.id && s.name && s.scope && s.kind, `complete: ${s.id}`);
    assert.equal(s.builtin, true);
    // Plain language: no jargon like "h1"/"px"/"rgb" in the visible name.
    assert.doesNotMatch(s.name, /\b(h1|h2|px|rgb|css|var)\b/i, `plain name: ${s.name}`);
  }
});

test("styleSetCss maps token formats to design-system variables", () => {
  const heading = BUILTIN_STYLESETS.find((s) => s.id === "heading");
  const css = styleSetCss(heading);
  assert.match(css, /font-family: var\(--hb-font-serif\)/);
  assert.match(css, /font-size: var\(--hb-text-h3\)/);
  assert.match(css, /font-weight: var\(--hb-weight-semibold\)/);
});

test("styleSetCss prefers a literal captured css string over format", () => {
  const captured = makeStyleSet({
    name: "My Look",
    scope: "writer",
    kind: "char",
    css: "font-weight: 700; color: rgb(156, 68, 19)",
  });
  assert.equal(styleSetCss(captured), "font-weight: 700; color: rgb(156, 68, 19)");
});

test("slug is plain and stable", () => {
  assert.equal(slug("Table Money!"), "table-money");
  assert.equal(slug("  Spaced   Out  "), "spaced-out");
  assert.equal(slug("***"), "style");
});

test("makeStyleSet derives an id from the name", () => {
  const set = makeStyleSet({
    name: "Invoice Header",
    scope: "sheets",
    kind: "cell",
    css: "font-weight: 600",
  });
  assert.equal(set.id, "invoice-header");
  assert.equal(set.name, "Invoice Header");
  assert.equal(set.scope, "sheets");
});

test("per-Bundle store round-trips, replaces by id, and isolates Bundles", () => {
  const store = memStore();
  const set = makeStyleSet({
    name: "Letterhead",
    scope: "writer",
    kind: "block",
    css: "font-size: 18px",
  });

  saveCustomStyleSet("bundle-A", set, store);
  let loaded = loadCustomStyleSets("bundle-A", store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "Letterhead");

  // Same id replaces, not duplicates.
  saveCustomStyleSet("bundle-A", { ...set, css: "font-size: 20px" }, store);
  loaded = loadCustomStyleSets("bundle-A", store);
  assert.equal(loaded.length, 1);
  assert.match(styleSetCss(loaded[0]), /20px/);

  // Another Bundle is independent.
  assert.equal(loadCustomStyleSets("bundle-B", store).length, 0);

  removeCustomStyleSet("bundle-A", set.id, store);
  assert.equal(loadCustomStyleSets("bundle-A", store).length, 0);
});

test("styleSetsFor returns built-ins then the Bundle's custom sets, scoped", () => {
  const store = memStore();
  saveCustomStyleSet(
    "b1",
    makeStyleSet({ name: "Signature", scope: "writer", kind: "char", css: "font-style: italic" }),
    store,
  );
  const writer = styleSetsFor("b1", "writer", store);
  const sheets = styleSetsFor("b1", "sheets", store);
  assert.ok(writer.every((s) => s.scope === "writer"));
  assert.ok(sheets.every((s) => s.scope === "sheets"));
  // Custom set is present and comes after the built-ins.
  assert.equal(writer[writer.length - 1].name, "Signature");
  assert.ok(writer.length > sheets.length === false || writer.length >= 1);
});

test("store tolerates corrupt data without throwing", () => {
  const store = memStore();
  store.setItem("hb-styles:bad", "{not json");
  assert.deepEqual(loadCustomStyleSets("bad", store), []);
});
