import test from "node:test";
import assert from "node:assert/strict";

import { parseChartEntry, serializeChartEntry } from "../src/chart-store.mjs";

const DATA = { categories: ["Jan", "Feb"], series: [{ name: "North", values: [10, 20] }] };

test("P2-CL2: a chart entry round-trips through serialize/parse", () => {
  const key = "bundle-1::SHEET1::A1:C4";
  const entry = parseChartEntry(serializeChartEntry(key, DATA));
  assert.equal(entry.key, key);
  assert.deepEqual(entry.data, DATA);
});

test("P2-CL2: malformed or incomplete bodies parse to null", () => {
  assert.equal(parseChartEntry("not json"), null);
  assert.equal(parseChartEntry("{}"), null); // no key/data
  assert.equal(parseChartEntry(JSON.stringify({ key: "k" })), null); // no data
  assert.equal(parseChartEntry(JSON.stringify({ data: DATA })), null); // no key
  assert.equal(parseChartEntry(JSON.stringify({ key: 1, data: DATA })), null); // key not a string
});

test("P2-CL2: hydration keeps the latest entry per key (map semantics)", () => {
  // Mimic the host's hydrate loop: decode entries and set into a Map; a later
  // document for the same key wins.
  const bridge = new Map();
  const docs = [
    serializeChartEntry("b::S1::A1:B2", { categories: ["x"], series: [] }),
    serializeChartEntry("b::S1::A1:B2", DATA),
  ];
  for (const body of docs) {
    const entry = parseChartEntry(body);
    if (entry) bridge.set(entry.key, entry.data);
  }
  assert.deepEqual(bridge.get("b::S1::A1:B2"), DATA);
});
