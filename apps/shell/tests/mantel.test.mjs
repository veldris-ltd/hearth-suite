// The Mantel core tests (AC-UX-MANTEL-1..3).

import test from "node:test";
import assert from "node:assert/strict";

import {
  rankResults,
  routeForResult,
  MODULES,
  DEFAULT_SECTIONS,
  ADVANCED_SECTIONS,
  isAdvanced,
  friendlyDate,
  sortRecentsByDate,
} from "../src/core.mjs";

const items = [
  { id: "d1", kind: "document", title: "Project plan", module: "writer", bundleId: "b1" },
  {
    id: "s1",
    kind: "document",
    title: "Budget sheet",
    snippet: "quarterly numbers",
    module: "sheets",
    bundleId: "b1",
  },
  { id: "r1", kind: "record", title: "Contact: Maria", module: "records", bundleId: "b1" },
  { id: "c1", kind: "calendar", title: "Project review", module: "calendar", bundleId: "b1" },
];

test("MANTEL-2: universal search spans documents, records, and calendar", () => {
  const results = rankResults("project", items);
  const kinds = new Set(results.map((r) => r.kind));
  assert.ok(kinds.has("document"), "matches a document");
  assert.ok(kinds.has("calendar"), "matches a calendar entry");
  assert.equal(results.length, 2);

  const everything = rankResults("maria", items);
  assert.equal(everything[0]?.kind, "record");
});

test("MANTEL-2: a result opens the right module", () => {
  assert.equal(routeForResult(items[2]), "records");
  assert.equal(routeForResult(items[3]), "calendar");
  assert.equal(routeForResult(items[1]), "sheets");
  // Falls back to kind when no explicit module is set.
  assert.equal(routeForResult({ id: "x", kind: "calendar", title: "x" }), "calendar");
});

test("search requires all terms (AND) and ranks title matches higher", () => {
  const found = rankResults("budget quarterly", items);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "s1");

  // 'project' is a title, 'budget' is a different item's title -> no single match.
  assert.equal(rankResults("project budget", items).length, 0);

  // An empty query yields nothing (no clutter).
  assert.equal(rankResults("   ", items).length, 0);
});

test("WKS-S3: History shows a plain date and orders newest first", () => {
  // friendlyDate: plain, locale-independent, UTC; tolerant of missing/bad input.
  assert.equal(friendlyDate("2026-06-09T16:20:00Z"), "9 Jun 2026");
  assert.equal(friendlyDate("2026-01-01T00:00:00Z"), "1 Jan 2026");
  assert.equal(friendlyDate(undefined), null);
  assert.equal(friendlyDate("not-a-date"), null);

  // sortRecentsByDate: most-recent first; undated Bundles sink to the end,
  // keeping their relative order; the input array is not mutated.
  const input = [
    { id: "a", updatedAt: "2026-05-28T09:05:00Z" },
    { id: "b" },
    { id: "c", updatedAt: "2026-06-10T08:15:00Z" },
    { id: "d", updatedAt: "2026-06-02T11:40:00Z" },
    { id: "e" },
  ];
  const sorted = sortRecentsByDate(input);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["c", "d", "a", "b", "e"],
  );
  // Pure: original order preserved.
  assert.equal(input[0].id, "a");
});

test("MANTEL-1/3: calm default shows core sections and hides advanced controls", () => {
  for (const section of ["greeting", "quick-create", "search", "recent"]) {
    assert.ok(DEFAULT_SECTIONS.includes(section), `default shows ${section}`);
  }
  for (const section of ADVANCED_SECTIONS) {
    assert.ok(isAdvanced(section), `${section} is advanced`);
    assert.ok(!DEFAULT_SECTIONS.includes(section), `default hides ${section}`);
  }
  // Quick-create offers exactly the four modules.
  assert.equal(MODULES.length, 4);
  assert.deepEqual(
    MODULES.map((m) => m.id),
    ["writer", "sheets", "records", "calendar"],
  );
});
