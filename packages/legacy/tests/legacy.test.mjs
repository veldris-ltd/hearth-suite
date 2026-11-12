// Hearth Suite legacy-import core tests (AC-WKS-G3, AC-LEG-1/2).

import test from "node:test";
import assert from "node:assert/strict";

import {
  translateWps,
  translateWks,
  translateWdb,
  importLegacy,
  formatImportReport,
} from "../src/legacy.mjs";

const sev = (report, s) => report.items.filter((i) => i.severity === s);

test("G3/.wps: runs, styles, tables, headers/footers, footnotes translate", () => {
  const { doc, footnotes, headerText, footerText, report } = translateWps({
    title: "Memo",
    header: "Acme Corp",
    footer: "Page",
    blocks: [
      { kind: "heading", level: 1, runs: [{ text: "Quarterly memo" }] },
      {
        kind: "paragraph",
        style: "Body",
        runs: [{ text: "Bold", bold: true }, { text: " and normal." }],
        footnotes: [{ text: "A clarifying note." }],
      },
      { kind: "table", rows: [[{ text: "A" }, { text: "B" }]] },
      { kind: "paragraph", style: "Fancy Heading", runs: [{ text: "x" }] },
    ],
  });
  assert.equal(doc.title, "Memo");
  assert.equal(doc.blocks[0].kind, "heading");
  assert.equal(doc.blocks[1].spans[0].bold, true);
  assert.equal(doc.blocks[2].kind, "table");
  assert.equal(footnotes.length, 1);
  assert.equal(headerText, "Acme Corp");
  assert.equal(footerText, "Page");
  // An unknown style is approximated and reported.
  assert.ok(sev(report, "degraded").some((i) => /Fancy Heading/.test(i.detail)));
});

test("G3/.wks: formulas kept; unknown functions flagged; charts re-created not rasterised", () => {
  const { cells, names, charts, report } = translateWks({
    name: "Budget",
    cells: [
      { ref: "A1", value: 10 },
      { ref: "A2", formula: "SUM(A1:A1)" },
      { ref: "A3", formula: "BESSELJ(A1,1)" }, // unsupported
    ],
    names: [{ name: "revenue", range: "A1:A3" }],
    charts: [
      {
        type: "column",
        title: "Sales",
        series: [{ name: "S", values: [1, 2, 3] }],
        categories: ["Q1", "Q2", "Q3"],
      },
      { type: "3-D Bar", title: "Sales 3D", series: [{ name: "S", values: [4, 5, 6] }] }, // decodable → flat bar
      { type: "Stacked Line", title: "Trend", series: [{ name: "S", values: [7, 8, 9] }] }, // → stacked-area
      { type: "radar", title: "Spider" }, // not re-creatable
      { type: "pie", title: "Pic", rasterised: true }, // stored as image
    ],
  });
  assert.equal(cells.A2, "=SUM(A1:A1)");
  assert.equal(names[0].name, "revenue");
  // Column → bar, plus the two decodable approximations re-created (not images).
  assert.deepEqual(
    charts.map((c) => c.type),
    ["bar", "bar", "stacked-area"],
  );
  assert.deepEqual(charts[0].series[0].values, [1, 2, 3]);
  // The 3-D and stacked-line charts are re-created but honestly flagged as flat.
  assert.ok(sev(report, "degraded").some((i) => /3-D Bar.*flat/i.test(i.detail)));
  assert.ok(sev(report, "degraded").some((i) => /Stacked Line.*flat stacked-area/i.test(i.detail)));
  // Unknown function + undecodable + rasterised chart all reported.
  assert.ok(sev(report, "degraded").some((i) => /BESSELJ/.test(i.detail)));
  assert.ok(sev(report, "lost").some((i) => /radar/i.test(i.detail)));
  assert.ok(sev(report, "lost").some((i) => /image/i.test(i.detail)));
  assert.equal(report.ok, false);
});

test("G3/.wdb: fields, formula fields, filters, and reports translate", () => {
  const { fields, rows, filters, reports, report } = translateWdb({
    name: "People",
    fields: [
      { name: "Name", type: "text" },
      { name: "Age", type: "number" },
      { name: "Adult", type: "formula", formula: "[Age]>=18" },
      { name: "Mood", type: "Sentiment" }, // unknown type
    ],
    rows: [{ Name: "Ada", Age: 36 }],
    filters: [
      {
        name: "Adults",
        match: "all",
        conditions: [
          { field: "Age", op: "greater than", value: 17 },
          { field: "Name", op: "weird-op", value: "x" },
        ],
      },
    ],
    reports: [
      {
        name: "By name",
        groupBy: "Name",
        // Average maps; Works' "Standard Deviation"/"Variance" now translate
        // faithfully (PW-2.7); a bogus aggregate must be reported, not silent.
        summaries: [
          { field: "Age", agg: "average" },
          { field: "Age", agg: "Standard Deviation" },
          { field: "Age", agg: "Variance" },
          { field: "Age", agg: "kurtosis" },
        ],
      },
    ],
  });
  assert.equal(fields[1].datatype, "number");
  assert.equal(fields[2].datatype, "formula");
  assert.equal(fields[2].formula, "[Age]>=18");
  assert.equal(rows.length, 1);
  // Works "greater than" → gt; unknown op approximated as contains (reported).
  assert.equal(filters[0].conditions[0].op, "gt");
  assert.equal(filters[0].conditions[1].op, "contains");
  assert.equal(reports[0].groupBy, "Name");
  assert.deepEqual(
    reports[0].summaries.map((s) => s.agg),
    ["average", "stddev", "variance", "sum"],
  );
  assert.ok(sev(report, "degraded").some((i) => /Sentiment/.test(i.detail)));
  assert.ok(sev(report, "degraded").some((i) => /weird-op/.test(i.detail)));
  // The unknown "kurtosis" summary is reported as degraded, not silently summed.
  assert.ok(sev(report, "degraded").some((i) => /kurtosis/.test(i.detail)));
});

test("G3/.wdb: filters/reports present but unreadable are reported honestly", () => {
  const { filters, reports, report } = translateWdb({
    fields: [{ name: "X", type: "text" }],
    filtersUnavailable: 2,
    reportsUnavailable: 1,
  });
  assert.equal(filters.length, 0);
  assert.equal(reports.length, 0);
  assert.ok(report.items.some((i) => /2 filter/.test(i.detail)));
  assert.ok(report.items.some((i) => /1 report/.test(i.detail)));
});

test("AC-LEG-2: a corrupt/partial file extracts what it can and never throws", () => {
  const result = importLegacy("wps", {
    error: "truncated at byte 4096",
    blocks: [{ kind: "paragraph", runs: [{ text: "what survived" }] }],
  });
  assert.equal(result.doc.blocks[0].spans[0].text, "what survived");
  assert.ok(result.report.items.some((i) => /part of the file/.test(i.detail)));
  // Unknown format is reported, not thrown.
  const bad = importLegacy("xyz", {});
  assert.equal(bad.report.ok, false);
});

test("report renders to plain language for the user", () => {
  const { report } = translateWks({
    cells: [{ ref: "A1", value: 1 }],
    charts: [{ type: "radar", title: "R" }],
  });
  const text = formatImportReport(report);
  assert.match(text, /Imported your WKS file/);
  assert.match(text, /Not converted:/);
  // A fully-clean import says so.
  const clean = translateWps({ blocks: [{ kind: "paragraph", runs: [{ text: "hi" }] }] });
  assert.match(formatImportReport(clean.report), /full fidelity/);
});
