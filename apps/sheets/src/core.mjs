// Hearth Suite Sheets core: a formula engine (cell refs, ranges, named ranges, modern
// functions), pivot summaries, chart suggestion, plain-language explanation, the
// Records bridge, and the ODF mapping. No DOM, no I/O, unit-tested directly.

// ---- references -------------------------------------------------------------

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function indexToCol(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const CELL_RE = /^([A-Za-z]+)(\d+)$/;

function isCellRef(text) {
  return CELL_RE.test(text);
}

function refToCoord(ref) {
  const m = CELL_RE.exec(ref);
  return { col: colToIndex(m[1]), row: Number(m[2]) - 1 };
}

function coordToRef(col, row) {
  return `${indexToCol(col)}${row + 1}`;
}

/** Expand a range to a 2-D grid of refs plus its shape (for lookup functions). */
function expandRange2D(a, b) {
  const start = refToCoord(a);
  const end = refToCoord(b);
  const r0 = Math.min(start.row, end.row);
  const r1 = Math.max(start.row, end.row);
  const c0 = Math.min(start.col, end.col);
  const c1 = Math.max(start.col, end.col);
  const grid = [];
  for (let row = r0; row <= r1; row += 1) {
    const line = [];
    for (let col = c0; col <= c1; col += 1) {
      line.push(coordToRef(col, row));
    }
    grid.push(line);
  }
  return { grid, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

/** A range value: a flat list (for aggregates) plus a 2-D grid (for lookups). */
function makeRange(grid2D) {
  return {
    __range: grid2D.flat(),
    __grid: grid2D,
    rows: grid2D.length,
    cols: grid2D[0]?.length ?? 0,
  };
}

// ---- errors -----------------------------------------------------------------

export const ERR_DIV0 = "#DIV/0!";
export const ERR_NAME = "#NAME?";
export const ERR_VALUE = "#VALUE!";
export const ERR_CYCLE = "#CYCLE!";
export const ERR_NA = "#N/A";
export const ERR_NUM = "#NUM!";
export const ERR_REF = "#REF!";

function isError(value) {
  return typeof value === "string" && /^#.+[!?]$/.test(value);
}

// ---- tokenizer --------------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      while (j < src.length && src[j] !== '"') {
        str += src[j];
        j += 1;
      }
      tokens.push({ type: "str", value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) {
        j += 1;
      }
      tokens.push({ type: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) {
        j += 1;
      }
      // A sheet-qualified reference: SheetName!A1 (and the A1 of A1:B3).
      if (src[j] === "!" && /[A-Za-z]/.test(src[j + 1] ?? "")) {
        let k = j + 1;
        while (k < src.length && /[A-Za-z0-9_.$]/.test(src[k])) {
          k += 1;
        }
        tokens.push({ type: "id", value: src.slice(i, k) });
        i = k;
        continue;
      }
      tokens.push({ type: "id", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/^%&=<>(),:".includes(ch)) {
      const type =
        ch === "(" ? "lp" : ch === ")" ? "rp" : ch === "," ? "comma" : ch === ":" ? "colon" : "op";
      tokens.push({ type, value: ch });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character '${ch}'`);
  }
  return tokens;
}

// ---- reference rewriting (insert/delete rows & columns, AC-WKS-X1) ----------

/** Re-emit one token to formula text (whitespace-insensitive, semantically equal). */
function emitToken(t) {
  switch (t.type) {
    case "num":
      return String(t.value);
    case "str":
      return `"${t.value}"`;
    case "lp":
      return "(";
    case "rp":
      return ")";
    case "comma":
      return ",";
    case "colon":
      return ":";
    default:
      return String(t.value); // id, op
  }
}

/** Shift one 0-based line index for an insert (`delta>0`)/delete (`delta<0`) at `at`. */
function shiftIndex(v, at, delta) {
  if (delta < 0) {
    if (v >= at && v < at - delta) {
      return null; // inside the deleted band → reference is gone
    }
    return v >= at - delta ? v + delta : v;
  }
  return v >= at ? v + delta : v;
}

/**
 * Rewrite the cell references in a formula body when `delta` rows or columns are
 * inserted (delta>0) or deleted (delta<0) at 0-based index `at` on `axis`
 * ("row"|"col"). Same-sheet, unqualified A1 references shift; function names,
 * named ranges, and sheet-qualified references (`Sheet2!A1`) are left untouched.
 * A reference into a deleted band becomes `#REF!`. Returns the new body text.
 */
export function adjustFormulaBody(body, axis, at, delta, names) {
  const nameSet =
    names instanceof Set ? names : new Set([...(names ?? [])].map((n) => String(n).toUpperCase()));
  let tokens;
  try {
    tokens = tokenize(body);
  } catch {
    return body; // not parseable: leave it exactly as-is
  }
  let out = "";
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === "id") {
      const isFunc = tokens[i + 1]?.type === "lp";
      const qualified = t.value.includes("!");
      const named = nameSet.has(t.value.toUpperCase());
      if (!isFunc && !qualified && !named && CELL_RE.test(t.value)) {
        const c = refToCoord(t.value);
        const idx = axis === "row" ? c.row : c.col;
        const ni = shiftIndex(idx, at, delta);
        out +=
          ni === null ? ERR_REF : axis === "row" ? coordToRef(c.col, ni) : coordToRef(ni, c.row);
        continue;
      }
    }
    out += emitToken(t);
  }
  return out;
}

// ---- parser (precedence climbing) ------------------------------------------

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseComparison() {
    let left = parseConcat();
    while (
      peek() &&
      peek().type === "op" &&
      ["=", "<>", "<", ">", "<=", ">="].includes(peek().value)
    ) {
      const op = next().value;
      left = { type: "binary", op, left, right: parseConcat() };
    }
    return left;
  }
  function parseConcat() {
    let left = parseAddSub();
    while (peek() && peek().type === "op" && peek().value === "&") {
      next();
      left = { type: "binary", op: "&", left, right: parseAddSub() };
    }
    return left;
  }
  function parseAddSub() {
    let left = parseMulDiv();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      left = { type: "binary", op, left, right: parseMulDiv() };
    }
    return left;
  }
  function parseMulDiv() {
    let left = parsePow();
    while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = next().value;
      left = { type: "binary", op, left, right: parsePow() };
    }
    return left;
  }
  function parsePow() {
    const left = parseUnary();
    if (peek() && peek().type === "op" && peek().value === "^") {
      next();
      return { type: "binary", op: "^", left, right: parsePow() };
    }
    return left;
  }
  function parseUnary() {
    if (peek() && peek().type === "op" && (peek().value === "-" || peek().value === "+")) {
      const op = next().value;
      return { type: "unary", op, operand: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const token = next();
    if (!token) {
      throw new Error("unexpected end of formula");
    }
    if (token.type === "num") {
      return { type: "num", value: token.value };
    }
    if (token.type === "str") {
      return { type: "str", value: token.value };
    }
    if (token.type === "lp") {
      const expr = parseComparison();
      next(); // consume ')'
      return expr;
    }
    if (token.type === "id") {
      if (peek() && peek().type === "lp") {
        next(); // '('
        const args = [];
        if (peek() && peek().type !== "rp") {
          args.push(parseComparison());
          while (peek() && peek().type === "comma") {
            next();
            args.push(parseComparison());
          }
        }
        next(); // ')'
        return { type: "call", name: token.value.toUpperCase(), args };
      }
      if (peek() && peek().type === "colon") {
        next();
        const end = next();
        return { type: "range", from: token.value, to: end.value };
      }
      return { type: "ref", name: token.value };
    }
    throw new Error(`unexpected token ${token.type}`);
  }

  return parseComparison();
}

// ---- a sheet ----------------------------------------------------------------

/** A single sheet: a sparse map of cells plus named ranges. */
export class Sheet {
  constructor() {
    this.cells = new Map();
    this.names = new Map();
    /** Owning workbook, set when added to one (enables cross-sheet refs). */
    this.workbook = undefined;
    /** This sheet's name within its workbook. */
    this.name = "";
  }

  /** Set a cell's raw content (a `=formula`, number, or text). */
  setCell(ref, raw) {
    this.cells.set(ref.toUpperCase(), raw);
    return this;
  }

  /** Define a named range or named cell. */
  setName(name, target) {
    this.names.set(name.toUpperCase(), target);
    return this;
  }

  /**
   * Insert/delete `count` rows or columns at 0-based index `at`, moving cells and
   * rewriting every formula's references (AC-WKS-X1). `axis` is "row" | "col";
   * `delta` is positive to insert, negative to delete. Named-range targets shift
   * too. Mutates this sheet and returns it.
   */
  spliceLines(axis, at, delta) {
    const names = new Set([...this.names.keys()]);
    const next = new Map();
    for (const [ref, raw] of this.cells) {
      if (!CELL_RE.test(ref)) {
        next.set(ref, raw);
        continue;
      }
      const c = refToCoord(ref);
      const idx = axis === "row" ? c.row : c.col;
      const ni = shiftIndex(idx, at, delta);
      if (ni === null) {
        continue; // cell sat in a deleted band → it goes away
      }
      const newRef = axis === "row" ? coordToRef(c.col, ni) : coordToRef(ni, c.row);
      const newRaw =
        typeof raw === "string" && raw.startsWith("=")
          ? `=${adjustFormulaBody(raw.slice(1), axis, at, delta, names)}`
          : raw;
      next.set(newRef, newRaw);
    }
    this.cells = next;
    // Keep named-range targets pointing at the right cells.
    for (const [name, target] of this.names) {
      if (typeof target === "string" && target !== "") {
        this.names.set(name, adjustFormulaBody(target, axis, at, delta, names));
      }
    }
    return this;
  }

  insertRow(at, count = 1) {
    return this.spliceLines("row", at, count);
  }
  deleteRow(at, count = 1) {
    return this.spliceLines("row", at, -count);
  }
  insertColumn(at, count = 1) {
    return this.spliceLines("col", at, count);
  }
  deleteColumn(at, count = 1) {
    return this.spliceLines("col", at, -count);
  }

  /** The computed value of a cell. */
  valueOf(ref, visiting = new Set()) {
    const key = ref.toUpperCase();
    if (visiting.has(key)) {
      return ERR_CYCLE;
    }
    const raw = this.cells.get(key);
    if (raw === undefined || raw === "") {
      return null;
    }
    if (typeof raw === "string" && raw.startsWith("=")) {
      visiting.add(key);
      const result = this.evaluate(raw.slice(1), visiting);
      visiting.delete(key);
      return result;
    }
    const num = Number(raw);
    return raw !== "" && !Number.isNaN(num) ? num : raw;
  }

  /** Evaluate a formula body (without the leading `=`). */
  evaluate(body, visiting = new Set()) {
    let ast;
    try {
      ast = parse(tokenize(body));
    } catch {
      return ERR_VALUE;
    }
    return this.#eval(ast, visiting);
  }

  /** Recompute every formula cell, returning ref -> value. */
  recalc() {
    const out = {};
    for (const ref of this.cells.keys()) {
      out[ref] = this.valueOf(ref);
    }
    return out;
  }

  #resolveName(name) {
    const target = this.names.get(name.toUpperCase());
    if (target === undefined) {
      return undefined;
    }
    if (typeof target === "string" && target.includes(":")) {
      const [a, b] = target.split(":");
      const { grid } = expandRange2D(a, b);
      return makeRange(grid.map((line) => line.map((r) => this.valueOf(r))));
    }
    if (typeof target === "string" && isCellRef(target)) {
      return this.valueOf(target);
    }
    return target;
  }

  #eval(node, visiting) {
    switch (node.type) {
      case "num":
        return node.value;
      case "str":
        return node.value;
      case "ref": {
        if (node.name.includes("!")) {
          const [sheetName, cell] = node.name.split("!");
          const sheet = this.workbook?.sheet(sheetName);
          if (!sheet) return ERR_NAME;
          return isCellRef(cell) ? sheet.valueOf(cell) : ERR_NAME;
        }
        if (isCellRef(node.name)) {
          return this.valueOf(node.name, visiting);
        }
        const upper = node.name.toUpperCase();
        if (upper === "TRUE") return true;
        if (upper === "FALSE") return false;
        const named = this.#resolveName(node.name);
        return named === undefined ? ERR_NAME : named;
      }
      case "range": {
        if (node.from.includes("!")) {
          const bang = node.from.indexOf("!");
          const target = this.workbook?.sheet(node.from.slice(0, bang));
          if (!target) return ERR_NAME;
          const fromRef = node.from.slice(bang + 1);
          const toRef = node.to.includes("!") ? node.to.slice(node.to.indexOf("!") + 1) : node.to;
          const { grid: g } = expandRange2D(fromRef, toRef);
          return makeRange(g.map((line) => line.map((r) => target.valueOf(r, new Set()))));
        }
        const { grid } = expandRange2D(node.from, node.to);
        return makeRange(grid.map((line) => line.map((r) => this.valueOf(r, visiting))));
      }
      case "unary": {
        const v = num(this.#eval(node.operand, visiting));
        if (isError(v)) {
          return v;
        }
        return node.op === "-" ? -v : v;
      }
      case "binary":
        return this.#binary(node, visiting);
      case "call":
        return callFunction(
          node.name,
          node.args.map((a) => this.#eval(a, visiting)),
        );
      default:
        return ERR_VALUE;
    }
  }

  #binary(node, visiting) {
    const left = this.#eval(node.left, visiting);
    const right = this.#eval(node.right, visiting);
    if (isError(left)) {
      return left;
    }
    if (isError(right)) {
      return right;
    }
    if (node.op === "&") {
      return `${scalarText(left)}${scalarText(right)}`;
    }
    if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
      return compare(node.op, left, right);
    }
    const a = num(left);
    const b = num(right);
    switch (node.op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? ERR_DIV0 : a / b;
      case "^":
        return a ** b;
      default:
        return ERR_VALUE;
    }
  }
}

// ---- coercion + functions ---------------------------------------------------

function num(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === null) {
    return 0;
  }
  if (isError(value)) {
    return value;
  }
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function scalarText(value) {
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}

function compare(op, left, right) {
  const a = typeof left === "number" ? left : scalarText(left);
  const b = typeof right === "number" ? right : scalarText(right);
  switch (op) {
    case "=":
      return a === b;
    case "<>":
      return a !== b;
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    default:
      return ERR_VALUE;
  }
}

function flatten(args) {
  const out = [];
  for (const arg of args) {
    if (arg && typeof arg === "object" && Array.isArray(arg.__range)) {
      out.push(...arg.__range);
    } else {
      out.push(arg);
    }
  }
  return out;
}

function numbers(args) {
  return flatten(args)
    .filter((v) => v !== null && v !== "" && !isError(v))
    .map(num)
    .filter((v) => typeof v === "number" && !Number.isNaN(v));
}

/** Functions that must run even when an argument is an error (they inspect it). */
const ERROR_TOLERANT = new Set([
  "IF",
  "IFERROR",
  "IFNA",
  "ISERROR",
  "ISERR",
  "ISNA",
  "ISBLANK",
  "ISNUMBER",
  "ISTEXT",
  "ISNONTEXT",
  "ISLOGICAL",
  "ISEVEN",
  "ISODD",
  "NA",
  "N",
  "T",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
]);

/**
 * Dispatch a spreadsheet function. The library is a superset of the classic
 * ~76 Works functions, maths, statistical, financial, date/time, text,
 * logical, lookup, and information, named compatibly with Excel/ODF where
 * sensible. Each entry receives already-evaluated arguments (scalars or range
 * objects) and returns a {@link CellValue}.
 */
function callFunction(name, args) {
  const fn = FUNCTIONS[name];
  if (!fn) {
    return ERR_NAME;
  }
  if (!ERROR_TOLERANT.has(name)) {
    const firstError = flatten(args).find(isError);
    if (firstError) {
      return firstError;
    }
  }
  try {
    const result = fn(args);
    return result === undefined ? null : result;
  } catch {
    return ERR_VALUE;
  }
}

function toBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (value.toUpperCase() === "TRUE") return true;
    if (value.toUpperCase() === "FALSE") return false;
  }
  return Boolean(value);
}

/** Match a value against an Excel-style criterion ("North", ">5", "<>0"). */
function matches(value, criterion) {
  const crit = scalarText(criterion);
  const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(crit);
  const op = m[1] ?? "=";
  const target = m[2];
  const targetNum = Number(target);
  if (op === "=" || op === "") {
    return Number.isNaN(targetNum) || target === ""
      ? scalarText(value).toUpperCase() === target.toUpperCase()
      : num(value) === targetNum;
  }
  if (op === "<>") {
    return scalarText(value).toUpperCase() !== target.toUpperCase();
  }
  const v = num(value);
  switch (op) {
    case ">":
      return v > targetNum;
    case "<":
      return v < targetNum;
    case ">=":
      return v >= targetNum;
    case "<=":
      return v <= targetNum;
    default:
      return false;
  }
}

// ---- argument helpers -------------------------------------------------------

/** The flat values of an argument (range → its cells; scalar → itself). */
function flatOf(arg) {
  return arg && typeof arg === "object" && Array.isArray(arg.__range) ? arg.__range : [arg];
}

/** The 2-D grid of an argument (range → its grid; scalar → a 1×1 grid). */
function gridOf(arg) {
  if (arg && typeof arg === "object" && Array.isArray(arg.__grid)) {
    return arg.__grid;
  }
  if (arg && typeof arg === "object" && Array.isArray(arg.__range)) {
    return [arg.__range];
  }
  return [[arg]];
}

function sortedNums(args) {
  return numbers(args)
    .slice()
    .sort((a, b) => a - b);
}

// ---- date serials -----------------------------------------------------------

const DATE_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

function dateToSerial(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - DATE_EPOCH) / DAY_MS);
}
function serialParts(serial) {
  const dt = new Date(DATE_EPOCH + Math.floor(serial) * DAY_MS);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    wd: dt.getUTCDay(),
  };
}
function todaySerial() {
  const now = new Date();
  return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---- text format (a pragmatic TEXT() / number-format engine) ---------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n, width) {
  return String(Math.abs(n)).padStart(width, "0");
}

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Render a date/time serial with a pattern, walking it token by token so the
 * month/minute ambiguity ("m" is minutes only right after an hour token) and
 * literal characters are handled correctly.
 */
function formatDateTime(serial, pattern) {
  const parts = serialParts(serial);
  const frac = serial - Math.floor(serial);
  const totalSec = Math.round(frac * 86400);
  const hh = Math.floor(totalSec / 3600);
  const mn = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  let out = "";
  let i = 0;
  let lastUnit = "";
  const nextIsSeconds = (j) => {
    let k = j;
    while (k < pattern.length && !/[a-z]/i.test(pattern[k])) k += 1;
    return /^s/i.test(pattern.slice(k));
  };
  while (i < pattern.length) {
    const lower = pattern.slice(i).toLowerCase();
    if (lower.startsWith("yyyy")) {
      out += String(parts.y);
      i += 4;
      lastUnit = "year";
    } else if (lower.startsWith("yy")) {
      out += pad(parts.y % 100, 2);
      i += 2;
      lastUnit = "year";
    } else if (lower.startsWith("mmmm")) {
      out += MONTHS[parts.m - 1] ?? "";
      i += 4;
      lastUnit = "month";
    } else if (lower.startsWith("mmm")) {
      out += (MONTHS[parts.m - 1] ?? "").slice(0, 3);
      i += 3;
      lastUnit = "month";
    } else if (lower.startsWith("dddd")) {
      out += WEEKDAYS[parts.wd] ?? "";
      i += 4;
      lastUnit = "wday";
    } else if (lower.startsWith("ddd")) {
      out += (WEEKDAYS[parts.wd] ?? "").slice(0, 3);
      i += 3;
      lastUnit = "wday";
    } else if (lower.startsWith("dd")) {
      out += pad(parts.d, 2);
      i += 2;
      lastUnit = "day";
    } else if (lower.startsWith("d")) {
      out += String(parts.d);
      i += 1;
      lastUnit = "day";
    } else if (lower.startsWith("hh")) {
      out += pad(hh, 2);
      i += 2;
      lastUnit = "hour";
    } else if (lower.startsWith("h")) {
      out += String(hh);
      i += 1;
      lastUnit = "hour";
    } else if (lower.startsWith("ss")) {
      out += pad(ss, 2);
      i += 2;
      lastUnit = "second";
    } else if (lower.startsWith("s")) {
      out += String(ss);
      i += 1;
      lastUnit = "second";
    } else if (lower.startsWith("mm")) {
      const minute = lastUnit === "hour" || nextIsSeconds(i + 2);
      out += pad(minute ? mn : parts.m, 2);
      i += 2;
      lastUnit = minute ? "minute" : "month";
    } else if (lower.startsWith("m")) {
      const minute = lastUnit === "hour" || nextIsSeconds(i + 1);
      out += String(minute ? mn : parts.m);
      i += 1;
      lastUnit = minute ? "minute" : "month";
    } else {
      out += pattern[i];
      i += 1;
    }
  }
  return out;
}

/** Apply a TEXT()/number-format pattern. Supports the common Works/Excel codes. */
function applyTextFormat(value, pattern) {
  const p = String(pattern);
  // Date/time patterns (any y/d/h/s token, or a 3+ run of month letters).
  if (/y|d|h|s|m{3,}/i.test(p) && /[ymdhs]/i.test(p)) {
    return formatDateTime(num(value), p);
  }
  const n = num(value);
  if (p.includes("%")) {
    const decimals = (p.split(".")[1] ?? "").length;
    return `${(n * 100).toFixed(decimals)}%`;
  }
  if (/^[$£€]/.test(p) || p.includes("#,##0") || /0\.0/.test(p) || /^0+$/.test(p)) {
    const sym = /^[$£€]/.test(p) ? p[0] : "";
    const decimals = (p.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
    const fixed = Math.abs(n).toFixed(decimals);
    const [intPart, dec] = fixed.split(".");
    const grouped = p.includes(",")
      ? groupThousands(intPart)
      : p.replace(/[^0]/g, "").length > intPart.length
        ? intPart.padStart(p.replace(/[.].*$/, "").replace(/[^0]/g, "").length, "0")
        : intPart;
    const body = dec ? `${grouped}.${dec}` : grouped;
    return `${n < 0 ? "-" : ""}${sym}${body}`;
  }
  return scalarText(value);
}

// ---- the function library ---------------------------------------------------

const FUNCTIONS = {
  // -- maths --
  SUM: (a) => numbers(a).reduce((x, y) => x + y, 0),
  PRODUCT: (a) => numbers(a).reduce((x, y) => x * y, 1),
  SUMSQ: (a) => numbers(a).reduce((x, y) => x + y * y, 0),
  SUMPRODUCT: (a) => {
    const grids = a.map(gridOf);
    let total = 0;
    const rows = grids[0]?.length ?? 0;
    const cols = grids[0]?.[0]?.length ?? 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        let prod = 1;
        for (const g of grids) prod *= num(g[r]?.[c] ?? 0);
        total += prod;
      }
    }
    return total;
  },
  ABS: (a) => Math.abs(num(a[0])),
  SIGN: (a) => Math.sign(num(a[0])),
  SQRT: (a) => Math.sqrt(num(a[0])),
  POWER: (a) => num(a[0]) ** num(a[1]),
  EXP: (a) => Math.exp(num(a[0])),
  LN: (a) => Math.log(num(a[0])),
  LOG: (a) =>
    a[1] === undefined ? Math.log10(num(a[0])) : Math.log(num(a[0])) / Math.log(num(a[1])),
  LOG10: (a) => Math.log10(num(a[0])),
  MOD: (a) => {
    const d = num(a[1]);
    return d === 0 ? ERR_DIV0 : ((num(a[0]) % d) + d) % d;
  },
  QUOTIENT: (a) => Math.trunc(num(a[0]) / num(a[1])),
  INT: (a) => Math.floor(num(a[0])),
  TRUNC: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    return Math.trunc(num(a[0]) * f) / f;
  },
  ROUND: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    return Math.round(num(a[0]) * f) / f;
  },
  ROUNDUP: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    const v = num(a[0]) * f;
    return (v < 0 ? Math.floor(v) : Math.ceil(v)) / f;
  },
  ROUNDDOWN: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    return Math.trunc(num(a[0]) * f) / f;
  },
  CEILING: (a) => {
    const s = num(a[1] ?? 1);
    return s === 0 ? 0 : Math.ceil(num(a[0]) / s) * s;
  },
  FLOOR: (a) => {
    const s = num(a[1] ?? 1);
    return s === 0 ? 0 : Math.floor(num(a[0]) / s) * s;
  },
  MROUND: (a) => {
    const s = num(a[1]);
    return s === 0 ? 0 : Math.round(num(a[0]) / s) * s;
  },
  EVEN: (a) => {
    const v = num(a[0]);
    return (v < 0 ? -1 : 1) * Math.ceil(Math.abs(v) / 2) * 2;
  },
  ODD: (a) => {
    const v = num(a[0]);
    const r = Math.ceil(Math.abs(v) / 2) * 2 - 1;
    return (v < 0 ? -1 : 1) * Math.max(1, r);
  },
  PI: () => Math.PI,
  FACT: (a) => {
    let r = 1;
    for (let i = 2; i <= num(a[0]); i += 1) r *= i;
    return r;
  },
  COMBIN: (a) =>
    FUNCTIONS.FACT([num(a[0])]) /
    (FUNCTIONS.FACT([num(a[1])]) * FUNCTIONS.FACT([num(a[0]) - num(a[1])])),
  GCD: (a) =>
    numbers(a).reduce((x, y) => {
      let p = Math.abs(x),
        q = Math.abs(y);
      while (q) {
        [p, q] = [q, p % q];
      }
      return p;
    }, 0),
  LCM: (a) =>
    numbers(a).reduce((x, y) => (x && y ? Math.abs(x * y) / FUNCTIONS.GCD([x, y]) : 0), 1),
  DEGREES: (a) => (num(a[0]) * 180) / Math.PI,
  RADIANS: (a) => (num(a[0]) * Math.PI) / 180,
  SIN: (a) => Math.sin(num(a[0])),
  COS: (a) => Math.cos(num(a[0])),
  TAN: (a) => Math.tan(num(a[0])),
  ASIN: (a) => Math.asin(num(a[0])),
  ACOS: (a) => Math.acos(num(a[0])),
  ATAN: (a) => Math.atan(num(a[0])),
  ATAN2: (a) => Math.atan2(num(a[1]), num(a[0])),
  SINH: (a) => Math.sinh(num(a[0])),
  COSH: (a) => Math.cosh(num(a[0])),
  TANH: (a) => Math.tanh(num(a[0])),
  RAND: () => Math.random(),
  RANDBETWEEN: (a) => {
    const lo = Math.ceil(num(a[0]));
    const hi = Math.floor(num(a[1]));
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  },

  // -- statistical --
  AVERAGE: (a) => {
    const ns = numbers(a);
    return ns.length === 0 ? ERR_DIV0 : ns.reduce((x, y) => x + y, 0) / ns.length;
  },
  AVG: (a) => FUNCTIONS.AVERAGE(a),
  AVERAGEA: (a) => {
    const vs = flatten(a).filter((v) => v !== null && v !== "");
    return vs.length === 0 ? ERR_DIV0 : vs.map(num).reduce((x, y) => x + y, 0) / vs.length;
  },
  AVERAGEIF: (a) => {
    const t = condSum(a);
    return t.count === 0 ? ERR_DIV0 : t.total / t.count;
  },
  COUNT: (a) => numbers(a).length,
  COUNTA: (a) => flatten(a).filter((v) => v !== null && v !== "").length,
  COUNTBLANK: (a) => flatten(a).filter((v) => v === null || v === "").length,
  COUNTIF: (a) => flatOf(a[0]).filter((v) => matches(v, a[1])).length,
  COUNTIFS: (a) => countIfs(a),
  MIN: (a) => {
    const ns = numbers(a);
    return ns.length ? Math.min(...ns) : 0;
  },
  MINA: (a) => {
    const ns = flatten(a)
      .filter((v) => v !== null && v !== "")
      .map(num);
    return ns.length ? Math.min(...ns) : 0;
  },
  MAX: (a) => {
    const ns = numbers(a);
    return ns.length ? Math.max(...ns) : 0;
  },
  MAXA: (a) => {
    const ns = flatten(a)
      .filter((v) => v !== null && v !== "")
      .map(num);
    return ns.length ? Math.max(...ns) : 0;
  },
  MEDIAN: (a) => {
    const ns = sortedNums(a);
    if (!ns.length) return ERR_DIV0;
    const mid = Math.floor(ns.length / 2);
    return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
  },
  MODE: (a) => {
    const ns = numbers(a);
    const counts = new Map();
    let best = null,
      bestN = 0;
    for (const n of ns) {
      const c = (counts.get(n) ?? 0) + 1;
      counts.set(n, c);
      if (c > bestN) {
        bestN = c;
        best = n;
      }
    }
    return bestN > 1 ? best : ERR_VALUE;
  },
  STDEV: (a) => Math.sqrt(variance(numbers(a), true)),
  STDEVP: (a) => Math.sqrt(variance(numbers(a), false)),
  VAR: (a) => variance(numbers(a), true),
  VARP: (a) => variance(numbers(a), false),
  GEOMEAN: (a) => {
    const ns = numbers(a);
    return ns.length ? ns.reduce((x, y) => x * y, 1) ** (1 / ns.length) : ERR_DIV0;
  },
  LARGE: (a) => {
    const ns = sortedNums([a[0]]).reverse();
    return ns[num(a[a.length - 1]) - 1] ?? ERR_VALUE;
  },
  SMALL: (a) => {
    const ns = sortedNums([a[0]]);
    return ns[num(a[a.length - 1]) - 1] ?? ERR_VALUE;
  },
  RANK: (a) => {
    const v = num(a[0]);
    const ns = numbers([a[1]]);
    const asc = toBool(a[2]);
    const sorted = ns.slice().sort((x, y) => (asc ? x - y : y - x));
    const idx = sorted.indexOf(v);
    return idx < 0 ? ERR_VALUE : idx + 1;
  },
  PERCENTILE: (a) => {
    const ns = sortedNums([a[0]]);
    const p = num(a[1]);
    if (!ns.length) return ERR_VALUE;
    const rank = p * (ns.length - 1);
    const lo = Math.floor(rank);
    const frac = rank - lo;
    return ns[lo] + frac * ((ns[lo + 1] ?? ns[lo]) - ns[lo]);
  },
  SUMIF: (a) => sumIf(a),
  SUMIFS: (a) => sumIfs(a),

  // -- financial --
  PMT: (a) => pmt(num(a[0]), num(a[1]), num(a[2]), num(a[3] ?? 0), num(a[4] ?? 0)),
  FV: (a) => fv(num(a[0]), num(a[1]), num(a[2]), num(a[3] ?? 0), num(a[4] ?? 0)),
  PV: (a) => pv(num(a[0]), num(a[1]), num(a[2]), num(a[3] ?? 0), num(a[4] ?? 0)),
  NPER: (a) => nper(num(a[0]), num(a[1]), num(a[2]), num(a[3] ?? 0), num(a[4] ?? 0)),
  NPV: (a) => {
    const rate = num(a[0]);
    return numbers(a.slice(1)).reduce((acc, v, i) => acc + v / (1 + rate) ** (i + 1), 0);
  },
  IPMT: (a) => ipmt(num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4] ?? 0), num(a[5] ?? 0)),
  PPMT: (a) =>
    pmt(num(a[0]), num(a[2]), num(a[3]), num(a[4] ?? 0), num(a[5] ?? 0)) -
    ipmt(num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4] ?? 0), num(a[5] ?? 0)),
  SLN: (a) => (num(a[0]) - num(a[1])) / num(a[2]),

  // -- date/time --
  TODAY: () => todaySerial(),
  NOW: () => {
    const now = new Date();
    return (
      todaySerial() + (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400
    );
  },
  DATE: (a) => dateToSerial(num(a[0]), num(a[1]), num(a[2])),
  TIME: (a) => (num(a[0]) * 3600 + num(a[1]) * 60 + num(a[2])) / 86400,
  YEAR: (a) => serialParts(num(a[0])).y,
  MONTH: (a) => serialParts(num(a[0])).m,
  DAY: (a) => serialParts(num(a[0])).d,
  HOUR: (a) => Math.floor(((num(a[0]) % 1) * 86400) / 3600) % 24,
  MINUTE: (a) => Math.floor(((num(a[0]) % 1) * 86400) / 60) % 60,
  SECOND: (a) => Math.round((num(a[0]) % 1) * 86400) % 60,
  WEEKDAY: (a) => {
    const wd = serialParts(num(a[0])).wd;
    const type = num(a[1] ?? 1);
    return type === 2 ? (wd === 0 ? 7 : wd) : type === 3 ? (wd + 6) % 7 : wd + 1;
  },
  WEEKNUM: (a) => {
    const s = num(a[0]);
    const p = serialParts(s);
    const jan1 = dateToSerial(p.y, 1, 1);
    return Math.floor((s - jan1 + serialParts(jan1).wd) / 7) + 1;
  },
  DAYS: (a) => Math.floor(num(a[0])) - Math.floor(num(a[1])),
  EDATE: (a) => {
    const p = serialParts(num(a[0]));
    const target = p.m - 1 + num(a[1]);
    const y = p.y + Math.floor(target / 12);
    const m = ((target % 12) + 12) % 12;
    return dateToSerial(y, m + 1, p.d);
  },
  EOMONTH: (a) => {
    const p = serialParts(num(a[0]));
    const target = p.m + num(a[1]);
    const y = p.y + Math.floor(target / 12) - (target % 12 === 0 ? 1 : 0);
    const m = ((target % 12) + 12) % 12 || 12;
    return dateToSerial(y, m + 1, 1) - 1;
  },
  DATEVALUE: (a) => {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(scalarText(a[0]));
    return m ? dateToSerial(Number(m[1]), Number(m[2]), Number(m[3])) : ERR_VALUE;
  },

  // -- text --
  CONCAT: (a) => flatten(a).map(scalarText).join(""),
  CONCATENATE: (a) => flatten(a).map(scalarText).join(""),
  LEFT: (a) => scalarText(a[0]).slice(0, num(a[1] ?? 1)),
  RIGHT: (a) => {
    const n = num(a[1] ?? 1);
    const s = scalarText(a[0]);
    return n === 0 ? "" : s.slice(-n);
  },
  MID: (a) => scalarText(a[0]).slice(num(a[1]) - 1, num(a[1]) - 1 + num(a[2])),
  LEN: (a) => scalarText(a[0]).length,
  LOWER: (a) => scalarText(a[0]).toLowerCase(),
  UPPER: (a) => scalarText(a[0]).toUpperCase(),
  PROPER: (a) =>
    scalarText(a[0]).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  TRIM: (a) => scalarText(a[0]).replace(/\s+/g, " ").trim(),
  CLEAN: (a) =>
    Array.from(scalarText(a[0]))
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join(""),
  REPLACE: (a) => {
    const s = scalarText(a[0]);
    const start = num(a[1]) - 1;
    return s.slice(0, start) + scalarText(a[3]) + s.slice(start + num(a[2]));
  },
  SUBSTITUTE: (a) => {
    const s = scalarText(a[0]);
    const find = scalarText(a[1]);
    const rep = scalarText(a[2]);
    if (a[3] === undefined) return s.split(find).join(rep);
    let i = 0;
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every regex metacharacter in `find` is escaped first
    return s.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (m) =>
      ++i === num(a[3]) ? rep : m,
    );
  },
  FIND: (a) => {
    const idx = scalarText(a[1]).indexOf(scalarText(a[0]), num(a[2] ?? 1) - 1);
    return idx < 0 ? ERR_VALUE : idx + 1;
  },
  SEARCH: (a) => {
    const idx = scalarText(a[1])
      .toLowerCase()
      .indexOf(scalarText(a[0]).toLowerCase(), num(a[2] ?? 1) - 1);
    return idx < 0 ? ERR_VALUE : idx + 1;
  },
  REPT: (a) => scalarText(a[0]).repeat(Math.max(0, num(a[1]))),
  EXACT: (a) => scalarText(a[0]) === scalarText(a[1]),
  CHAR: (a) => String.fromCharCode(num(a[0])),
  CODE: (a) => scalarText(a[0]).charCodeAt(0) || ERR_VALUE,
  VALUE: (a) => {
    const n = Number(scalarText(a[0]).replace(/[$£€,%\s]/g, ""));
    return Number.isNaN(n) ? ERR_VALUE : n;
  },
  NUMBERVALUE: (a) => {
    const n = Number(scalarText(a[0]).replace(/[,\s]/g, ""));
    return Number.isNaN(n) ? ERR_VALUE : n;
  },
  TEXT: (a) => applyTextFormat(a[0], scalarText(a[1])),
  T: (a) => (typeof a[0] === "string" ? a[0] : ""),
  N: (a) => (typeof a[0] === "number" ? a[0] : typeof a[0] === "boolean" ? (a[0] ? 1 : 0) : 0),

  // -- logical --
  IF: (a) => (toBool(a[0]) ? (a[1] ?? null) : (a[2] ?? false)),
  IFS: (a) => {
    for (let i = 0; i < a.length; i += 2) {
      if (toBool(a[i])) return a[i + 1] ?? null;
    }
    return ERR_NAME;
  },
  IFERROR: (a) => (isError(a[0]) ? (a[1] ?? null) : a[0]),
  IFNA: (a) => (a[0] === ERR_NA || a[0] === "#N/A" ? (a[1] ?? null) : a[0]),
  AND: (a) =>
    flatten(a)
      .filter((v) => v !== null && v !== "")
      .every(toBool),
  OR: (a) =>
    flatten(a)
      .filter((v) => v !== null && v !== "")
      .some(toBool),
  NOT: (a) => !toBool(a[0]),
  XOR: (a) => flatten(a).filter(toBool).length % 2 === 1,
  TRUE: () => true,
  FALSE: () => false,
  SWITCH: (a) => {
    const v = a[0];
    for (let i = 1; i + 1 < a.length; i += 2) {
      if (scalarText(a[i]) === scalarText(v)) return a[i + 1];
    }
    return a.length % 2 === 0 ? (a[a.length - 1] ?? null) : ERR_NA;
  },

  // -- lookup --
  VLOOKUP: (a) => vlookup(a, "v"),
  HLOOKUP: (a) => vlookup(a, "h"),
  INDEX: (a) => {
    const g = gridOf(a[0]);
    const r = num(a[1] ?? 1);
    const c = num(a[2] ?? (g.length === 1 ? r : 1));
    if (g.length === 1) return g[0]?.[(a[2] === undefined ? r : c) - 1] ?? ERR_VALUE;
    if (g[0]?.length === 1 && a[2] === undefined) return g[r - 1]?.[0] ?? ERR_VALUE;
    return g[r - 1]?.[c - 1] ?? ERR_VALUE;
  },
  MATCH: (a) => matchFn(a),
  CHOOSE: (a) => a[num(a[0])] ?? ERR_VALUE,
  LOOKUP: (a) => {
    const v = a[0];
    const vec = flatOf(a[1]);
    const res = a[2] === undefined ? vec : flatOf(a[2]);
    let best = -1;
    for (let i = 0; i < vec.length; i += 1) {
      if (num(vec[i]) <= num(v)) best = i;
    }
    return best < 0 ? ERR_NA : (res[best] ?? ERR_NA);
  },

  // -- information --
  ISNUMBER: (a) => typeof a[0] === "number",
  ISTEXT: (a) => typeof a[0] === "string" && !isError(a[0]),
  ISNONTEXT: (a) => !(typeof a[0] === "string" && !isError(a[0])),
  ISBLANK: (a) => a[0] === null || a[0] === undefined || a[0] === "",
  ISERROR: (a) => isError(a[0]),
  ISERR: (a) => isError(a[0]) && a[0] !== ERR_NA,
  ISNA: (a) => a[0] === ERR_NA,
  ISLOGICAL: (a) => typeof a[0] === "boolean",
  ISEVEN: (a) => num(a[0]) % 2 === 0,
  ISODD: (a) => Math.abs(num(a[0]) % 2) === 1,
  NA: () => ERR_NA,
};

// ---- function helpers -------------------------------------------------------

function variance(ns, sample) {
  if (ns.length < (sample ? 2 : 1)) {
    return ERR_DIV0;
  }
  const mean = ns.reduce((x, y) => x + y, 0) / ns.length;
  const ss = ns.reduce((x, y) => x + (y - mean) ** 2, 0);
  return ss / (ns.length - (sample ? 1 : 0));
}

function condSum(args) {
  const range = flatOf(args[0]);
  const avgRange = flatOf(args[2] ?? args[0]);
  let total = 0;
  let count = 0;
  for (let i = 0; i < range.length; i += 1) {
    if (matches(range[i], args[1])) {
      total += num(avgRange[i] ?? 0);
      count += 1;
    }
  }
  return { total, count };
}

function sumIf(args) {
  const range = flatOf(args[0]);
  const sumRange = flatOf(args[2] ?? args[0]);
  let total = 0;
  for (let i = 0; i < range.length; i += 1) {
    if (matches(range[i], args[1])) {
      total += num(sumRange[i] ?? 0);
    }
  }
  return total;
}

function sumIfs(args) {
  const sumRange = flatOf(args[0]);
  let total = 0;
  for (let i = 0; i < sumRange.length; i += 1) {
    let ok = true;
    for (let p = 1; p + 1 < args.length; p += 2) {
      if (!matches(flatOf(args[p])[i], args[p + 1])) {
        ok = false;
        break;
      }
    }
    if (ok) total += num(sumRange[i] ?? 0);
  }
  return total;
}

function countIfs(args) {
  const first = flatOf(args[0]);
  let count = 0;
  for (let i = 0; i < first.length; i += 1) {
    let ok = true;
    for (let p = 0; p + 1 < args.length; p += 2) {
      if (!matches(flatOf(args[p])[i], args[p + 1])) {
        ok = false;
        break;
      }
    }
    if (ok) count += 1;
  }
  return count;
}

function vlookup(args, mode) {
  const needle = args[0];
  const grid = gridOf(args[1]);
  const index = num(args[2]);
  const approx = args[3] === undefined ? true : toBool(args[3]);
  const keys = mode === "v" ? grid.map((r) => r[0]) : (grid[0] ?? []);
  let found = -1;
  for (let i = 0; i < keys.length; i += 1) {
    if (approx) {
      if (num(keys[i]) <= num(needle)) found = i;
    } else if (scalarText(keys[i]) === scalarText(needle)) {
      found = i;
      break;
    }
  }
  if (found < 0) {
    return ERR_NA;
  }
  return mode === "v" ? (grid[found]?.[index - 1] ?? ERR_NA) : (grid[index - 1]?.[found] ?? ERR_NA);
}

function matchFn(args) {
  const needle = args[0];
  const vec = flatOf(args[1]);
  const type = args[2] === undefined ? 1 : num(args[2]);
  if (type === 0) {
    const idx = vec.findIndex((v) => scalarText(v) === scalarText(needle));
    return idx < 0 ? ERR_NA : idx + 1;
  }
  let best = -1;
  for (let i = 0; i < vec.length; i += 1) {
    if (type === 1 && num(vec[i]) <= num(needle)) best = i;
    else if (type === -1 && num(vec[i]) >= num(needle)) best = i;
  }
  return best < 0 ? ERR_NA : best + 1;
}

// ---- financial helpers ------------------------------------------------------

function pmt(rate, nperiods, presentValue, futureValue, type) {
  if (rate === 0) {
    return -(presentValue + futureValue) / nperiods;
  }
  const f = (1 + rate) ** nperiods;
  return (-(presentValue * f + futureValue) * rate) / ((1 + rate * type) * (f - 1));
}
function fv(rate, nperiods, payment, presentValue, type) {
  if (rate === 0) {
    return -(presentValue + payment * nperiods);
  }
  const f = (1 + rate) ** nperiods;
  return -(presentValue * f + payment * (1 + rate * type) * ((f - 1) / rate));
}
function pv(rate, nperiods, payment, futureValue, type) {
  if (rate === 0) {
    return -(futureValue + payment * nperiods);
  }
  const f = (1 + rate) ** nperiods;
  return -(futureValue + payment * (1 + rate * type) * ((f - 1) / rate)) / f;
}
function nper(rate, payment, presentValue, futureValue, type) {
  if (rate === 0) {
    return -(presentValue + futureValue) / payment;
  }
  const adj = payment * (1 + rate * type);
  return Math.log((adj - futureValue * rate) / (adj + presentValue * rate)) / Math.log(1 + rate);
}
function ipmt(rate, per, nperiods, presentValue, futureValue, type) {
  const payment = pmt(rate, nperiods, presentValue, futureValue, type);
  let balance = presentValue;
  let interest = 0;
  for (let i = 1; i <= per; i += 1) {
    interest = balance * rate;
    balance += payment - interest;
  }
  return -interest;
}

// ---- pivot summaries (AC-SHEETS-1) -----------------------------------------

/** Group `rows` by `groupBy` and aggregate `valueField`. */
export function pivot(rows, groupBy, valueField, agg = "sum") {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[groupBy] ?? "");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(Number(row[valueField] ?? 0));
  }
  const out = [];
  for (const [key, values] of groups) {
    out.push({ group: key, value: aggregate(values, agg) });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group));
}

function aggregate(values, agg) {
  if (agg === "count") {
    return values.length;
  }
  if (agg === "avg") {
    return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  }
  if (agg === "max") {
    return Math.max(...values);
  }
  if (agg === "min") {
    return Math.min(...values);
  }
  return values.reduce((a, b) => a + b, 0);
}

// ---- chart suggestion + explanation ----------------------------------------

/** Suggest a chart type from a 2-column [label, number] dataset. */
export function suggestChart(rows) {
  if (rows.length === 0) {
    return "none";
  }
  if (rows.length <= 6) {
    return "pie";
  }
  const labelsAreTime = rows.every((r) => /\b(19|20)\d\d\b|jan|feb|q[1-4]/i.test(String(r[0])));
  return labelsAreTime ? "line" : "bar";
}

/** A plain-language explanation of a formula (AC-AI-5 partner). */
export function explainFormula(formula) {
  const body = formula.startsWith("=") ? formula.slice(1) : formula;
  const fn = /^([A-Z]+)\(/i.exec(body.trim());
  const descriptions = {
    SUM: "adds up the values in the range",
    AVERAGE: "averages the values in the range",
    SUMIF: "adds the values that match the condition",
    IF: "chooses a value based on a condition",
    COUNT: "counts the numeric values",
    MAX: "takes the largest value",
    MIN: "takes the smallest value",
  };
  const key = fn ? fn[1].toUpperCase() : "";
  return key in descriptions
    ? `This formula ${descriptions[key]}.`
    : `This formula computes ${body}.`;
}

/** Build a local Ember request for natural-language formula generation. */
export function buildFormulaRequest(naturalLanguage, selection = "", effort = "balanced") {
  return {
    task: "formula",
    document: selection,
    request: naturalLanguage,
    effort,
  };
}

// ---- ODF mapping (AC-SHEETS-2) ---------------------------------------------

/**
 * Map a grid (2-D array of computed cell values) to the shared ODF spreadsheet
 * model that the `odf-io` core round-trips to `.xlsx` (fidelity per AC-FMT-2).
 */
export function toSpreadsheetModel(name, grid) {
  const rows = grid.map((row) => ({
    cells: row.map((value) => {
      if (value === null || value === "") {
        return { kind: "empty" };
      }
      return typeof value === "number"
        ? { kind: "number", value }
        : { kind: "text", value: String(value) };
    }),
  }));
  return { sheets: [{ name, rows }] };
}

// ---- data-table <-> Records bridge (AC-SHEETS-3) ---------------------------

/**
 * Promote a data table (header row + data rows) to a Records table without data
 * loss. Returns the table name, field definitions, and rows keyed by field.
 */
export function dataTableToRecords(name, header, dataRows) {
  const fields = header.map((label, index) => ({
    name: label,
    datatype: inferType(dataRows.map((r) => r[index])),
  }));
  const rows = dataRows.map((row) => {
    const values = {};
    header.forEach((label, index) => {
      values[label] = row[index] ?? null;
    });
    return values;
  });
  return { name, fields, rows };
}

/** Inverse: reconstruct a data table (header + rows) from a Records table. */
export function recordsToDataTable(records) {
  const header = records.fields.map((f) => f.name);
  const dataRows = records.rows.map((row) => header.map((label) => row[label] ?? null));
  return { header, dataRows };
}

function inferType(values) {
  const present = values.filter((v) => v !== null && v !== "");
  if (present.length > 0 && present.every((v) => !Number.isNaN(Number(v)))) {
    return "number";
  }
  return "text";
}

// ---- number formats (AC-WKS-X "number formats incl. currency/percent/date") -

/**
 * Named cell number formats offered in the toolbar. `id` is stored per cell;
 * {@link formatNumber} renders a computed value for display. Plain language so
 * a novice picks "Money" not "Currency, 2dp, thousands".
 */
export const NUMBER_FORMATS = [
  { id: "general", label: "General" },
  { id: "number", label: "Number (1,234.56)" },
  { id: "integer", label: "Whole number (1,235)" },
  { id: "gbp", label: "Money, £" },
  { id: "usd", label: "Money, $" },
  { id: "eur", label: "Money, €" },
  { id: "percent", label: "Percent (12.3%)" },
  { id: "scientific", label: "Scientific (1.2E+3)" },
  { id: "date", label: "Date (2026-06-04)" },
  { id: "date-long", label: "Date, long (4 June 2026)" },
  { id: "time", label: "Time (14:30)" },
  { id: "zip", label: "Leading zeros (00042)" },
  { id: "text", label: "Text (as typed)" },
];

const CURRENCY_SYMBOL = { gbp: "£", usd: "$", eur: "€" };

/** Render a computed value for display under a named number format. */
export function formatNumber(value, format = "general", { zipWidth = 5 } = {}) {
  if (value === null || value === "") {
    return "";
  }
  if (isError(value)) {
    return String(value);
  }
  if (format === "text" || format === "general") {
    return scalarText(value);
  }
  if (typeof value !== "number" && Number.isNaN(Number(value))) {
    return scalarText(value);
  }
  const n = Number(value);
  switch (format) {
    case "number":
      return groupThousands(n.toFixed(2).split(".")[0]) + "." + n.toFixed(2).split(".")[1];
    case "integer":
      return groupThousands(Math.round(n).toString());
    case "gbp":
    case "usd":
    case "eur": {
      const sym = CURRENCY_SYMBOL[format];
      const fixed = Math.abs(n).toFixed(2);
      const [i, d] = fixed.split(".");
      return `${n < 0 ? "-" : ""}${sym}${groupThousands(i)}.${d}`;
    }
    case "percent":
      return `${(n * 100).toFixed(1)}%`;
    case "scientific":
      return n.toExponential(1).toUpperCase();
    case "date":
      return applyTextFormat(n, "yyyy-mm-dd");
    case "date-long":
      return applyTextFormat(n, "d mmmm yyyy");
    case "time":
      return applyTextFormat(n, "hh:mm");
    case "zip":
      return pad(Math.round(n), zipWidth);
    default:
      return scalarText(value);
  }
}

// ---- fill series (AC-WKS-X "fill series") ----------------------------------

/**
 * Extend a seed of one or more cells by `count` more, detecting the pattern:
 * a linear numeric step, a date step, a "text + number" increment
 * ("Item 1" → "Item 2"…), or a plain copy when no progression is found.
 */
export function fillSeries(seed, count) {
  const out = [];
  const cleaned = seed.filter((v) => v !== null && v !== "");
  // Numeric arithmetic progression.
  const nums = cleaned.map((v) => Number(v));
  if (cleaned.length >= 1 && nums.every((n) => !Number.isNaN(n))) {
    const step = nums.length >= 2 ? nums[nums.length - 1] - nums[nums.length - 2] : 1;
    let last = nums[nums.length - 1];
    for (let i = 0; i < count; i += 1) {
      last += step;
      out.push(last);
    }
    return out;
  }
  // "Prefix <number>" increment, e.g. "Week 1" → "Week 2".
  const m = /^(.*?)(\d+)\s*$/.exec(String(cleaned[cleaned.length - 1] ?? ""));
  if (m) {
    const prefix = m[1];
    let n = Number(m[2]);
    const width = m[2].length;
    for (let i = 0; i < count; i += 1) {
      n += 1;
      out.push(`${prefix}${String(n).padStart(m[2].startsWith("0") ? width : 0, "0")}`);
    }
    return out;
  }
  // No progression, copy the last value.
  const fill = cleaned[cleaned.length - 1] ?? "";
  for (let i = 0; i < count; i += 1) {
    out.push(fill);
  }
  return out;
}

/**
 * The cells a drag-fill from `fromRef` to `toRef` should write, excluding the
 * seed cell itself. Picks the dominant axis (down or right) and only fills
 * forward — dragging up/left yields no cells. Pure: from/to → ordered refs.
 */
export function fillRangeRefs(fromRef, toRef) {
  const from = refToCoord(fromRef);
  const to = refToCoord(toRef);
  const vertical = Math.abs(to.row - from.row) >= Math.abs(to.col - from.col);
  const refs = [];
  if (vertical && to.row > from.row) {
    for (let r = from.row + 1; r <= to.row; r += 1) refs.push(coordToRef(from.col, r));
  } else if (!vertical && to.col > from.col) {
    for (let c = from.col + 1; c <= to.col; c += 1) refs.push(coordToRef(c, from.row));
  }
  return refs;
}

// ---- AutoSum (AC-WKS-X "AutoSum") ------------------------------------------

/**
 * Build the AutoSum formula for a target cell: looks up the contiguous run of
 * numbers immediately above (preferred) or to the left, and returns
 * `=SUM(<range>)`. `getValue(ref)` reads a computed cell value.
 */
export function autoSumFormula(getValue, ref) {
  const { col, row } = refToCoord(ref);
  const runLength = (dCol, dRow) => {
    let n = 0;
    let c = col + dCol;
    let r = row + dRow;
    while (c >= 0 && r >= 0) {
      const v = getValue(coordToRef(c, r));
      if (typeof v !== "number") break;
      n += 1;
      c += dCol;
      r += dRow;
    }
    return n;
  };
  const up = runLength(0, -1);
  if (up > 0) {
    return `=SUM(${coordToRef(col, row - up)}:${coordToRef(col, row - 1)})`;
  }
  const left = runLength(-1, 0);
  if (left > 0) {
    return `=SUM(${coordToRef(col - left, row)}:${coordToRef(col - 1, row)})`;
  }
  return "=SUM()";
}

// ---- multi-sheet workbook (deliberately surpassing Works' single sheet) ----

/**
 * An ordered collection of named {@link Sheet}s. Each sheet resolves
 * cross-sheet references of the form `OtherSheet!A1` (and ranges
 * `OtherSheet!A1:B3`) against its sibling sheets. A workbook always has at
 * least one sheet; the editor hides tabs until a second is added.
 */
export class Workbook {
  constructor() {
    this.order = [];
    this.sheets = new Map();
    // Names are space-free so they can be referenced unquoted (Sheet1!A1).
    this.addSheet("Sheet1");
  }

  addSheet(name) {
    const sheet = new Sheet();
    sheet.workbook = this;
    sheet.name = name;
    const key = name.toUpperCase();
    this.sheets.set(key, sheet);
    this.order.push(key);
    return sheet;
  }

  sheet(name) {
    return this.sheets.get(name.toUpperCase());
  }

  names() {
    return this.order.map((k) => this.sheets.get(k).name);
  }

  renameSheet(oldName, newName) {
    const key = oldName.toUpperCase();
    const sheet = this.sheets.get(key);
    if (!sheet) return;
    this.sheets.delete(key);
    const newKey = newName.toUpperCase();
    sheet.name = newName;
    this.sheets.set(newKey, sheet);
    this.order = this.order.map((k) => (k === key ? newKey : k));
  }

  removeSheet(name) {
    const key = name.toUpperCase();
    if (this.order.length <= 1) return;
    this.sheets.delete(key);
    this.order = this.order.filter((k) => k !== key);
  }
}

// ---- Formula Helper catalogue (Easy Calc heir, AC-WKS-X) -------------------

/**
 * The function catalogue that powers the Formula Helper stepper: grouped by
 * category, each entry has a signature, plain-language summary, and argument
 * prompts so a novice can fill a function in step by step.
 */
export const FUNCTION_CATALOG = [
  {
    category: "Everyday",
    functions: [
      {
        name: "SUM",
        signature: "SUM(numbers)",
        summary: "Add up a range of numbers.",
        args: ["The numbers or range to add"],
      },
      {
        name: "AVERAGE",
        signature: "AVERAGE(numbers)",
        summary: "Find the average (mean).",
        args: ["The numbers or range to average"],
      },
      {
        name: "COUNT",
        signature: "COUNT(values)",
        summary: "Count how many numbers are in a range.",
        args: ["The range to count"],
      },
      {
        name: "MIN",
        signature: "MIN(numbers)",
        summary: "Smallest value.",
        args: ["The numbers or range"],
      },
      {
        name: "MAX",
        signature: "MAX(numbers)",
        summary: "Largest value.",
        args: ["The numbers or range"],
      },
      {
        name: "ROUND",
        signature: "ROUND(number, digits)",
        summary: "Round to a number of decimal places.",
        args: ["The number to round", "How many decimal places"],
      },
    ],
  },
  {
    category: "Conditional",
    functions: [
      {
        name: "IF",
        signature: "IF(test, then, else)",
        summary: "Choose one of two values based on a test.",
        args: ["The test, e.g. A1>10", "Value if true", "Value if false"],
      },
      {
        name: "SUMIF",
        signature: "SUMIF(range, condition, [sum range])",
        summary: "Add the values that meet a condition.",
        args: ["Range to test", 'Condition, e.g. ">100"', "Range to add (optional)"],
      },
      {
        name: "COUNTIF",
        signature: "COUNTIF(range, condition)",
        summary: "Count the values that meet a condition.",
        args: ["Range to test", 'Condition, e.g. "North"'],
      },
      {
        name: "IFERROR",
        signature: "IFERROR(value, fallback)",
        summary: "Show a fallback if a formula errors.",
        args: ["The formula", "What to show on error"],
      },
    ],
  },
  {
    category: "Lookup",
    functions: [
      {
        name: "VLOOKUP",
        signature: "VLOOKUP(value, table, column, [exact])",
        summary: "Find a row by its first column and read across.",
        args: [
          "Value to find",
          "The table range",
          "Which column to return",
          "FALSE for exact match",
        ],
      },
      {
        name: "INDEX",
        signature: "INDEX(range, row, [column])",
        summary: "Pick a cell from a range by position.",
        args: ["The range", "Row number", "Column number (optional)"],
      },
      {
        name: "MATCH",
        signature: "MATCH(value, range, [type])",
        summary: "Find the position of a value in a range.",
        args: ["Value to find", "The range", "0 for exact"],
      },
    ],
  },
  {
    category: "Text",
    functions: [
      {
        name: "CONCAT",
        signature: "CONCAT(text...)",
        summary: "Join pieces of text together.",
        args: ["The texts to join"],
      },
      {
        name: "LEFT",
        signature: "LEFT(text, n)",
        summary: "First n characters of text.",
        args: ["The text", "How many characters"],
      },
      {
        name: "UPPER",
        signature: "UPPER(text)",
        summary: "Make text UPPERCASE.",
        args: ["The text"],
      },
      {
        name: "TRIM",
        signature: "TRIM(text)",
        summary: "Remove extra spaces.",
        args: ["The text"],
      },
    ],
  },
  {
    category: "Dates",
    functions: [
      { name: "TODAY", signature: "TODAY()", summary: "Today's date.", args: [] },
      {
        name: "DATE",
        signature: "DATE(year, month, day)",
        summary: "Build a date.",
        args: ["Year", "Month", "Day"],
      },
      { name: "YEAR", signature: "YEAR(date)", summary: "The year of a date.", args: ["The date"] },
    ],
  },
  {
    category: "Financial",
    functions: [
      {
        name: "PMT",
        signature: "PMT(rate, periods, amount)",
        summary: "Loan/regular payment.",
        args: ["Interest rate per period", "Number of periods", "Loan amount"],
      },
      {
        name: "FV",
        signature: "FV(rate, periods, payment)",
        summary: "Future value of savings.",
        args: ["Rate per period", "Number of periods", "Payment each period"],
      },
      {
        name: "NPV",
        signature: "NPV(rate, values...)",
        summary: "Net present value of cash flows.",
        args: ["Discount rate", "The cash flows"],
      },
    ],
  },
];

/** Flat list of every supported function name (for validation/autocomplete). */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
