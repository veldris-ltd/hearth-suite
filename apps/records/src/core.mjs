// Hearth Suite Records core: a flat, form-driven database with no-code relations,
// reports, and smart CSV import. No SQL, no DOM, no I/O, unit-tested directly.
// Persistence is the `store` crate via the FFI client (records.ts wiring).

/** The field datatypes a novice can pick from a menu (never SQL types). */
export const FIELD_TYPES = [
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
];

/** Plain-language labels for the field-type menu. */
export const FIELD_TYPE_LABELS = {
  text: "Text",
  email: "Email",
  select: "Select",
  status: "Status",
  relation: "Relation",
  number: "Number",
  date: "Date",
  time: "Time",
  bool: "Yes/No",
  formula: "Formula",
  auto: "Auto-number",
};

/** Field types whose value is computed/assigned, not typed by the user. */
export const COMPUTED_TYPES = ["formula", "auto"];

// ---- field validation (AC-RECORDS-1) ---------------------------------------

/** Validate/coerce a raw input against a field type for the form view. */
export function validateValue(type, raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  switch (type) {
    case "number":
    case "auto": {
      const n = Number(raw);
      return Number.isNaN(n) ? { ok: false, error: "Enter a number" } : { ok: true, value: n };
    }
    case "bool": {
      const b = String(raw).trim().toLowerCase();
      if (["true", "yes", "1"].includes(b)) return { ok: true, value: true };
      if (["false", "no", "0"].includes(b)) return { ok: true, value: false };
      return { ok: false, error: "Enter yes or no" };
    }
    case "date": {
      return isDate(String(raw))
        ? { ok: true, value: String(raw) }
        : { ok: false, error: "Enter a date" };
    }
    case "time": {
      return isTime(String(raw))
        ? { ok: true, value: normalizeTime(String(raw)) }
        : { ok: false, error: "Enter a time, e.g. 14:30" };
    }
    case "email": {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw).trim())
        ? { ok: true, value: String(raw).trim() }
        : { ok: false, error: "Enter an email address" };
    }
    case "formula":
      // Formula values are computed, never validated from input.
      return { ok: true, value: raw };
    default:
      return { ok: true, value: String(raw) };
  }
}

/**
 * Validate a whole row against a table's field definitions. Computed fields
 * (formula, auto) are skipped, they are filled by {@link computeRow}.
 */
export function validateRow(fields, values) {
  const errors = {};
  const clean = {};
  for (const field of fields) {
    if (COMPUTED_TYPES.includes(field.datatype)) {
      continue;
    }
    const result = validateValue(field.datatype, values[field.name]);
    if (result.ok) {
      clean[field.name] = result.value;
    } else {
      errors[field.name] = result.error;
    }
  }
  return { ok: Object.keys(errors).length === 0, values: clean, errors };
}

function isTime(value) {
  return /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value.trim());
}
function normalizeTime(value) {
  const [h, m] = value.trim().split(":");
  return `${String(Number(h)).padStart(2, "0")}:${m}`;
}

// ---- defaults, auto-number, formulas (AC-WKS-D4/D5) ------------------------

/**
 * A new record's starting values: each field's `default` (a literal), with
 * auto-number fields left for {@link nextAutoIncrement} to assign on insert.
 */
export function applyDefaults(fields, seed = {}) {
  const row = { ...seed };
  for (const field of fields) {
    if (row[field.name] !== undefined && row[field.name] !== "") {
      continue;
    }
    if (COMPUTED_TYPES.includes(field.datatype)) {
      continue;
    }
    if (field.default !== undefined && field.default !== null && field.default !== "") {
      row[field.name] = field.default;
    }
  }
  return row;
}

/** The next value for an auto-number field: one past the current maximum. */
export function nextAutoIncrement(rows, fieldName, start = 1) {
  let max = start - 1;
  for (const row of rows) {
    const n = Number(row[fieldName]);
    if (!Number.isNaN(n)) {
      max = Math.max(max, n);
    }
  }
  return max + 1;
}

/**
 * Fill every formula field in a row, resolving dependencies between formula
 * fields (so a formula may reference another formula, "self-referential").
 * A reference cycle yields `#CYCLE` for the fields involved.
 */
export function computeRow(fields, row) {
  const out = { ...row };
  const formulaFields = fields.filter((f) => f.datatype === "formula" && f.formula);
  const resolving = new Set();
  const done = new Set();
  const cyclic = new Set();

  const resolve = (field) => {
    if (done.has(field.name)) {
      return;
    }
    if (resolving.has(field.name)) {
      cyclic.add(field.name);
      return;
    }
    resolving.add(field.name);
    // Resolve any formula fields this one references first.
    for (const dep of fieldRefs(field.formula)) {
      const depField = formulaFields.find((f) => f.name === dep);
      if (depField && depField.name !== field.name) {
        resolve(depField);
      }
    }
    resolving.delete(field.name);
    if (cyclic.has(field.name)) {
      out[field.name] = "#CYCLE";
    } else {
      out[field.name] = evalFormula(field.formula, out);
    }
    done.add(field.name);
  };

  for (const field of formulaFields) {
    resolve(field);
  }
  return out;
}

// ---- no-code relations / lookups (AC-RECORDS-2) ----------------------------

/**
 * Resolve a no-code relation: match `row[relation.fromField]` against
 * `toRows[*][relation.toKey]`. Returns the looked-up field's value (or the whole
 * matched row when no `lookupField` is given). No SQL involved.
 */
export function resolveLookup(row, relation, toRows) {
  const match = toRows.find((candidate) => candidate[relation.toKey] === row[relation.fromField]);
  if (match === undefined) {
    return null;
  }
  return relation.lookupField ? (match[relation.lookupField] ?? null) : match;
}

/** Add a relation's looked-up value to each row as a new column. */
export function applyLookup(rows, relation, toRows, asField) {
  return rows.map((row) => ({ ...row, [asField]: resolveLookup(row, relation, toRows) }));
}

// ---- reports (AC-RECORDS-3) ------------------------------------------------

/** Run a report definition over rows: filter, sort, and project fields. */
export function runReport(rows, def) {
  let out = rows.slice();
  if (def.filter) {
    out = out.filter((row) => matchFilter(row[def.filter.field], def.filter.op, def.filter.value));
  }
  if (def.sort) {
    const dir = def.sort.dir === "desc" ? -1 : 1;
    out = out.sort((a, b) => compare(a[def.sort.field], b[def.sort.field]) * dir);
  }
  return out.map((row) => projectFields(row, def.fields));
}

function projectFields(row, fields) {
  const projected = {};
  for (const field of fields) {
    projected[field] = row[field] ?? null;
  }
  return projected;
}

function matchFilter(value, op, target) {
  switch (op) {
    case "eq":
      return value === target;
    case "neq":
      return value !== target;
    case "gt":
      return Number(value) > Number(target);
    case "lt":
      return Number(value) < Number(target);
    case "contains":
      return String(value ?? "")
        .toLowerCase()
        .includes(String(target).toLowerCase());
    default:
      return true;
  }
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Report rows are already record-shaped; this feeds Writer's Compose-from-Data. */
export function reportToMergeRecords(reportRows) {
  return reportRows.map((row) => ({ ...row }));
}

// ---- smart CSV import (AC-RECORDS-4) ---------------------------------------

/** Parse CSV text into a header row and data rows (handles quotes/commas). */
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return { header, rows };
}

/** Infer field definitions (name + type) from CSV columns. */
export function inferSchema(header, rows) {
  return header.map((name, index) => {
    const column = rows.map((r) => r[index]).filter((v) => v !== undefined && v !== "");
    return { name, datatype: inferColumnType(column) };
  });
}

function inferColumnType(values) {
  if (values.length === 0) {
    return "text";
  }
  if (values.every((v) => ["true", "false", "yes", "no"].includes(String(v).toLowerCase()))) {
    return "bool";
  }
  if (values.every((v) => !Number.isNaN(Number(v)))) {
    return "number";
  }
  if (values.every((v) => isDate(String(v)))) {
    return "date";
  }
  return "text";
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value);
}

// ---- Ember requests (NL query + import assist) -----------------------------

/** Build a local Ember request for natural-language querying of a table. */
export function buildQueryRequest(naturalLanguage, tableSummary, effort = "balanced") {
  return { task: "query", document: tableSummary, request: naturalLanguage, effort };
}

/** Build a local Ember request to refine an inferred CSV schema. */
export function buildImportRequest(csvSample) {
  return {
    task: "query",
    document: csvSample,
    request: "Infer a field name and type for each column.",
    effort: "fast",
  };
}

// ---- formula engine (AC-WKS-D5) --------------------------------------------

const FORMULA_FUNCS = new Set([
  "IF",
  "ROUND",
  "ABS",
  "MIN",
  "MAX",
  "SUM",
  "AVERAGE",
  "CONCAT",
  "UPPER",
  "LOWER",
  "LEN",
  "TRIM",
  "LEFT",
  "RIGHT",
  "TODAY",
  "NOW",
  "YEAR",
  "MONTH",
  "DAY",
  "AND",
  "OR",
  "NOT",
  "TRUE",
  "FALSE",
]);

/** The field names a formula references (for dependency resolution). */
export function fieldRefs(formula) {
  const refs = new Set();
  const src = String(formula ?? "");
  for (const m of src.matchAll(/\[([^\]]+)\]/g)) {
    refs.add(m[1].trim());
  }
  for (const m of src.matchAll(/([A-Za-z_][A-Za-z0-9_ ]*?)\b\s*(\()?/g)) {
    const name = m[1].trim();
    if (!m[2] && name !== "" && !FORMULA_FUNCS.has(name.toUpperCase())) {
      refs.add(name);
    }
  }
  return [...refs];
}

function tokenizeFormula(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        s += src[j];
        j += 1;
      }
      tokens.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== "]") {
        s += src[j];
        j += 1;
      }
      tokens.push({ t: "field", v: s.trim() });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) {
        j += 1;
      }
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) {
        j += 1;
      }
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^%&=<>(),".includes(ch)) {
      tokens.push({
        t: ch === "(" ? "lp" : ch === ")" ? "rp" : ch === "," ? "comma" : "op",
        v: ch,
      });
      i += 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/** Evaluate a record formula against a row (`{fieldName: value}`). */
export function evalFormula(formula, row) {
  const body = String(formula ?? "").replace(/^=/, "");
  const tokens = tokenizeFormula(body);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr() {
    return compareExpr();
  }
  function compareExpr() {
    let l = concatExpr();
    while (peek() && peek().t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) {
      const op = next().v;
      l = compareVals(op, l, concatExpr());
    }
    return l;
  }
  function concatExpr() {
    let l = addExpr();
    while (peek() && peek().t === "op" && peek().v === "&") {
      next();
      l = fText(l) + fText(addExpr());
    }
    return l;
  }
  function addExpr() {
    let l = mulExpr();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const r = mulExpr();
      l = op === "+" ? fNum(l) + fNum(r) : fNum(l) - fNum(r);
    }
    return l;
  }
  function mulExpr() {
    let l = powExpr();
    while (peek() && peek().t === "op" && ["*", "/", "%"].includes(peek().v)) {
      const op = next().v;
      const r = powExpr();
      if (op === "*") l = fNum(l) * fNum(r);
      else if (op === "/") l = fNum(r) === 0 ? "#DIV/0" : fNum(l) / fNum(r);
      else l = fNum(l) % fNum(r);
    }
    return l;
  }
  function powExpr() {
    const l = unaryExpr();
    if (peek() && peek().t === "op" && peek().v === "^") {
      next();
      return fNum(l) ** fNum(powExpr());
    }
    return l;
  }
  function unaryExpr() {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = next().v;
      const v = unaryExpr();
      return op === "-" ? -fNum(v) : fNum(v);
    }
    return primary();
  }
  function primary() {
    const tok = next();
    if (!tok) return null;
    if (tok.t === "num" || tok.t === "str") return tok.v;
    if (tok.t === "field") return resolveField(tok.v, row);
    if (tok.t === "lp") {
      const v = expr();
      if (peek() && peek().t === "rp") next();
      return v;
    }
    if (tok.t === "id") {
      if (peek() && peek().t === "lp") {
        next();
        const args = [];
        if (peek() && peek().t !== "rp") {
          args.push(expr());
          while (peek() && peek().t === "comma") {
            next();
            args.push(expr());
          }
        }
        if (peek() && peek().t === "rp") next();
        return callFormulaFunc(tok.v.toUpperCase(), args);
      }
      const up = tok.v.toUpperCase();
      if (up === "TRUE") return true;
      if (up === "FALSE") return false;
      return resolveField(tok.v, row);
    }
    return null;
  }

  try {
    return primaryFinalize(expr());
  } catch {
    return "#ERR";
  }
}

function primaryFinalize(v) {
  if (typeof v === "number" && !Number.isInteger(v)) {
    return Math.round(v * 1e6) / 1e6;
  }
  return v;
}

function resolveField(name, row) {
  if (Object.prototype.hasOwnProperty.call(row, name)) {
    return row[name] ?? null;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) {
      return row[key] ?? null;
    }
  }
  return null;
}

function fNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}
function fText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function fBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "" && v.toUpperCase() !== "FALSE";
  return Boolean(v);
}
function compareVals(op, a, b) {
  const x = typeof a === "number" ? a : fText(a);
  const y = typeof b === "number" ? b : fText(b);
  switch (op) {
    case "=":
      return x === y;
    case "<>":
      return x !== y;
    case "<":
      return x < y;
    case ">":
      return x > y;
    case "<=":
      return x <= y;
    case ">=":
      return x >= y;
    default:
      return false;
  }
}
function callFormulaFunc(name, args) {
  const nums = () => args.map(fNum);
  switch (name) {
    case "IF":
      return fBool(args[0]) ? (args[1] ?? null) : (args[2] ?? null);
    case "ROUND": {
      const f = 10 ** fNum(args[1] ?? 0);
      return Math.round(fNum(args[0]) * f) / f;
    }
    case "ABS":
      return Math.abs(fNum(args[0]));
    case "MIN":
      return Math.min(...nums());
    case "MAX":
      return Math.max(...nums());
    case "SUM":
      return nums().reduce((a, b) => a + b, 0);
    case "AVERAGE": {
      const n = nums();
      return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0;
    }
    case "CONCAT":
      return args.map(fText).join("");
    case "UPPER":
      return fText(args[0]).toUpperCase();
    case "LOWER":
      return fText(args[0]).toLowerCase();
    case "TRIM":
      return fText(args[0]).trim();
    case "LEN":
      return fText(args[0]).length;
    case "LEFT":
      return fText(args[0]).slice(0, fNum(args[1] ?? 1));
    case "RIGHT": {
      const n = fNum(args[1] ?? 1);
      return n === 0 ? "" : fText(args[0]).slice(-n);
    }
    case "AND":
      return args.every(fBool);
    case "OR":
      return args.some(fBool);
    case "NOT":
      return !fBool(args[0]);
    case "TODAY":
      return todayIso();
    case "NOW":
      return todayIso();
    case "YEAR":
      return Number((fText(args[0]).match(/(\d{4})/) ?? [])[1] ?? 0);
    case "MONTH":
      return Number((fText(args[0]).match(/\d{4}-(\d{2})/) ?? [])[1] ?? 0);
    case "DAY":
      return Number((fText(args[0]).match(/\d{4}-\d{2}-(\d{2})/) ?? [])[1] ?? 0);
    default:
      return "#NAME";
  }
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- saved filters, human operators (AC-WKS-D8) ----------------------------

/**
 * The filter operators, phrased in plain language (never "=", "LIKE"). `types`
 * lists which field types offer each operator; `nullary` ops take no value.
 */
export const FILTER_OPS = [
  { id: "contains", label: "contains", types: ["text"] },
  { id: "not_contains", label: "does not contain", types: ["text"] },
  { id: "starts_with", label: "starts with", types: ["text"] },
  { id: "ends_with", label: "ends with", types: ["text"] },
  { id: "is", label: "is", types: ["text", "number", "bool", "date", "time", "auto"] },
  { id: "is_not", label: "is not", types: ["text", "number", "bool", "date", "time", "auto"] },
  { id: "gt", label: "is greater than", types: ["number", "auto"] },
  { id: "lt", label: "is less than", types: ["number", "auto"] },
  { id: "gte", label: "is at least", types: ["number", "auto"] },
  { id: "lte", label: "is at most", types: ["number", "auto"] },
  { id: "after", label: "is after", types: ["date", "time"] },
  { id: "before", label: "is before", types: ["date", "time"] },
  {
    id: "empty",
    label: "is empty",
    types: ["text", "number", "date", "time", "bool", "auto"],
    nullary: true,
  },
  {
    id: "not_empty",
    label: "is not empty",
    types: ["text", "number", "date", "time", "bool", "auto"],
    nullary: true,
  },
];

/** The operators available for a given field type. */
export function opsForType(type) {
  return FILTER_OPS.filter((op) => op.types.includes(type) || type === "formula");
}

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

/** Test one value against a human-phrased operator. */
export function matchCondition(value, op, target, type = "text") {
  if (op === "empty") return isEmpty(value);
  if (op === "not_empty") return !isEmpty(value);
  if (isEmpty(value) && op !== "is" && op !== "is_not") {
    return false;
  }
  const numeric = type === "number" || type === "auto";
  switch (op) {
    case "is":
      return numeric
        ? Number(value) === Number(target)
        : fText(value).toLowerCase() === fText(target).toLowerCase();
    case "is_not":
      return numeric
        ? Number(value) !== Number(target)
        : fText(value).toLowerCase() !== fText(target).toLowerCase();
    case "contains":
      return fText(value).toLowerCase().includes(fText(target).toLowerCase());
    case "not_contains":
      return !fText(value).toLowerCase().includes(fText(target).toLowerCase());
    case "starts_with":
      return fText(value).toLowerCase().startsWith(fText(target).toLowerCase());
    case "ends_with":
      return fText(value).toLowerCase().endsWith(fText(target).toLowerCase());
    case "gt":
      return Number(value) > Number(target);
    case "lt":
      return Number(value) < Number(target);
    case "gte":
      return Number(value) >= Number(target);
    case "lte":
      return Number(value) <= Number(target);
    case "after":
      return fText(value) > fText(target);
    case "before":
      return fText(value) < fText(target);
    default:
      return true;
  }
}

/**
 * Apply a saved filter set to rows. `set.match` is "all" (AND) or "any" (OR)
 * across `set.conditions` (each `{field, op, value}`). An empty set passes all.
 */
export function applyFilterSet(rows, set, fields = []) {
  const conditions = set?.conditions ?? [];
  if (conditions.length === 0) {
    return rows.slice();
  }
  const typeOf = (name) => fields.find((f) => f.name === name)?.datatype ?? "text";
  const any = set.match === "any";
  return rows.filter((row) => {
    const results = conditions.map((c) =>
      matchCondition(row[c.field], c.op, c.value, typeOf(c.field)),
    );
    return any ? results.some(Boolean) : results.every(Boolean);
  });
}

// ---- multi-key sort, find (AC-WKS-D9/D11) ----------------------------------

/** Sort rows by an ordered list of `{field, dir}` keys (stable, type-aware). */
export function sortRows(rows, sortKeys) {
  const keys = (sortKeys ?? []).filter((k) => k && k.field);
  if (keys.length === 0) {
    return rows.slice();
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const dir = key.dir === "desc" ? -1 : 1;
        const c = compare(a.row[key.field], b.row[key.field]) * dir;
        if (c !== 0) return c;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Find rows where any field value contains the query (case-insensitive). */
export function findRows(rows, query) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (q === "") {
    return rows.slice();
  }
  return rows.filter((row) => Object.values(row).some((v) => fText(v).toLowerCase().includes(q)));
}

// ---- delimited import/export (AC-WKS-D17) ----------------------------------

/** Parse delimited text (comma/tab/semicolon) into a header and data rows. */
export function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return { header, rows };
}

function quoteCell(value, delimiter) {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialise fields + rows to delimited text (CSV by default; TSV with "\t"). */
export function toDelimited(fields, rows, delimiter = ",") {
  const header = fields.map((f) => quoteCell(f.name, delimiter)).join(delimiter);
  const lines = rows.map((row) =>
    fields.map((f) => quoteCell(row[f.name], delimiter)).join(delimiter),
  );
  return [header, ...lines].join("\n");
}

// ---- Reports (ReportCreator heir, AC-WKS-D12..D14) -------------------------

/** The summary aggregates a report can compute, in plain language. */
export const REPORT_AGGS = [
  { id: "sum", label: "Total" },
  { id: "count", label: "Count" },
  { id: "average", label: "Average" },
  { id: "min", label: "Lowest" },
  { id: "max", label: "Highest" },
  { id: "stddev", label: "Std deviation" },
  { id: "variance", label: "Variance" },
];

const AGG_LABEL = Object.fromEntries(REPORT_AGGS.map((a) => [a.id, a.label]));

/** Sample variance (n-1); 0 for fewer than two values. Backs stddev + variance. */
function sampleVariance(nums) {
  if (nums.length < 2) {
    return 0;
  }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
}

/** Aggregate a list of values under an aggregate id. */
export function aggregateValues(values, agg) {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (agg === "count") {
    return present.length;
  }
  const nums = present.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) {
    return 0;
  }
  switch (agg) {
    case "sum":
      return round(nums.reduce((a, b) => a + b, 0));
    case "average":
      return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "variance":
      return round(sampleVariance(nums));
    case "stddev":
      return round(Math.sqrt(sampleVariance(nums)));
    default:
      return round(nums.reduce((a, b) => a + b, 0));
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function computeSummaries(rows, summaryDefs) {
  return summaryDefs.map((s) => ({
    field: s.field,
    agg: s.agg,
    label: AGG_LABEL[s.agg] ?? s.agg,
    value: aggregateValues(
      rows.map((r) => r[s.field]),
      s.agg,
    ),
  }));
}

/**
 * Build a structured report from rows and a {@link ReportSpec}: filter → sort →
 * (group) → per-group and grand summaries. Columns control display; summaries
 * may reference any field. Pure; the editor renders/prints/exports the result.
 */
export function buildReport(rows, spec, fields = []) {
  const columns =
    spec.columns && spec.columns.length > 0 ? spec.columns : fields.map((f) => f.name);
  const summaries = spec.summaries ?? [];
  const filtered = spec.filter ? applyFilterSet(rows, spec.filter, fields) : rows.slice();
  const sortKeys = spec.groupBy
    ? [{ field: spec.groupBy, dir: "asc" }, ...(spec.sort ?? [])]
    : (spec.sort ?? []);
  const sorted = sortRows(filtered, sortKeys);

  const report = {
    title: spec.title ?? "Report",
    columns,
    summaryDefs: summaries,
    grouped: Boolean(spec.groupBy),
    groupBy: spec.groupBy ?? null,
    groups: null,
    rows: null,
    grand: computeSummaries(sorted, summaries),
    count: sorted.length,
  };

  if (spec.groupBy) {
    const order = [];
    const map = new Map();
    for (const row of sorted) {
      const key =
        row[spec.groupBy] == null || row[spec.groupBy] === ""
          ? "(blank)"
          : String(row[spec.groupBy]);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key).push(row);
    }
    report.groups = order.map((key) => ({
      key,
      rows: map.get(key),
      summaries: computeSummaries(map.get(key), summaries),
    }));
  } else {
    report.rows = sorted;
  }
  return report;
}

/** Render a report to plain text (clipboard parity nod). */
export function reportToText(report) {
  const lines = [];
  lines.push(report.title);
  lines.push("");
  const header = report.columns.join("\t");
  const dataLine = (row) =>
    report.columns.map((c) => (row[c] == null ? "" : String(row[c]))).join("\t");
  const summaryLine = (summaries, indent = "") =>
    summaries.map((s) => `${indent}${s.label} ${s.field}: ${s.value}`).join("\n");

  if (report.grouped) {
    for (const group of report.groups) {
      lines.push(`${report.groupBy}: ${group.key}`);
      lines.push(header);
      for (const row of group.rows) lines.push(dataLine(row));
      if (group.summaries.length > 0) {
        lines.push(summaryLine(group.summaries, "  "));
      }
      lines.push("");
    }
  } else {
    lines.push(header);
    for (const row of report.rows) lines.push(dataLine(row));
    lines.push("");
  }
  if (report.grand.length > 0) {
    lines.push("Grand totals");
    lines.push(summaryLine(report.grand, "  "));
  }
  return lines.join("\n");
}

/**
 * Flatten a report's data rows (projected to its columns, plus the group key)
 * into merge records for Writer's Compose-from-Data.
 */
export function reportMergeRecords(report) {
  const project = (row, groupKey) => {
    const record = {};
    for (const c of report.columns) {
      record[c] = row[c] == null ? "" : String(row[c]);
    }
    if (report.grouped && report.groupBy && !(report.groupBy in record)) {
      record[report.groupBy] = groupKey ?? "";
    }
    return record;
  };
  if (report.grouped) {
    return report.groups.flatMap((g) => g.rows.map((row) => project(row, g.key)));
  }
  return (report.rows ?? []).map((row) => project(row));
}

/**
 * Infer a {@link ReportSpec} from a one-line phrase ("monthly totals by
 * category", "average price by region"), the local heuristic behind the Ember
 * one-liner. Deterministic; no network.
 */
export function inferReportSpec(phrase, fields) {
  const text = String(phrase ?? "").toLowerCase();
  const names = fields.map((f) => f.name);
  const matchField = (after) => {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `after` is a literal keyword ("by" / "per") from this module
    const m = new RegExp("\\b" + after + "\\s+([a-z0-9 ]+?)\\b").exec(text);
    const want = m ? m[1].trim() : "";
    return (
      names.find((n) => n.toLowerCase() === want) ??
      names.find((n) => want.includes(n.toLowerCase())) ??
      null
    );
  };
  const groupBy =
    matchField("by") ??
    matchField("per") ??
    names.find((n) => text.includes(n.toLowerCase())) ??
    null;

  let agg = "sum";
  if (/\baverage|\bavg|\bmean\b/.test(text)) agg = "average";
  else if (/\bcount|how many\b/.test(text)) agg = "count";
  else if (/\blowest|\bmin\b/.test(text)) agg = "min";
  else if (/\bhighest|\bmax\b/.test(text)) agg = "max";
  else if (/\bvariance|\bvariation\b/.test(text)) agg = "variance";
  else if (/\bdeviation|\bstd\b|\bstandard dev|\bspread\b/.test(text)) agg = "stddev";

  const numberFields = fields.filter((f) => f.datatype === "number" || f.datatype === "auto");
  const summaryField =
    numberFields.find((f) => text.includes(f.name.toLowerCase()))?.name ??
    numberFields.find((f) => f.name !== groupBy)?.name ??
    numberFields[0]?.name ??
    names[0] ??
    "";

  const columns = [];
  if (groupBy) columns.push(groupBy);
  if (summaryField && summaryField !== groupBy) columns.push(summaryField);

  return {
    title: phrase ? capitalize(String(phrase)) : "Report",
    columns: columns.length ? columns : names.slice(0, 2),
    groupBy,
    summaries: summaryField ? [{ field: summaryField, agg }] : [],
    filter: null,
    sort: [],
  };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build a local Ember request to draft a report definition from a phrase. */
export function buildReportRequest(naturalLanguage, tableSummary, effort = "balanced") {
  return {
    task: "query",
    document: tableSummary,
    request: `Design a report: ${naturalLanguage}`,
    effort,
  };
}
