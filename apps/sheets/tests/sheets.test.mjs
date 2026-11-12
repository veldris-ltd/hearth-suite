// Hearth Suite Sheets core tests (AC-SHEETS-1..3).

import test from "node:test";
import assert from "node:assert/strict";

import {
  Sheet,
  Workbook,
  pivot,
  suggestChart,
  explainFormula,
  buildFormulaRequest,
  toSpreadsheetModel,
  dataTableToRecords,
  recordsToDataTable,
  formatNumber,
  fillSeries,
  fillRangeRefs,
  autoSumFormula,
  FUNCTION_CATALOG,
  FUNCTION_NAMES,
  ERR_DIV0,
  ERR_CYCLE,
  ERR_NA,
  ERR_REF,
  adjustFormulaBody,
} from "../src/core.mjs";

/** Evaluate one formula on a fresh sheet seeded with `cells`. */
function evalOn(cells, formula) {
  const s = new Sheet();
  for (const [ref, raw] of Object.entries(cells)) s.setCell(ref, String(raw));
  s.setCell("Z99", formula);
  return s.valueOf("Z99");
}

test("AC-SHEETS-1: formula engine computes arithmetic, refs, ranges, functions", () => {
  const s = new Sheet();
  s.setCell("A1", "10").setCell("A2", "20").setCell("A3", "30");
  s.setCell("B1", "=A1+A2*2"); // precedence: 10 + 40
  s.setCell("B2", "=SUM(A1:A3)");
  s.setCell("B3", "=AVERAGE(A1:A3)");
  s.setCell("B4", '=IF(A1>5, "big", "small")');
  s.setCell("B5", "=(A1+A2)/0");

  assert.equal(s.valueOf("B1"), 50);
  assert.equal(s.valueOf("B2"), 60);
  assert.equal(s.valueOf("B3"), 20);
  assert.equal(s.valueOf("B4"), "big");
  assert.equal(s.valueOf("B5"), ERR_DIV0);
});

test("AC-SHEETS-1: named ranges and SUMIF", () => {
  const s = new Sheet();
  s.setCell("A1", "100").setCell("A2", "200").setCell("A3", "300");
  s.setName("revenue", "A1:A3");
  s.setCell("C1", "=SUM(revenue)");
  assert.equal(s.valueOf("C1"), 600);

  // "sum sales where region is North"
  s.setCell("R1", "North").setCell("R2", "South").setCell("R3", "North");
  s.setCell("S1", "5").setCell("S2", "7").setCell("S3", "9");
  s.setCell("C2", '=SUMIF(R1:R3, "North", S1:S3)');
  assert.equal(s.valueOf("C2"), 14);
});

test("AC-SHEETS-1: dependent cells recalc and cycles are caught", () => {
  const s = new Sheet();
  s.setCell("A1", "5").setCell("A2", "=A1*2").setCell("A3", "=A2+1");
  const values = s.recalc();
  assert.equal(values.A2, 10);
  assert.equal(values.A3, 11);

  s.setCell("Z1", "=Z2").setCell("Z2", "=Z1");
  assert.equal(s.valueOf("Z1"), ERR_CYCLE);
});

test("AC-SHEETS-1: pivot summaries and chart suggestion", () => {
  const rows = [
    { region: "North", sales: 5 },
    { region: "South", sales: 7 },
    { region: "North", sales: 9 },
  ];
  const summary = pivot(rows, "region", "sales", "sum");
  assert.deepEqual(summary, [
    { group: "North", value: 14 },
    { group: "South", value: 7 },
  ]);

  assert.equal(suggestChart([["North", 1]]), "pie");
  assert.equal(
    suggestChart([
      ["2021", 1],
      ["2022", 2],
      ["2023", 3],
      ["2024", 4],
      ["2025", 5],
      ["2026", 6],
      ["2027", 7],
    ]),
    "line",
  );
});

test("AC-SHEETS-1: plain-language explanation and local NL formula request", () => {
  assert.match(explainFormula('=SUMIF(A1:A9,">5")'), /adds the values that match/i);
  const req = buildFormulaRequest("sum sales where region is North", "A1:C9");
  assert.equal(req.task, "formula");
  assert.equal(req.request, "sum sales where region is North");
});

test("AC-SHEETS-2: grid maps to the ODF spreadsheet model for .xlsx round-trip", () => {
  const grid = [
    ["Name", "Qty"],
    ["Widgets", 42],
    ["", null],
  ];
  const model = toSpreadsheetModel("Sheet1", grid);
  assert.equal(model.sheets[0].name, "Sheet1");
  assert.deepEqual(model.sheets[0].rows[0].cells[0], { kind: "text", value: "Name" });
  assert.deepEqual(model.sheets[0].rows[1].cells[1], { kind: "number", value: 42 });
  assert.deepEqual(model.sheets[0].rows[2].cells[0], { kind: "empty" });
});

// ---- PW-2.4: function library (AC-WKS-X1..) -------------------------------

test("X: maths & statistical functions", () => {
  const cells = { A1: 10, A2: 20, A3: 30 };
  assert.equal(evalOn(cells, "=PRODUCT(A1:A3)"), 6000);
  assert.equal(evalOn(cells, "=MEDIAN(A1:A3)"), 20);
  assert.equal(evalOn(cells, "=STDEV(A1:A3)"), 10);
  assert.equal(evalOn(cells, "=MOD(10,3)"), 1);
  assert.equal(evalOn(cells, "=POWER(2,10)"), 1024);
  assert.equal(evalOn(cells, "=ROUNDUP(2.1,0)"), 3);
  assert.equal(evalOn(cells, "=SUMPRODUCT(A1:A3,A1:A3)"), 1400);
  assert.equal(evalOn(cells, "=LARGE(A1:A3,1)"), 30);
  assert.equal(evalOn(cells, "=SMALL(A1:A3,2)"), 20);
  assert.equal(evalOn(cells, "=GCD(12,18)"), 6);
});

test("X: conditional aggregates (SUMIFS/COUNTIFS/AVERAGEIF)", () => {
  const cells = { A1: "North", A2: "South", A3: "North", B1: 5, B2: 7, B3: 9 };
  assert.equal(evalOn(cells, '=SUMIFS(B1:B3,A1:A3,"North")'), 14);
  assert.equal(evalOn(cells, '=COUNTIFS(A1:A3,"North")'), 2);
  assert.equal(evalOn(cells, '=AVERAGEIF(A1:A3,"North",B1:B3)'), 7);
});

test("X: lookup functions (VLOOKUP/INDEX/MATCH/CHOOSE)", () => {
  const cells = { A1: 10, A2: 20, A3: 30, B1: "ten", B2: "twenty", B3: "thirty" };
  assert.equal(evalOn(cells, "=VLOOKUP(20,A1:B3,2,FALSE)"), "twenty");
  assert.equal(evalOn(cells, "=INDEX(A1:A3,3)"), 30);
  assert.equal(evalOn(cells, "=MATCH(20,A1:A3,0)"), 2);
  assert.equal(evalOn(cells, '=CHOOSE(2,"a","b","c")'), "b");
  assert.equal(evalOn(cells, "=VLOOKUP(99,A1:B3,2,FALSE)"), ERR_NA);
});

test("X: text functions", () => {
  assert.equal(evalOn({}, '=PROPER("the cat")'), "The Cat");
  assert.equal(evalOn({}, '=LEFT("Hearth Suite",3)'), "Hea");
  assert.equal(evalOn({}, '=MID("Hearth Suite",2,3)'), "ear");
  assert.equal(evalOn({}, '=SUBSTITUTE("a-b-c","-","+")'), "a+b+c");
  assert.equal(evalOn({}, '=TRIM("  two   words ")'), "two words");
  assert.equal(evalOn({}, '=CONCAT("a","b","c")'), "abc");
});

test("X: logical functions and error handling", () => {
  assert.equal(evalOn({ A1: 7 }, '=IF(A1>5,"big","small")'), "big");
  assert.equal(evalOn({}, '=IFERROR(1/0,"safe")'), "safe");
  assert.equal(evalOn({}, "=AND(TRUE,FALSE)"), false);
  assert.equal(evalOn({}, "=XOR(TRUE,TRUE,TRUE)"), true);
  assert.equal(evalOn({}, '=IFS(FALSE,"a",TRUE,"b")'), "b");
});

test("X: date/time functions via serials", () => {
  assert.equal(evalOn({}, "=YEAR(DATE(2024,3,15))"), 2024);
  assert.equal(evalOn({}, "=MONTH(DATE(2024,3,15))"), 3);
  assert.equal(evalOn({}, "=DAY(DATE(2024,3,15))"), 15);
  assert.equal(evalOn({}, "=WEEKDAY(DATE(2024,3,15))"), 6); // a Friday
  assert.equal(evalOn({}, "=DAYS(DATE(2024,3,15),DATE(2024,3,5))"), 10);
});

test("X: financial functions", () => {
  assert.ok(Math.abs(evalOn({}, "=PMT(0.05,10,1000)") - -129.5045749654566) < 1e-6);
  assert.ok(Math.abs(evalOn({}, "=FV(0.05,10,-100)") - 1257.789253554) < 1e-3);
  assert.ok(Math.abs(evalOn({}, "=PV(0.05,10,-100)") - 772.173492918) < 1e-3);
});

test("X: number formats (currency/percent/date/leading zeros)", () => {
  assert.equal(formatNumber(1234.5, "gbp"), "£1,234.50");
  assert.equal(formatNumber(-1234.5, "usd"), "-$1,234.50");
  assert.equal(formatNumber(0.123, "percent"), "12.3%");
  assert.equal(formatNumber(1234.6, "integer"), "1,235");
  assert.equal(formatNumber(42, "zip"), "00042");
  assert.equal(formatNumber(45000, "date"), "2023-03-15");
  assert.equal(formatNumber(45000, "date-long"), "15 March 2023");
});

test("X: fill series detects numeric, text+number, and copy", () => {
  assert.deepEqual(fillSeries([1, 2], 3), [3, 4, 5]);
  assert.deepEqual(fillSeries([10], 2), [11, 12]);
  assert.deepEqual(fillSeries(["Week 1"], 2), ["Week 2", "Week 3"]);
  assert.deepEqual(fillSeries(["hello"], 2), ["hello", "hello"]);
});

test("X1: drag-fill range picks the dominant axis and fills forward only", () => {
  // Vertical: B2 down to B5 → the three cells below the seed.
  assert.deepEqual(fillRangeRefs("B2", "B5"), ["B3", "B4", "B5"]);
  // Horizontal: B2 right to E2.
  assert.deepEqual(fillRangeRefs("B2", "E2"), ["C2", "D2", "E2"]);
  // Diagonal drag resolves to the larger delta (here vertical).
  assert.deepEqual(fillRangeRefs("B2", "C6"), ["B3", "B4", "B5", "B6"]);
  // Dragging up or left (or onto itself) fills nothing.
  assert.deepEqual(fillRangeRefs("B5", "B2"), []);
  assert.deepEqual(fillRangeRefs("C2", "A2"), []);
  assert.deepEqual(fillRangeRefs("B2", "B2"), []);
});

test("X: AutoSum picks the run above, then to the left", () => {
  const s = new Sheet();
  s.setCell("A1", "5").setCell("A2", "10").setCell("A3", "15");
  assert.equal(
    autoSumFormula((r) => s.valueOf(r), "A4"),
    "=SUM(A1:A3)",
  );
  s.setCell("B1", "1").setCell("C1", "2");
  assert.equal(
    autoSumFormula((r) => s.valueOf(r), "D1"),
    "=SUM(A1:C1)",
  );
});

test("X: multi-sheet workbook resolves cross-sheet refs and ranges", () => {
  const wb = new Workbook();
  const s1 = wb.sheet("Sheet1");
  const data = wb.addSheet("Data");
  data.setCell("A1", "100").setCell("A2", "200").setCell("A3", "300");
  s1.setCell("B1", "=Data!A2*2");
  s1.setCell("B2", "=SUM(Data!A1:A3)");
  assert.equal(s1.valueOf("B1"), 400);
  assert.equal(s1.valueOf("B2"), 600);
  assert.deepEqual(wb.names(), ["Sheet1", "Data"]);
});

test("X: Formula Helper catalogue is well-formed and matches the library", () => {
  assert.ok(FUNCTION_CATALOG.length >= 5);
  for (const cat of FUNCTION_CATALOG) {
    for (const fn of cat.functions) {
      assert.ok(FUNCTION_NAMES.includes(fn.name), `${fn.name} should be a real function`);
      assert.equal(typeof fn.summary, "string");
    }
  }
  assert.ok(FUNCTION_NAMES.length >= 76, `expected 76+ functions, got ${FUNCTION_NAMES.length}`);
});

test("AC-SHEETS-3: data-table mode promotes to Records without data loss", () => {
  const header = ["Name", "Age"];
  const dataRows = [
    ["Ada", 36],
    ["Linus", 54],
  ];
  const records = dataTableToRecords("People", header, dataRows);
  assert.deepEqual(records.fields, [
    { name: "Name", datatype: "text" },
    { name: "Age", datatype: "number" },
  ]);
  assert.equal(records.rows[0].Name, "Ada");
  assert.equal(records.rows[1].Age, 54);

  // Round-trip back to a data table, no data loss.
  const back = recordsToDataTable(records);
  assert.deepEqual(back.header, header);
  assert.deepEqual(back.dataRows, dataRows);
});

test("X1: adjustFormulaBody shifts refs on insert/delete, sparing names & functions", () => {
  // Insert one row at index 1 (above row 2): refs at/after row 2 shift down.
  assert.equal(adjustFormulaBody("A1+A2", "row", 1, 1), "A1+A3");
  // A range straddling the insertion grows.
  assert.equal(adjustFormulaBody("SUM(A1:A3)", "row", 1, 1), "SUM(A1:A4)");
  // Function names (SUM) and a named range (TOTAL) are never treated as cells.
  assert.equal(adjustFormulaBody("SUM(A1:A3)+TOTAL", "row", 0, 1, ["TOTAL"]), "SUM(A2:A4)+TOTAL");
  // Sheet-qualified references are left untouched.
  assert.equal(adjustFormulaBody("Sheet2!A5+A5", "row", 0, 1), "Sheet2!A5+A6");
  // Insert a column at index 0: columns at/after shift right (A→B).
  assert.equal(adjustFormulaBody("A1+B1", "col", 0, 1), "B1+C1");
  // Delete the row a reference points at → #REF!; later rows move up.
  assert.equal(adjustFormulaBody("A2+A5", "row", 1, -1), `${ERR_REF}+A4`);
  // A non-numeric literal like LOG10( stays a function, untouched.
  assert.equal(adjustFormulaBody("LOG10(A2)", "row", 0, 1), "LOG10(A3)");
});

test("X1: Sheet insert/delete row & column move data and rewrite formulas", () => {
  const s = new Sheet();
  s.setCell("A1", "10").setCell("A2", "20").setCell("A3", "=A1+A2");
  // Insert a row above row 2: A2→A3, A3(formula)→A4 with refs adjusted.
  s.insertRow(1);
  assert.equal(s.cells.get("A1"), "10");
  assert.equal(s.cells.get("A3"), "20");
  assert.equal(s.cells.get("A4"), "=A1+A3");
  assert.equal(s.valueOf("A4"), 30); // still computes the same total

  // Delete that inserted (blank) row: data returns to A1/A2, formula to A3.
  s.deleteRow(1);
  assert.equal(s.cells.get("A2"), "20");
  assert.equal(s.cells.get("A3"), "=A1+A2");
  assert.equal(s.valueOf("A3"), 30);

  // Columns: a value in B1 referenced from C1; insert a column at A shifts both.
  const t = new Sheet();
  t.setCell("B1", "7").setCell("C1", "=B1*2");
  t.insertColumn(0);
  assert.equal(t.cells.get("C1"), "7");
  assert.equal(t.cells.get("D1"), "=C1*2");
  assert.equal(t.valueOf("D1"), 14);
});
