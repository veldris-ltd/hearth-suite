import test from "node:test";
import assert from "node:assert/strict";

import { parseSheetCsv } from "../src/sheet-merge.mjs";

test("P2-CL1: parses a Sheets CSV export into header-keyed merge records", () => {
  const csv = "Name,Email\nMaria,maria@example.com\nSam,sam@example.com";
  assert.deepEqual(parseSheetCsv(csv), [
    { Name: "Maria", Email: "maria@example.com" },
    { Name: "Sam", Email: "sam@example.com" },
  ]);
});

test("P2-CL1: honours quoted fields containing commas", () => {
  const csv = 'Name,Address\nMaria,"12 High St, London"';
  assert.deepEqual(parseSheetCsv(csv), [{ Name: "Maria", Address: "12 High St, London" }]);
});

test("P2-CL1: a header with no data rows yields no records", () => {
  assert.deepEqual(parseSheetCsv("Name,Email"), []);
  assert.deepEqual(parseSheetCsv(""), []);
});

test("P2-CL1: short rows and blank cells fill empty, unnamed columns drop", () => {
  const csv = "A,B,C\n1,,";
  assert.deepEqual(parseSheetCsv(csv), [{ A: "1", B: "", C: "" }]);
  // An empty header cell is not turned into a field.
  assert.deepEqual(parseSheetCsv("A,,C\nx,y,z"), [{ A: "x", C: "z" }]);
});

test("P2-CL1: a doubled quote inside a quoted field is unescaped", () => {
  const csv = 'Note\n"she said ""hi"""';
  assert.deepEqual(parseSheetCsv(csv), [{ Note: 'she said "hi"' }]);
});
