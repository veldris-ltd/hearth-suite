// Unit tests for the pure lexicon core (src/lexicon.mjs) + bundled data.
// Run with `node --test`. No network, no build step.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createLexicon, normalize } from "../src/lexicon.mjs";

const data = JSON.parse(readFileSync(new URL("../src/data.json", import.meta.url), "utf8"));
const lex = createLexicon(data.entries);

test("bundled data is a CC0 original sample with a stated FFI seam", () => {
  assert.match(data.license, /CC0/);
  assert.match(data.license, /FFI|WordNet|Wiktionary/);
  assert.ok(lex.size >= 30);
});

test("dictionary lookup returns definitions, fully offline", () => {
  const entry = lex.lookup("calm");
  assert.equal(entry.word, "calm");
  assert.ok(entry.definitions.length >= 1);
  assert.match(entry.definitions[0], /peaceful|disturbance/i);
});

test("thesaurus returns synonyms and antonyms", () => {
  assert.ok(lex.synonyms("warm").includes("cosy"));
  assert.ok(lex.antonyms("warm").includes("cold"));
});

test("normalize strips case, whitespace, and punctuation", () => {
  assert.equal(normalize("  Calm! "), "calm");
  assert.equal(normalize("Home,"), "home");
});

test("morphological fallback resolves inflected forms to the base word", () => {
  assert.equal(lex.lookup("calmly")?.word, "calm");
  assert.equal(lex.lookup("writing")?.word, "write");
  assert.equal(lex.lookup("boxes") ? "hit" : "miss", "miss"); // unknown base stays a miss
  assert.equal(lex.lookup("helps")?.word, "help");
});

test("unknown words return null / empty, never throw", () => {
  assert.equal(lex.lookup("zzqx"), null);
  assert.deepEqual(lex.define("zzqx"), []);
  assert.deepEqual(lex.synonyms(""), []);
  assert.equal(lex.has("nope"), false);
});

test("createLexicon is the injectable seam (custom/FFI dataset)", () => {
  const custom = createLexicon({
    ember: {
      pos: "noun",
      definitions: ["A glowing piece of coal or wood."],
      synonyms: ["coal", "cinder"],
    },
  });
  assert.equal(custom.lookup("ember").definitions[0], "A glowing piece of coal or wood.");
  assert.ok(custom.synonyms("embers").includes("cinder")); // stemmed
  assert.equal(custom.lookup("calm"), null); // isolated from the bundled set
});
