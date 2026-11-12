// Hearth Suite Records core tests (AC-RECORDS-1..4).

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateValue,
  validateRow,
  resolveLookup,
  applyLookup,
  runReport,
  reportToMergeRecords,
  parseCsv,
  inferSchema,
  buildQueryRequest,
  FIELD_TYPES,
  applyDefaults,
  nextAutoIncrement,
  computeRow,
  evalFormula,
  FILTER_OPS,
  opsForType,
  matchCondition,
  applyFilterSet,
  sortRows,
  findRows,
  parseDelimited,
  toDelimited,
  REPORT_AGGS,
  aggregateValues,
  buildReport,
  reportToText,
  reportMergeRecords,
  inferReportSpec,
} from "../src/core.mjs";

test("AC-RECORDS-1: flat form validation, no SQL", () => {
  assert.deepEqual(FIELD_TYPES, [
    "text",
    "email",
    "select",
    "status",
    "relation",
    "number",
    "date",
    "time",
    "bool",
    "formula",
    "auto",
  ]);
  assert.deepEqual(validateValue("number", "42"), { ok: true, value: 42 });
  assert.equal(validateValue("number", "abc").ok, false);
  assert.deepEqual(validateValue("bool", "yes"), { ok: true, value: true });
  // v1.0 typed fields: email validates; select/status/relation hold text refs.
  assert.deepEqual(validateValue("email", "sam@example.com"), {
    ok: true,
    value: "sam@example.com",
  });
  assert.equal(validateValue("email", "not-an-email").ok, false);
  assert.deepEqual(validateValue("status", "Active"), { ok: true, value: "Active" });
  assert.deepEqual(validateValue("relation", "Maria"), { ok: true, value: "Maria" });

  const fields = [
    { name: "name", datatype: "text" },
    { name: "age", datatype: "number" },
  ];
  const good = validateRow(fields, { name: "Ada", age: "36" });
  assert.ok(good.ok);
  assert.equal(good.values.age, 36);
  const bad = validateRow(fields, { name: "Ada", age: "x" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.age, "Enter a number");
});

test("AC-RECORDS-2: no-code relation / lookup between two tables", () => {
  const customers = [
    { id: "c1", name: "Maria" },
    { id: "c2", name: "Jon" },
  ];
  const orders = [
    { id: "o1", customerId: "c1", total: 40 },
    { id: "o2", customerId: "c2", total: 12 },
  ];
  const relation = { fromField: "customerId", toKey: "id", lookupField: "name" };

  assert.equal(resolveLookup(orders[0], relation, customers), "Maria");
  const joined = applyLookup(orders, relation, customers, "customer");
  assert.equal(joined[0].customer, "Maria");
  assert.equal(joined[1].customer, "Jon");
  // Whole-row lookup when no lookupField is given.
  assert.deepEqual(resolveLookup(orders[1], { fromField: "customerId", toKey: "id" }, customers), {
    id: "c2",
    name: "Jon",
  });
});

test("AC-RECORDS-3: report runs (filter/sort/project) and feeds a Writer merge", () => {
  const rows = [
    { name: "Maria", total: 40, region: "North" },
    { name: "Jon", total: 12, region: "South" },
    { name: "Ada", total: 99, region: "North" },
  ];
  const report = runReport(rows, {
    fields: ["name", "total"],
    filter: { field: "region", op: "eq", value: "North" },
    sort: { field: "total", dir: "desc" },
  });
  assert.deepEqual(report, [
    { name: "Ada", total: 99 },
    { name: "Maria", total: 40 },
  ]);

  // The same rows feed Writer's Compose-from-Data (mail-merge).
  const merge = reportToMergeRecords(report);
  assert.equal(merge[0].name, "Ada");
});

test("AC-RECORDS-4: smart CSV import infers fields and types", () => {
  const csv = 'Name,Age,Joined,Active\n"Ada",36,2020-01-15,yes\nLinus,54,2019-06-01,no';
  const { header, rows } = parseCsv(csv);
  assert.deepEqual(header, ["Name", "Age", "Joined", "Active"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "Ada");

  const schema = inferSchema(header, rows);
  assert.deepEqual(schema, [
    { name: "Name", datatype: "text" },
    { name: "Age", datatype: "number" },
    { name: "Joined", datatype: "date" },
    { name: "Active", datatype: "bool" },
  ]);

  // Ember refines the inference locally.
  const req = buildQueryRequest("show people who joined in 2020", "Name, Age, Joined, Active");
  assert.equal(req.task, "query");
});

test("CSV parsing handles quoted commas and newlines", () => {
  const { rows } = parseCsv('a,b\n"x,y","line1\nline2"');
  assert.equal(rows[0][0], "x,y");
  assert.equal(rows[0][1], "line1\nline2");
});

// ---- PW-2.6: field types, formulas, defaults, auto-number (D4/D5) ----------

test("D4: time validation, defaults, and auto-number", () => {
  assert.deepEqual(validateValue("time", "9:5".replace("5", "05")), { ok: true, value: "09:05" });
  assert.equal(validateValue("time", "25:00").ok, false);
  // Defaults fill blank, non-computed fields only.
  const fields = [
    { name: "Status", datatype: "text", default: "New" },
    { name: "Id", datatype: "auto" },
  ];
  assert.deepEqual(applyDefaults(fields, {}), { Status: "New" });
  assert.deepEqual(applyDefaults(fields, { Status: "Done" }), { Status: "Done" });
  // Auto-number is one past the current max.
  assert.equal(nextAutoIncrement([{ Id: 1 }, { Id: 4 }, { Id: 2 }], "Id"), 5);
  assert.equal(nextAutoIncrement([], "Id"), 1);
});

test("D5: formula fields compute, chain, and catch cycles (self-referential)", () => {
  assert.equal(evalFormula("[Price] * [Qty]", { Price: 10, Qty: 3 }), 30);
  assert.equal(evalFormula('IF([T] > 50, "big", "small")', { T: 80 }), "big");
  assert.equal(evalFormula('CONCAT([First], " ", [Last])', { First: "Ada", Last: "L" }), "Ada L");
  const fields = [
    { name: "Price", datatype: "number" },
    { name: "Qty", datatype: "number" },
    { name: "Subtotal", datatype: "formula", formula: "[Price]*[Qty]" },
    { name: "Tax", datatype: "formula", formula: "[Subtotal]*0.2" },
    { name: "Total", datatype: "formula", formula: "[Subtotal]+[Tax]" },
  ];
  const row = computeRow(fields, { Price: 10, Qty: 3 });
  assert.equal(row.Subtotal, 30);
  assert.equal(row.Tax, 6);
  assert.equal(row.Total, 36);
  // A reference cycle is flagged, not infinite-looped.
  const cyc = [
    { name: "A", datatype: "formula", formula: "[B]+1" },
    { name: "B", datatype: "formula", formula: "[A]+1" },
  ];
  assert.equal(computeRow(cyc, {}).A, "#CYCLE");
});

// ---- PW-2.6: filters, sort, find, delimited IO (D8/D9/D11/D17) -------------

test("D8: human-phrased operators and saved multi-condition filters", () => {
  assert.ok(FILTER_OPS.some((o) => o.label === "is after"));
  assert.ok(FILTER_OPS.some((o) => o.label === "is greater than"));
  assert.ok(opsForType("number").some((o) => o.id === "gt"));
  assert.ok(!opsForType("text").some((o) => o.id === "gt"));

  assert.equal(matchCondition("Hello world", "contains", "WORLD", "text"), true);
  assert.equal(matchCondition("2024-06-01", "after", "2024-01-01", "date"), true);
  assert.equal(matchCondition(99, "gt", 50, "number"), true);
  assert.equal(matchCondition("", "empty", null, "text"), true);

  const rows = [
    { Name: "Ada", Region: "North", Total: 99 },
    { Name: "Jon", Region: "South", Total: 12 },
    { Name: "Mai", Region: "North", Total: 40 },
  ];
  const fields = [
    { name: "Name", datatype: "text" },
    { name: "Region", datatype: "text" },
    { name: "Total", datatype: "number" },
  ];
  // match: all → North AND >50
  const all = applyFilterSet(
    rows,
    {
      match: "all",
      conditions: [
        { field: "Region", op: "is", value: "North" },
        { field: "Total", op: "gt", value: 50 },
      ],
    },
    fields,
  );
  assert.deepEqual(
    all.map((r) => r.Name),
    ["Ada"],
  );
  // match: any → South OR >90
  const any = applyFilterSet(
    rows,
    {
      match: "any",
      conditions: [
        { field: "Region", op: "is", value: "South" },
        { field: "Total", op: "gt", value: 90 },
      ],
    },
    fields,
  );
  assert.deepEqual(any.map((r) => r.Name).sort(), ["Ada", "Jon"]);
});

test("D9/D11: multi-key sort and find", () => {
  const rows = [
    { Region: "North", Total: 40 },
    { Region: "South", Total: 12 },
    { Region: "North", Total: 99 },
  ];
  const sorted = sortRows(rows, [
    { field: "Region", dir: "asc" },
    { field: "Total", dir: "desc" },
  ]);
  assert.deepEqual(
    sorted.map((r) => `${r.Region}:${r.Total}`),
    ["North:99", "North:40", "South:12"],
  );
  assert.equal(findRows(rows, "south").length, 1);
  assert.equal(findRows(rows, "99").length, 1);
  assert.equal(findRows(rows, "").length, 3);
});

test("D17: delimited import/export round-trips (CSV + TSV)", () => {
  const fields = [
    { name: "Name", datatype: "text" },
    { name: "Note", datatype: "text" },
  ];
  const rows = [
    { Name: "Ada", Note: "has, comma" },
    { Name: "Jon", Note: "plain" },
  ];
  const csv = toDelimited(fields, rows, ",");
  assert.match(csv, /^Name,Note/);
  assert.match(csv, /"has, comma"/);
  const parsed = parseDelimited(csv, ",");
  assert.deepEqual(parsed.header, ["Name", "Note"]);
  assert.equal(parsed.rows[0][1], "has, comma");
  // TSV
  const tsv = toDelimited(fields, rows, "\t");
  assert.equal(parseDelimited(tsv, "\t").rows[1][0], "Jon");
});

// ---- PW-2.7: Reports (ReportCreator heir, D12..D14) -----------------------

const REPORT_FIELDS = [
  { name: "Region", datatype: "text" },
  { name: "Category", datatype: "text" },
  { name: "Amount", datatype: "number" },
];
const REPORT_ROWS = [
  { Region: "North", Category: "A", Amount: 10 },
  { Region: "South", Category: "B", Amount: 7 },
  { Region: "North", Category: "A", Amount: 20 },
  { Region: "North", Category: "B", Amount: 5 },
];

test("D12: aggregates compute sum/count/average/min/max + Std-Dev/Variance (Works parity)", () => {
  assert.deepEqual(
    REPORT_AGGS.map((a) => a.id),
    ["sum", "count", "average", "min", "max", "stddev", "variance"],
  );
  assert.equal(aggregateValues([10, 20, 5], "sum"), 35);
  assert.equal(aggregateValues([10, 20, 5], "average"), 11.666667);
  assert.equal(aggregateValues([10, 20, 5], "min"), 5);
  assert.equal(aggregateValues([10, 20, 5], "max"), 20);
  assert.equal(aggregateValues(["a", "b", "", null], "count"), 2);
  // The two Works ReportCreator summaries that were missing. Sample (n-1):
  // mean 5, deviations [-3,-1,1,3] → variance (9+1+1+9)/3 = 6.666667, stddev √.
  assert.equal(aggregateValues([2, 4, 6, 8], "variance"), 6.666667);
  assert.equal(aggregateValues([2, 4, 6, 8], "stddev"), 2.581989);
  assert.equal(aggregateValues([42], "variance"), 0); // <2 values → 0, no NaN
});

test("D12/D13: buildReport groups with per-group and grand summaries", () => {
  const report = buildReport(
    REPORT_ROWS,
    {
      title: "Sales by region",
      columns: ["Region", "Category", "Amount"],
      groupBy: "Region",
      summaries: [
        { field: "Amount", agg: "sum" },
        { field: "Amount", agg: "average" },
      ],
    },
    REPORT_FIELDS,
  );
  assert.equal(report.grouped, true);
  assert.deepEqual(
    report.groups.map((g) => g.key),
    ["North", "South"],
  );
  assert.equal(report.groups[0].rows.length, 3);
  assert.equal(report.groups[0].summaries[0].value, 35); // North sum
  assert.equal(report.groups[1].summaries[0].value, 7); // South sum
  assert.equal(report.grand[0].value, 42); // grand sum
  assert.equal(report.grand[1].value, 10.5); // grand average
});

test("D13: a report honours a filter before grouping", () => {
  const report = buildReport(
    REPORT_ROWS,
    {
      groupBy: "Category",
      summaries: [{ field: "Amount", agg: "sum" }],
      filter: { match: "all", conditions: [{ field: "Region", op: "is", value: "North" }] },
    },
    REPORT_FIELDS,
  );
  // Only North rows: A=30 (10+20), B=5.
  const byKey = Object.fromEntries(report.groups.map((g) => [g.key, g.summaries[0].value]));
  assert.deepEqual(byKey, { A: 30, B: 5 });
});

test("D14: report renders to text and to Writer merge records", () => {
  const report = buildReport(
    REPORT_ROWS,
    {
      title: "Totals",
      columns: ["Region", "Amount"],
      groupBy: "Region",
      summaries: [{ field: "Amount", agg: "sum" }],
    },
    REPORT_FIELDS,
  );
  const text = reportToText(report);
  assert.match(text, /Region: North/);
  assert.match(text, /Total Amount: 35/);
  assert.match(text, /Grand totals/);
  const merge = reportMergeRecords(report);
  assert.equal(merge.length, 4);
  assert.deepEqual(merge[0], { Region: "North", Amount: "10" });
});

test("D12: Ember one-liner infers a report spec locally", () => {
  const a = inferReportSpec("average amount by category", REPORT_FIELDS);
  assert.equal(a.groupBy, "Category");
  assert.deepEqual(a.summaries, [{ field: "Amount", agg: "average" }]);
  const b = inferReportSpec("totals by region", REPORT_FIELDS);
  assert.equal(b.groupBy, "Region");
  assert.equal(b.summaries[0].agg, "sum");
  // The new Works-parity summaries are recognised from a plain phrase.
  assert.equal(
    inferReportSpec("standard deviation of amount by region", REPORT_FIELDS).summaries[0].agg,
    "stddev",
  );
  assert.equal(
    inferReportSpec("variance of amount per category", REPORT_FIELDS).summaries[0].agg,
    "variance",
  );
});
