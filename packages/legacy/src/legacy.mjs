// Hearth Suite legacy import, translate a decoded Microsoft Works file into Hearth Suite's
// native models, and report every degradation honestly (AC-WKS-G3, AC-LEG-1/2).
//
// The binary decode is done natively by **libwps** (via the FFI), which produces
// the plain intermediate representations consumed here (WpsIr/WksIr/WdbIr). This
// module is the pure translation + fidelity-report layer: no DOM, no I/O, no
// binary parsing, unit-tested directly. Where libwps cannot expose something
// (or where Hearth Suite has no equivalent), we keep what we can and SAY SO.

// ---- import report ---------------------------------------------------------

/** Severity of a report item: a note, a partial loss, or an outright loss. */
export const SEVERITIES = ["info", "degraded", "lost"];

function makeReport(format) {
  return { format, ok: true, items: [] };
}
function note(report, area, detail) {
  report.items.push({ severity: "info", area, detail });
}
function degraded(report, area, detail) {
  report.items.push({ severity: "degraded", area, detail });
}
function lost(report, area, detail) {
  report.items.push({ severity: "lost", area, detail });
  report.ok = false;
}

/** A short plain-language summary line for a report. */
export function summarizeReport(report) {
  const counts = { info: 0, degraded: 0, lost: 0 };
  for (const item of report.items) counts[item.severity] += 1;
  if (counts.degraded === 0 && counts.lost === 0) {
    return `Imported your ${report.format.toUpperCase()} file with full fidelity.`;
  }
  const parts = [];
  if (counts.degraded) parts.push(`${counts.degraded} approximated`);
  if (counts.lost) parts.push(`${counts.lost} could not be converted`);
  return `Imported your ${report.format.toUpperCase()} file. ${parts.join(", ")}, see the details below.`;
}

/** Render a report to plain text (for display / copying). */
export function formatImportReport(report) {
  const lines = [summarizeReport(report), ""];
  if (report.items.length === 0) {
    return lines.join("\n");
  }
  const label = { info: "Kept", degraded: "Approximated", lost: "Not converted" };
  for (const sev of SEVERITIES) {
    const items = report.items.filter((i) => i.severity === sev);
    if (items.length === 0) continue;
    lines.push(`${label[sev]}:`);
    for (const item of items) lines.push(`  • ${item.area}: ${item.detail}`);
  }
  return lines.join("\n").trim();
}

// ---- .wps → Writer (formatting, tables, headers/footers, footnotes) -------

const KNOWN_STYLES = new Set([
  "title",
  "h1",
  "h2",
  "h3",
  "body",
  "quote",
  "caption",
  "normal",
  "heading 1",
  "heading 2",
]);

function runToSpan(run) {
  const span = { text: run.text ?? "" };
  for (const mark of ["bold", "italic", "underline", "strike", "sup", "sub"]) {
    if (run[mark]) span[mark] = true;
  }
  for (const mark of ["color", "font", "size", "href"]) {
    if (run[mark]) span[mark] = run[mark];
  }
  return span;
}

/**
 * Translate a decoded .wps document into a Writer document, preserving runs,
 * styles, tables, headers/footers and footnotes where they map, and reporting
 * anything approximated or dropped.
 */
export function translateWps(ir) {
  const report = makeReport("wps");
  const blocks = [];
  const footnotes = [];
  let footnoteSeq = 0;

  for (const block of ir.blocks ?? []) {
    if (block.kind === "heading") {
      blocks.push({
        kind: "heading",
        level: clampLevel(block.level),
        spans: (block.runs ?? []).map(runToSpan),
      });
    } else if (block.kind === "table") {
      const rows = (block.rows ?? []).map((row) =>
        row.map((cell) =>
          cell.runs ? cell.runs.map(runToSpan) : [{ text: String(cell.text ?? cell) }],
        ),
      );
      blocks.push({ kind: "table", rows });
    } else {
      const spans = (block.runs ?? []).map(runToSpan);
      const para = { kind: "paragraph", spans: spans.length ? spans : [{ text: "" }] };
      if (block.style && !KNOWN_STYLES.has(String(block.style).toLowerCase())) {
        degraded(report, "Style", `paragraph style “${block.style}” approximated as Body`);
      } else if (block.style) {
        para.style = String(block.style).toLowerCase();
      }
      blocks.push(para);
      // Footnotes anchored to this paragraph.
      for (const fn of block.footnotes ?? []) {
        footnoteSeq += 1;
        footnotes.push({ id: footnoteSeq, text: fn.text ?? "" });
      }
    }
  }

  if (blocks.length > 0) {
    note(report, "Text", `${blocks.length} paragraph(s)/block(s) imported`);
  }
  const tables = blocks.filter((b) => b.kind === "table").length;
  if (tables) note(report, "Tables", `${tables} table(s) imported`);
  if (footnotes.length) note(report, "Footnotes", `${footnotes.length} footnote(s) imported`);

  const result = {
    doc: {
      title: ir.title ?? "Imported document",
      blocks: blocks.length ? blocks : [{ kind: "paragraph", spans: [{ text: "" }] }],
    },
    footnotes,
    report,
  };
  if (ir.header) {
    result.headerText = ir.header;
    note(report, "Header", "moved to the document's print header");
  }
  if (ir.footer) {
    result.footerText = ir.footer;
    note(report, "Footer", "moved to the document's print footer");
  }
  reportUnsupported(report, ir.unsupported);
  return result;
}

function clampLevel(level) {
  const n = Number(level);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 1;
}

// ---- .wks → Sheets (formulas, functions, names, charts) -------------------

// Functions Hearth Suite's engine supports (kept in sync with @hearth/sheets). Used
// to flag legacy formulas that reference something we can't compute.
const SUPPORTED_FUNCTIONS = new Set([
  "SUM",
  "PRODUCT",
  "SUMSQ",
  "SUMPRODUCT",
  "ABS",
  "SIGN",
  "SQRT",
  "POWER",
  "EXP",
  "LN",
  "LOG",
  "LOG10",
  "MOD",
  "QUOTIENT",
  "INT",
  "TRUNC",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "CEILING",
  "FLOOR",
  "MROUND",
  "EVEN",
  "ODD",
  "PI",
  "FACT",
  "COMBIN",
  "GCD",
  "LCM",
  "DEGREES",
  "RADIANS",
  "SIN",
  "COS",
  "TAN",
  "ASIN",
  "ACOS",
  "ATAN",
  "ATAN2",
  "RAND",
  "RANDBETWEEN",
  "AVERAGE",
  "AVG",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "COUNTIF",
  "COUNTIFS",
  "MIN",
  "MAX",
  "MEDIAN",
  "MODE",
  "STDEV",
  "STDEVP",
  "VAR",
  "VARP",
  "LARGE",
  "SMALL",
  "RANK",
  "PERCENTILE",
  "SUMIF",
  "SUMIFS",
  "AVERAGEIF",
  "PMT",
  "FV",
  "PV",
  "NPER",
  "NPV",
  "IPMT",
  "PPMT",
  "SLN",
  "TODAY",
  "NOW",
  "DATE",
  "TIME",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "WEEKDAY",
  "DAYS",
  "CONCAT",
  "CONCATENATE",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "LOWER",
  "UPPER",
  "PROPER",
  "TRIM",
  "REPLACE",
  "SUBSTITUTE",
  "FIND",
  "SEARCH",
  "TEXT",
  "VALUE",
  "IF",
  "IFS",
  "IFERROR",
  "IFNA",
  "AND",
  "OR",
  "NOT",
  "XOR",
  "TRUE",
  "FALSE",
  "VLOOKUP",
  "HLOOKUP",
  "INDEX",
  "MATCH",
  "CHOOSE",
  "LOOKUP",
  "ISNUMBER",
  "ISTEXT",
  "ISBLANK",
  "ISERROR",
  "NA",
]);

/** Map a Works chart type to a Hearth Suite chart type, or null if not re-creatable. */
const CHART_TYPE_MAP = {
  bar: "bar",
  column: "bar",
  line: "line",
  area: "area",
  pie: "pie",
  xy: "scatter",
  scatter: "scatter",
  "stacked-bar": "stacked-bar",
  "stacked-column": "stacked-bar",
  "stacked-area": "stacked-area",
  radar: null,
  combo: null,
};

/**
 * Resolve a Works chart type to a Hearth Suite one. Direct equivalents map cleanly;
 * Works' 3-D variants (3-D Bar/Area/Line/Pie) and Stacked Line have no exact
 * Hearth Suite type but ARE decodable, so they re-create as the flat equivalent with
 * `approx:true` (an honest "shown flat" note). Genuinely-incompatible types
 * (radar, combination) resolve to `null` → reported as omitted.
 */
function mapChartType(rawType) {
  const key = String(rawType ?? "")
    .toLowerCase()
    .trim();
  if (key in CHART_TYPE_MAP) {
    return { type: CHART_TYPE_MAP[key], approx: false };
  }
  // A 3-D variant: drop the "3-d" marker and re-create the flat base chart.
  const flat = key.replace(/3[\s-]?d\s*/g, "").trim();
  if (flat !== key && CHART_TYPE_MAP[flat] != null) {
    return { type: CHART_TYPE_MAP[flat], approx: true };
  }
  // Stacked line → stacked area (the closest filled, cumulative equivalent).
  if (/stacked\s*line/.test(key)) {
    return { type: "stacked-area", approx: true };
  }
  return { type: null, approx: false };
}

function formulaFunctions(formula) {
  const names = new Set();
  for (const m of String(formula).matchAll(/([A-Za-z][A-Za-z0-9.]*)\s*\(/g)) {
    names.add(m[1].toUpperCase());
  }
  return [...names];
}

/**
 * Translate a decoded .wks workbook into Hearth Suite cells, named ranges and chart
 * specs. Chart DEFINITIONS are re-created (not rasterised) where decodable.
 */
export function translateWks(ir, supported = SUPPORTED_FUNCTIONS) {
  const report = makeReport("wks");
  const cells = {};
  const unknownFns = new Set();

  for (const cell of ir.cells ?? []) {
    if (!cell.ref) continue;
    if (cell.formula != null && cell.formula !== "") {
      cells[String(cell.ref).toUpperCase()] = `=${String(cell.formula).replace(/^=/, "")}`;
      for (const fn of formulaFunctions(cell.formula)) {
        if (!supported.has(fn)) unknownFns.add(fn);
      }
    } else if (cell.value != null && cell.value !== "") {
      cells[String(cell.ref).toUpperCase()] = String(cell.value);
    }
  }
  if (Object.keys(cells).length)
    note(report, "Cells", `${Object.keys(cells).length} cell(s) imported`);
  if (unknownFns.size) {
    degraded(
      report,
      "Functions",
      `${[...unknownFns].join(", ")} not supported, those cells will show an error`,
    );
  }

  const names = (ir.names ?? []).map((n) => ({
    name: n.name,
    range: String(n.range ?? "").toUpperCase(),
  }));
  if (names.length) note(report, "Named ranges", `${names.length} named range(s) imported`);

  const charts = [];
  for (const chart of ir.charts ?? []) {
    if (chart.rasterised) {
      lost(
        report,
        "Chart",
        `“${chart.title ?? "chart"}” was stored as an image and could not be re-created`,
      );
      continue;
    }
    const { type, approx } = mapChartType(chart.type);
    if (type == null) {
      lost(report, "Chart", `chart type “${chart.type}” is not supported and was omitted`);
      continue;
    }
    const data = chart.data ?? extractChartData(chart);
    if (!data || data.series.length === 0) {
      degraded(
        report,
        "Chart",
        `“${chart.title ?? "chart"}” had no decodable data and was skipped`,
      );
      continue;
    }
    if (approx) {
      degraded(
        report,
        "Chart",
        `“${chart.title ?? "chart"}” was a ${chart.type} chart, re-created as a flat ${type} (Hearth Suite charts are 2-D)`,
      );
    }
    charts.push({
      id: `chart-${charts.length + 1}`,
      title: chart.title ?? "Chart",
      type,
      categories: data.categories,
      series: data.series,
      ...(chart.dataRange
        ? { source: { kind: "sheet", range: String(chart.dataRange).toUpperCase() } }
        : {}),
    });
  }
  if (charts.length)
    note(report, "Charts", `${charts.length} chart definition(s) re-created (not rasterised)`);

  reportUnsupported(report, ir.unsupported);
  return { name: ir.name ?? "Imported sheet", cells, names, charts, report };
}

/** Pull categories + series from a chart's inline series, when present. */
function extractChartData(chart) {
  if (Array.isArray(chart.series) && chart.series.length) {
    return {
      categories: chart.categories ?? chart.series[0].values.map((_v, i) => String(i + 1)),
      series: chart.series.map((s) => ({
        name: s.name ?? "Series",
        values: (s.values ?? []).map(Number),
      })),
    };
  }
  return null;
}

// ---- .wdb → Records (fields, formula fields, filters, reports) ------------

const FIELD_TYPE_MAP = {
  text: "text",
  general: "text",
  number: "number",
  numeric: "number",
  currency: "number",
  date: "date",
  time: "time",
  boolean: "bool",
  bool: "bool",
  formula: "formula",
  calculated: "formula",
  serial: "auto",
  auto: "auto",
  "auto-number": "auto",
};

// Works filter comparators → Hearth Suite human-operator ids.
const FILTER_OP_MAP = {
  is: "is",
  equals: "is",
  "=": "is",
  "is not": "is_not",
  "<>": "is_not",
  contains: "contains",
  "does not contain": "not_contains",
  "begins with": "starts_with",
  "ends with": "ends_with",
  ">": "gt",
  "greater than": "gt",
  "<": "lt",
  "less than": "lt",
  ">=": "gte",
  "<=": "lte",
  "is after": "after",
  "is before": "before",
  "is blank": "empty",
  "is not blank": "not_empty",
};

const REPORT_AGG_MAP = {
  sum: "sum",
  total: "sum",
  count: "count",
  average: "average",
  avg: "average",
  mean: "average",
  min: "min",
  minimum: "min",
  max: "max",
  maximum: "max",
  // Works 9 ReportCreator also exposes Std-Dev and Variance (PW-0 §A.7.3);
  // Records gained both in PW-2.7, so they translate faithfully now.
  "standard deviation": "stddev",
  "std deviation": "stddev",
  "std dev": "stddev",
  stddev: "stddev",
  deviation: "stddev",
  variance: "variance",
};

/**
 * Translate a decoded .wdb database into Records fields/rows, plus saved filters
 * and report definitions where libwps exposes them, faithfully reported where
 * it does not.
 */
export function translateWdb(ir) {
  const report = makeReport("wdb");

  const fields = (ir.fields ?? []).map((field) => {
    const datatype = FIELD_TYPE_MAP[String(field.type ?? "text").toLowerCase()];
    const out = { name: field.name, datatype: datatype ?? "text" };
    if (datatype == null) {
      degraded(report, "Field type", `“${field.name}” had type “${field.type}”, imported as Text`);
    }
    if (out.datatype === "formula" && field.formula) out.formula = String(field.formula);
    if (field.default != null) out.default = field.default;
    return out;
  });
  if (fields.length) note(report, "Fields", `${fields.length} field(s) imported`);
  const formulaFields = fields.filter((f) => f.datatype === "formula").length;
  if (formulaFields) note(report, "Formula fields", `${formulaFields} formula field(s) imported`);

  const rows = ir.rows ?? [];
  if (rows.length) note(report, "Records", `${rows.length} record(s) imported`);

  const filters = [];
  for (const filter of ir.filters ?? []) {
    const conditions = [];
    for (const cond of filter.conditions ?? []) {
      const op = FILTER_OP_MAP[String(cond.op ?? "").toLowerCase()];
      if (op == null) {
        degraded(
          report,
          "Filter",
          `operator “${cond.op}” on “${filter.name ?? "filter"}” approximated as “contains”`,
        );
      }
      conditions.push({ field: cond.field, op: op ?? "contains", value: cond.value });
    }
    filters.push({ name: filter.name, match: filter.match === "any" ? "any" : "all", conditions });
  }
  if (filters.length) note(report, "Filters", `${filters.length} saved filter(s) translated`);
  if (ir.filtersUnavailable) {
    degraded(
      report,
      "Filters",
      `${ir.filtersUnavailable} filter(s) were present but this file format did not expose their rules`,
    );
  }

  const reports = [];
  for (const def of ir.reports ?? []) {
    const summaries = (def.summaries ?? []).map((s) => {
      const agg = REPORT_AGG_MAP[String(s.agg ?? "sum").toLowerCase()];
      if (agg == null) {
        // Don't silently mistranslate an unknown summary — report it honestly.
        degraded(
          report,
          "Reports",
          `summary “${s.agg}” on ${s.field} isn't available and was kept as Total`,
        );
        return { field: s.field, agg: "sum" };
      }
      return { field: s.field, agg };
    });
    reports.push({
      title: def.title ?? def.name ?? "Report",
      groupBy: def.groupBy ?? null,
      summaries,
      columns: def.columns ?? [],
      filter: null,
      sort: [],
    });
  }
  if (reports.length) note(report, "Reports", `${reports.length} report definition(s) translated`);
  if (ir.reportsUnavailable) {
    degraded(
      report,
      "Reports",
      `${ir.reportsUnavailable} report(s) were present but this file format did not expose their definitions`,
    );
  }

  reportUnsupported(report, ir.unsupported);
  return { name: ir.name ?? "Imported database", fields, rows, filters, reports, report };
}

// ---- shared helpers --------------------------------------------------------

function reportUnsupported(report, unsupported) {
  for (const item of unsupported ?? []) {
    lost(report, item.kind ?? "Object", item.detail ?? "could not be imported");
  }
}

/**
 * Dispatch a decoded legacy file to its translator. Never throws, a corrupt or
 * partial IR yields a report rather than a crash (AC-LEG-2). `format` is the
 * detected source kind; `ir` is libwps's decoded intermediate representation.
 */
export function importLegacy(format, ir) {
  try {
    if (ir && ir.error) {
      const report = makeReport(format);
      degraded(report, "File", `only part of the file could be read: ${ir.error}`);
      if (format === "wps") return { ...translateWps(ir), report };
      if (format === "wks") return { ...translateWks(ir), report };
      if (format === "wdb") return { ...translateWdb(ir), report };
    }
    if (format === "wps") return translateWps(ir ?? {});
    if (format === "wks") return translateWks(ir ?? {});
    if (format === "wdb") return translateWdb(ir ?? {});
    const report = makeReport(format);
    lost(report, "File", `unknown legacy format “${format}”`);
    return { report };
  } catch (error) {
    const report = makeReport(format);
    lost(
      report,
      "File",
      `the file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { report };
  }
}

/** The legacy formats Hearth Suite imports, with the module each opens into. */
export const LEGACY_FORMATS = [
  { id: "wps", label: "Works document (.wps)", module: "writer" },
  { id: "wks", label: "Works spreadsheet (.wks)", module: "sheets" },
  { id: "wdb", label: "Works database (.wdb)", module: "records" },
];
