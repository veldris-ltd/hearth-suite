// Hearth Suite help core tests (AC-WKS-G4).

import test from "node:test";
import assert from "node:assert/strict";

import {
  HELP_TOPICS,
  COACH,
  coachDismissed,
  dismissCoach,
  coachFor,
  helpForModule,
  searchHelp,
  buildHelpRequest,
} from "../src/help.mjs";

/** A tiny in-memory storage stand-in for the dismissal seam. */
function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

test("G4: every module has coach tips and task-oriented topics", () => {
  for (const module of ["writer", "sheets", "records", "calendar"]) {
    assert.ok(coachFor(module), `${module} coach`);
    assert.ok(coachFor(module).tips.length >= 2);
    assert.ok(
      HELP_TOPICS.some((t) => t.module === module),
      `${module} topics`,
    );
  }
  assert.ok(HELP_TOPICS.some((t) => t.module === "general"));
  // Topics read as tasks ("how do I…"), not feature names.
  assert.ok(HELP_TOPICS.every((t) => t.task.length > 5 && t.answer.length > 10));
});

test("G4: helpForModule includes the module's topics plus general", () => {
  const writer = helpForModule("writer");
  assert.ok(writer.some((t) => t.module === "writer"));
  assert.ok(writer.some((t) => t.module === "general"));
  assert.ok(!writer.some((t) => t.module === "sheets"));
});

test("G4: search ranks task titles above keywords above answers", () => {
  const merge = searchHelp("mail merge");
  assert.equal(merge[0].id, "w-merge");
  const total = searchHelp("total a column");
  assert.equal(total[0].id, "s-sum");
  // Keyword-only match still surfaces (no "encrypt" in the title).
  const seal = searchHelp("encrypt");
  assert.equal(seal[0].id, "g-seal");
  // Empty query returns the whole corpus.
  assert.equal(searchHelp("").length, HELP_TOPICS.length);
});

test("G4: coach dismissal is one-tap and persists (per module)", () => {
  const store = memStore();
  assert.equal(coachDismissed("writer", store), false);
  dismissCoach("writer", store);
  assert.equal(coachDismissed("writer", store), true);
  // Other modules are unaffected.
  assert.equal(coachDismissed("sheets", store), false);
});

test("G4: Ember answers from the local corpus only", () => {
  const req = buildHelpRequest("how do I total a column");
  assert.equal(req.task, "query");
  // The document is the corpus; the most relevant topic leads.
  assert.match(req.document, /Hearth Suite help topics/);
  assert.match(req.document, /Total a column/);
  assert.match(req.request, /Using only the help topics above/);
  // Question is carried through.
  assert.match(req.request, /total a column/i);
});

test("COACH shape: title, lead, and tips present", () => {
  assert.equal(typeof COACH.writer.title, "string");
  assert.equal(typeof COACH.writer.lead, "string");
  assert.ok(Array.isArray(COACH.writer.tips));
});
