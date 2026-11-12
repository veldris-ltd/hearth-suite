// Hearth Suite charts core tests (AC-WKS-X7 / X8).

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHART_TYPES,
  extractChartData,
  suggestChartType,
  makeChartSpec,
  renderChartSvg,
} from "../src/charts.mjs";

test("X7: chart type catalogue covers bar/line/pie/area/scatter + stacked", () => {
  const ids = CHART_TYPES.map((t) => t.id);
  for (const want of ["bar", "line", "pie", "area", "scatter", "stacked-bar", "stacked-area"]) {
    assert.ok(ids.includes(want), `missing ${want}`);
  }
});

test("X7: extractChartData reads header + categories + named series", () => {
  const grid = [
    ["Month", "North", "South"],
    ["Jan", 10, 5],
    ["Feb", 20, 8],
  ];
  const { categories, series } = extractChartData(grid);
  assert.deepEqual(categories, ["Jan", "Feb"]);
  assert.equal(series.length, 2);
  assert.equal(series[0].name, "North");
  assert.deepEqual(series[0].values, [10, 20]);
  assert.deepEqual(series[1].values, [5, 8]);
});

test("X7: single-column grid becomes one indexed series", () => {
  const { categories, series } = extractChartData([[3], [6], [9]]);
  assert.deepEqual(categories, ["1", "2", "3"]);
  assert.deepEqual(series[0].values, [3, 6, 9]);
});

test("X8: suggestChartType proposes a sensible default from the data", () => {
  // Time-like categories → line.
  assert.equal(
    suggestChartType([
      ["Q1", 5],
      ["Q2", 7],
      ["Q3", 9],
    ]),
    "line",
  );
  // Single small series of names → pie.
  assert.equal(
    suggestChartType([
      ["Apples", 5],
      ["Pears", 7],
      ["Plums", 2],
    ]),
    "pie",
  );
  // Two numeric columns → scatter.
  assert.equal(
    suggestChartType([
      [1, 10],
      [2, 14],
      [3, 9],
      [4, 18],
    ]),
    "scatter",
  );
  // Several series → grouped bar.
  assert.equal(
    suggestChartType([
      ["Team", "Won", "Lost"],
      ["A", 4, 1],
      ["B", 2, 3],
      ["C", 5, 6],
      ["D", 1, 7],
      ["E", 3, 2],
      ["F", 6, 1],
      ["G", 2, 2],
    ]),
    "bar",
  );
});

test("X7: makeChartSpec fills a default type and carries source", () => {
  const spec = makeChartSpec({
    title: "Sales",
    grid: [
      ["Month", "Sales"],
      ["Jan", 10],
      ["Feb", 20],
    ],
    source: { kind: "sheet", bundleId: "b1", sheet: "Sheet1", range: "A1:B3" },
  });
  assert.equal(spec.title, "Sales");
  assert.ok(CHART_TYPES.some((t) => t.id === spec.type));
  assert.equal(spec.source.range, "A1:B3");
  assert.equal(spec.series.length, 1);
});

test("X7: renderChartSvg emits valid type-appropriate SVG for every type", () => {
  const data = {
    categories: ["Jan", "Feb", "Mar"],
    series: [
      { name: "North", values: [10, 20, 15] },
      { name: "South", values: [5, 8, 12] },
    ],
  };
  const make = (type) => renderChartSvg({ id: "c", title: "T", type, ...data });

  for (const type of ["bar", "line", "area", "pie", "scatter", "stacked-bar", "stacked-area"]) {
    const svg = make(type);
    assert.match(svg, /^<svg /, `${type} should start with <svg`);
    assert.match(svg, /<\/svg>$/, `${type} should close`);
    assert.match(svg, />T<\/text>/, `${type} should render the title`);
  }
  assert.match(make("bar"), /<rect /);
  assert.match(make("line"), /<polyline /);
  assert.match(make("area"), /<path /);
  assert.match(make("pie"), /<path /);
  assert.match(make("scatter"), /<circle /);
  // A multi-series chart gets a legend.
  assert.match(make("bar"), /hb-chart__legend/);
});

test("X7: renderChartSvg degrades gracefully with no data", () => {
  const svg = renderChartSvg({ id: "c", title: "", type: "bar", categories: [], series: [] });
  assert.match(svg, /No data to chart/);
});
