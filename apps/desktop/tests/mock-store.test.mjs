// Contract tests for the preview store (mock-store.mjs).
//
// These assert the exact behaviour the UI relies on through HearthClient:
// tables/fields/rows/documents, including update-reflects, delete-removes,
// list_fields, and list_documents. The real Tauri/Rust core must honour the
// same contract, when it lands, point an equivalent suite at it.

import test from "node:test";
import assert from "node:assert/strict";

import { createMockStore } from "../src/mock-store.mjs";

test("contract: table → fields → rows lifecycle", () => {
  const s = createMockStore();
  const table = s.createTable("b1", "People");
  const fName = s.addField(table, "Name", "text");
  const fAge = s.addField(table, "Age", "number");

  // list_fields returns what was added, with ids and types.
  assert.deepEqual(s.listFields(table), [
    { id: fName, name: "Name", datatype: "text" },
    { id: fAge, name: "Age", datatype: "number" },
  ]);

  // insert + query
  const r1 = s.insertRow(table, [{ field_id: fName, value: { text: "Ada" } }]);
  s.insertRow(table, [{ field_id: fName, value: { text: "Linus" } }]);
  assert.equal(s.queryRows(table).length, 2);
  assert.equal(s.queryRows(table)[0].id, r1);
});

test("contract: update_row reflects on the next query (no silent loss)", () => {
  const s = createMockStore();
  const table = s.createTable("b1", "T");
  const f = s.addField(table, "Name", "text");
  const rowId = s.insertRow(table, [{ field_id: f, value: { text: "Ada" } }]);

  s.updateRow(rowId, [{ field_id: f, value: { text: "Ada Lovelace" } }]);
  const rows = s.queryRows(table);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].values, [{ field_id: f, value: { text: "Ada Lovelace" } }]);
});

test("contract: delete_row removes the row", () => {
  const s = createMockStore();
  const table = s.createTable("b1", "T");
  const a = s.insertRow(table, [{ field_id: "f1", value: { text: "A" } }]);
  s.insertRow(table, [{ field_id: "f1", value: { text: "B" } }]);
  s.deleteRow(a);
  const rows = s.queryRows(table);
  assert.equal(rows.length, 1);
  assert.equal(
    rows.every((r) => r.id !== a),
    true,
  );
});

test("contract: list_tables scopes to a bundle", () => {
  const s = createMockStore();
  s.createTable("b1", "One");
  s.createTable("b1", "Two");
  s.createTable("b2", "Other");
  assert.deepEqual(
    s.listTables("b1").map((t) => t.name),
    ["One", "Two"],
  );
  assert.equal(s.listTables("b2").length, 1);
});

test("contract: documents save and list per bundle", () => {
  const s = createMockStore();
  const d1 = s.saveDocument("b1", "writer");
  s.saveDocument("b1", "sheet");
  s.saveDocument("b2", "writer");
  const docs = s.listDocuments("b1");
  assert.equal(docs.length, 2);
  assert.equal(docs[0].id, d1.id);
  assert.deepEqual(
    docs.map((d) => d.doc_type),
    ["writer", "sheet"],
  );
  assert.equal(s.listDocuments("b2").length, 1);
});

test("contract: documents carry a title and content; reorder persists (Portfolio)", () => {
  const s = createMockStore();
  const a = s.saveDocument("b1", "writer", "Cover letter", "QUJD"); // base64 "ABC"
  const b = s.saveDocument("b1", "sheet", "Budget", "REVG");
  const c = s.saveDocument("b1", "record", "People", "");
  assert.deepEqual(
    s.listDocuments("b1").map((d) => d.title),
    ["Cover letter", "Budget", "People"],
  );
  assert.equal(s.getDocument(a.id).content_base64, "QUJD");
  assert.equal(s.getDocument(b.id).content_base64, "REVG");

  // Drag-reorder: People, Cover letter, Budget.
  s.reorderDocuments("b1", [c.id, a.id, b.id]);
  assert.deepEqual(
    s.listDocuments("b1").map((d) => d.title),
    ["People", "Cover letter", "Budget"],
  );
});

test("contract: seeded demo tables are present", () => {
  const s = createMockStore({ tables: [{ bundleId: "b3", name: "Contacts" }] });
  assert.deepEqual(
    s.listTables("b3").map((t) => t.name),
    ["Contacts"],
  );
});
