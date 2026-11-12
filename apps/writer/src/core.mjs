// Hearth Suite Writer's pure logic: the block document model, mail-merge, the
// "ask your document" context, plain-language Seal status, and ODF mapping.
// No DOM, no I/O, unit-tested with `node --test`. The editor (editor.ts) and
// FFI wiring build on top.

/** Live paragraph styles offered in the toolbar. */
export const STYLES = [
  { id: "title", label: "Title" },
  { id: "h1", label: "Heading 1" },
  { id: "h2", label: "Heading 2" },
  { id: "body", label: "Body" },
  { id: "quote", label: "Quote" },
  { id: "caption", label: "Caption" },
];

/** A fresh, empty document with a single body paragraph. */
export function emptyDocument(title = "Untitled") {
  return { title, blocks: [{ kind: "paragraph", style: "body", spans: [{ text: "" }] }] };
}

/** Flatten a document to plain text (paragraphs/headings/table cells). */
export function toPlainText(doc) {
  const lines = [];
  for (const block of doc.blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) {
        lines.push(row.map((cell) => spansText(cell)).join("\t"));
      }
    } else if (block.kind === "image") {
      if (block.alt) {
        lines.push(`[image: ${block.alt}]`);
      }
    } else if (block.kind === "chart") {
      lines.push(`[chart: ${block.spec?.title ?? "Chart"}]`);
    } else {
      lines.push(spansText(block.spans));
    }
  }
  return lines.join("\n");
}

function spansText(spans) {
  return spans.map((s) => s.text).join("");
}

// ---- Compose from Data (mail-merge, AC-WRITER-2) ---------------------------

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Substitute `{{field}}` placeholders in a string from a record. */
export function fillPlaceholders(text, record) {
  return text.replace(PLACEHOLDER, (_match, field) => {
    const value = record[field];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Produce one document per record by filling the template's placeholders. */
export function composeFromData(template, records) {
  return records.map((record) => ({
    title: fillPlaceholders(template.title ?? "Untitled", record),
    blocks: template.blocks.map((block) => fillBlock(block, record)),
  }));
}

function fillBlock(block, record) {
  if (block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => row.map((cell) => fillSpans(cell, record))),
    };
  }
  if (block.kind === "image") {
    return { ...block, alt: block.alt ? fillPlaceholders(block.alt, record) : block.alt };
  }
  if (block.kind === "chart") {
    return block;
  }
  return { ...block, spans: fillSpans(block.spans, record) };
}

function fillSpans(spans, record) {
  return spans.map((span) => ({ ...span, text: fillPlaceholders(span.text, record) }));
}

/** Distinct `{{field}}` names referenced anywhere in the document, in order. */
export function mergeFields(doc) {
  const seen = new Set();
  const fields = [];
  const scan = (text) => {
    let m;
    PLACEHOLDER.lastIndex = 0;
    while ((m = PLACEHOLDER.exec(text)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        fields.push(m[1]);
      }
    }
  };
  for (const block of doc.blocks ?? []) {
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row) scan(spansText(cell));
      }
    } else if (block.kind === "image") {
      if (block.alt) scan(block.alt);
    } else if (block.kind === "chart") {
      // Charts carry no merge fields.
    } else {
      scan(spansText(block.spans));
    }
  }
  return fields;
}

// ---- Envelopes & labels (mail merge, AC-WKS-W19 / W20) ---------------------

/**
 * Map a merge record to mailing-address lines, tolerant of how different
 * sources name their fields (Contacts, Records, Sheets). Blank lines are
 * dropped, so a record with no company simply omits that line.
 */
export function formatAddress(record) {
  const get = (...keys) => {
    for (const key of keys) {
      for (const actual of Object.keys(record ?? {})) {
        if (actual.toLowerCase().replace(/[\s_-]/g, "") === key) {
          const v = record[actual];
          if (v != null && String(v).trim() !== "") return String(v).trim();
        }
      }
    }
    return "";
  };
  const name = get("name", "fullname", "recipient", "contact");
  const company = get("company", "organisation", "organization", "org");
  const street1 = get("street", "address", "address1", "addressline1", "addr");
  const street2 = get("address2", "addressline2", "suite", "unit", "apartment", "apt");
  const city = get("city", "town", "locality");
  const region = get("region", "state", "province", "county");
  const postcode = get("postcode", "postalcode", "zip", "zipcode", "postal");
  const country = get("country");
  const cityLine = [city, region].filter(Boolean).join(", ");
  const lines = [
    name,
    company,
    street1,
    street2,
    [cityLine, postcode].filter(Boolean).join("  ").trim(),
    country,
  ];
  return lines.map((l) => l.trim()).filter((l) => l !== "");
}

/** Standard envelope sizes (millimetres), portrait feed dimensions w×h. */
export const ENVELOPE_SIZES = [
  { id: "no10", label: "No. 10 (US business)", widthMm: 241.3, heightMm: 104.8 },
  { id: "dl", label: "DL (110 × 220 mm)", widthMm: 220, heightMm: 110 },
  { id: "c5", label: "C5 (162 × 229 mm)", widthMm: 229, heightMm: 162 },
  { id: "c6", label: "C6 (114 × 162 mm)", widthMm: 162, heightMm: 114 },
  { id: "monarch", label: "Monarch (3⅞ × 7½ in)", widthMm: 190.5, heightMm: 98.4 },
];

/** Look up an envelope size by id (falls back to the first). */
export function envelopeById(id) {
  return ENVELOPE_SIZES.find((e) => e.id === id) ?? ENVELOPE_SIZES[0];
}

/**
 * Avery-style label sheet catalogue. Geometry is in millimetres: the page, the
 * grid (across × down), each label's size, the margins to the first label, and
 * the centre-to-centre pitch between labels.
 */
export const LABEL_SHEETS = [
  {
    id: "avery5160",
    label: "Avery 5160, address, 30 per sheet (US Letter)",
    page: "Letter",
    pageWmm: 215.9,
    pageHmm: 279.4,
    across: 3,
    down: 10,
    labelWmm: 66.7,
    labelHmm: 25.4,
    marginLeftMm: 4.8,
    marginTopMm: 12.7,
    pitchXmm: 70.6,
    pitchYmm: 25.4,
  },
  {
    id: "avery5163",
    label: "Avery 5163, shipping, 10 per sheet (US Letter)",
    page: "Letter",
    pageWmm: 215.9,
    pageHmm: 279.4,
    across: 2,
    down: 5,
    labelWmm: 101.6,
    labelHmm: 50.8,
    marginLeftMm: 4.3,
    marginTopMm: 12.7,
    pitchXmm: 104.9,
    pitchYmm: 50.8,
  },
  {
    id: "averyL7160",
    label: "Avery L7160, address, 21 per sheet (A4)",
    page: "A4",
    pageWmm: 210,
    pageHmm: 297,
    across: 3,
    down: 7,
    labelWmm: 63.5,
    labelHmm: 38.1,
    marginLeftMm: 7.2,
    marginTopMm: 15.1,
    pitchXmm: 66,
    pitchYmm: 38.1,
  },
  {
    id: "averyL7163",
    label: "Avery L7163, shipping, 14 per sheet (A4)",
    page: "A4",
    pageWmm: 210,
    pageHmm: 297,
    across: 2,
    down: 7,
    labelWmm: 99.1,
    labelHmm: 38.1,
    marginLeftMm: 4.65,
    marginTopMm: 15.1,
    pitchXmm: 101.6,
    pitchYmm: 38.1,
  },
];

/** Look up a label sheet by id (falls back to the first). */
export function labelSheetById(id) {
  return LABEL_SHEETS.find((s) => s.id === id) ?? LABEL_SHEETS[0];
}

/**
 * Lay merge records out across one or more label sheets. `startAt` skips that
 * many cells on the first page (for a partly-used sheet). Returns an array of
 * pages, each a fixed-length array of cells; an unused cell is `null`.
 */
export function paginateLabels(records, sheet, { startAt = 0 } = {}) {
  const perPage = sheet.across * sheet.down;
  const cells = [];
  for (let i = 0; i < startAt % perPage; i += 1) cells.push(null);
  for (const record of records) cells.push(record);
  const pages = [];
  for (let i = 0; i < cells.length; i += perPage) {
    const page = cells.slice(i, i + perPage);
    while (page.length < perPage) page.push(null);
    pages.push(page);
  }
  return pages.length > 0 ? pages : [Array.from({ length: perPage }, () => null)];
}

// ---- Ask your document (AC-WRITER-3) ---------------------------------------

/**
 * Build the local Ember request for "answer about this document". The whole
 * document text is the context and nothing leaves the device.
 */
export function buildAskRequest(doc, question, effort = "balanced") {
  return {
    task: "query",
    document: toPlainText(doc),
    request: question,
    effort,
  };
}

// ---- Seal status (AC-UX-SEAL-2) --------------------------------------------

/**
 * Plain-language Seal status, never cryptographic jargon.
 * e.g. ["Maria"] -> "Only you and Maria can open this".
 */
export function sealStatusText(recipientNames, selfLabel = "you") {
  if (recipientNames.length === 0) {
    return `Only ${selfLabel} can open this`;
  }
  return `Only ${joinNames([selfLabel, ...recipientNames])} can open this`;
}

function joinNames(names) {
  if (names.length === 1) {
    return names[0];
  }
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1];
  return `${head} and ${tail}`;
}

// ---- Export mapping (AC-WRITER-4) ------------------------------------------

/**
 * Map the Writer document to the shared ODF text model (the shape the `odf-io`
 * core consumes via FFI to produce ODF/.docx, and that a print path renders to
 * PDF). Headings and paragraphs map losslessly; table rows are flattened to
 * tab-joined paragraphs until the ODF core models tables.
 */
export function toOdfModel(doc) {
  const blocks = [];
  for (const block of doc.blocks) {
    if (block.kind === "heading") {
      blocks.push({ kind: "heading", level: block.level, spans: normalizeSpans(block.spans) });
    } else if (block.kind === "table") {
      for (const row of block.rows) {
        blocks.push({ kind: "paragraph", spans: [{ text: row.map(spansText).join("\t") }] });
      }
    } else if (block.kind === "image") {
      blocks.push({
        kind: "paragraph",
        spans: [{ text: block.alt ? `[image: ${block.alt}]` : "" }],
      });
    } else if (block.kind === "chart") {
      blocks.push({
        kind: "paragraph",
        spans: [{ text: `[chart: ${block.spec?.title ?? "Chart"}]` }],
      });
    } else {
      blocks.push({ kind: "paragraph", spans: normalizeSpans(block.spans) });
    }
  }
  return { blocks };
}

/** The export formats Writer offers. */
export const EXPORT_FORMATS = ["odf", "docx", "pdf"];

// ---- Document statistics (AC-WKS-W16) --------------------------------------

/** Word, character, and paragraph counts for the live statistics panel. */
export function documentStats(doc) {
  const text = toPlainText(doc);
  const words = (text.match(/\S+/g) ?? []).length;
  const characters = text.replace(/\n/g, "").length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;
  const paragraphs = doc.blocks.filter(
    (b) => (b.kind === "paragraph" || b.kind === "heading") && spansText(b.spans).trim() !== "",
  ).length;
  return { words, characters, charactersNoSpaces, paragraphs };
}

// ---- AutoCorrect (AC-WKS-W18) ----------------------------------------------

/** Default, user-editable autocorrect rules (lowercase key → replacement). */
export const DEFAULT_AUTOCORRECT = {
  teh: "the",
  adn: "and",
  thier: "their",
  recieve: "receive",
  seperate: "separate",
  definately: "definitely",
  occured: "occurred",
  wont: "won't",
  dont: "don't",
  "(c)": "©",
  "(r)": "®",
  "(tm)": "™",
  "-->": "→",
  "...": "…",
};

/**
 * Correct a single just-typed token. Case-insensitive match; a capitalised input
 * keeps its leading capital (so "Teh" → "The"). Returns the word unchanged when
 * no rule applies.
 */
export function autoCorrectWord(word, rules = DEFAULT_AUTOCORRECT) {
  const replacement = rules[String(word).toLowerCase()];
  if (replacement === undefined) {
    return word;
  }
  if (/^[A-Z]/.test(word) && /^[a-z]/.test(replacement)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Apply autocorrect across whole words in a block of text. */
export function applyAutoCorrect(text, rules = DEFAULT_AUTOCORRECT) {
  return String(text).replace(/[A-Za-z']+|\([a-z]+\)|-->|\.\.\./g, (token) =>
    autoCorrectWord(token, rules),
  );
}

// ---- Find & Replace (AC-WKS-W17) -------------------------------------------

/** Expand search escapes: \t → tab, \n or ¶ → newline, \\ → backslash. */
export function expandSpecials(pattern) {
  const s = String(pattern);
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (s.charCodeAt(i) === 0x00b6) {
      out += "\n";
    } else if (c === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "t") out += "\t";
      else if (next === "n") out += "\n";
      else if (next === "\\") out += "\\";
      else out += next;
      i += 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** Indices of every (non-overlapping) match of `query` in `text`. */
export function findMatches(text, query, { caseSensitive = false } = {}) {
  const needle = expandSpecials(query);
  if (needle === "") {
    return [];
  }
  const hay = caseSensitive ? String(text) : String(text).toLowerCase();
  const find = caseSensitive ? needle : needle.toLowerCase();
  const out = [];
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(find, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + find.length;
  }
  return out;
}

/**
 * Replace matches of `query` with `replacement` in a plain string. By default
 * every match is replaced; pass `opts.limit` (a positive integer) to replace at
 * most that many (e.g. `limit: 1` for "Replace" one-at-a-time, W17).
 */
export function replaceAll(text, query, replacement, opts = {}) {
  const needle = expandSpecials(query);
  if (needle === "") {
    return { text: String(text), count: 0 };
  }
  const repl = expandSpecials(replacement);
  let matches = findMatches(text, query, opts);
  if (typeof opts.limit === "number" && opts.limit >= 0) {
    matches = matches.slice(0, opts.limit);
  }
  if (matches.length === 0) {
    return { text: String(text), count: 0 };
  }
  let result = "";
  let cursor = 0;
  for (const idx of matches) {
    result += String(text).slice(cursor, idx) + repl;
    cursor = idx + needle.length;
  }
  result += String(text).slice(cursor);
  return { text: result, count: matches.length };
}

/** Count every (non-overlapping) match of `query` across a document's text. */
export function countInDoc(doc, query, opts = {}) {
  let count = 0;
  for (const block of doc.blocks) {
    if (block.kind !== "paragraph" && block.kind !== "heading") {
      continue;
    }
    count += findMatches(spansText(block.spans), query, opts).length;
  }
  return count;
}

/**
 * Replace text across a document's paragraph/heading blocks, returning a new
 * document and the number of replacements. Replaced runs collapse to a single
 * span (inline formatting within a replaced run is not preserved).
 */
export function replaceInDoc(doc, query, replacement, opts = {}) {
  let count = 0;
  const hasLimit = typeof opts.limit === "number" && opts.limit >= 0;
  const blocks = doc.blocks.map((block) => {
    if (block.kind !== "paragraph" && block.kind !== "heading") {
      return block;
    }
    // A global limit is shared across blocks: once spent, later blocks are
    // untouched, so "Replace" (limit 1) replaces the first match in the doc.
    const remaining = hasLimit ? opts.limit - count : undefined;
    if (hasLimit && remaining <= 0) {
      return block;
    }
    const result = replaceAll(spansText(block.spans), query, replacement, {
      ...opts,
      ...(hasLimit ? { limit: remaining } : {}),
    });
    if (result.count === 0) {
      return block;
    }
    count += result.count;
    return { ...block, spans: [{ text: result.text }] };
  });
  return { doc: { ...doc, blocks }, count };
}

// ---- Pagination: our own print-faithful renderer (AC-WKS-W9, W10, W21) ------

/** Page sizes in millimetres. */
export const PAGE_SIZES = {
  A4: { w: 210, h: 297 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
};

/**
 * Derive a deterministic page geometry (characters per line, lines per page)
 * from a page setup. Used by {@link paginate} and mirrored by the print CSS so
 * the on-screen preview and the printed/PDF output agree.
 */
export function pageGeometry({
  size = "A4",
  orientation = "portrait",
  marginMm = 25,
  fontPt = 11,
} = {}) {
  const dim = PAGE_SIZES[size] ?? PAGE_SIZES.A4;
  let w = dim.w;
  let h = dim.h;
  if (orientation === "landscape") {
    [w, h] = [h, w];
  }
  const contentW = w - 2 * marginMm;
  const contentH = h - 2 * marginMm;
  const ptMm = 0.3528;
  const lineMm = fontPt * ptMm * 1.4;
  const charMm = fontPt * ptMm * 0.5;
  return {
    size,
    orientation,
    marginMm,
    widthMm: w,
    heightMm: h,
    charsPerLine: Math.max(20, Math.floor(contentW / charMm)),
    linesPerPage: Math.max(10, Math.floor(contentH / lineMm)),
  };
}

/** Estimate how many lines a block occupies at a given line width. */
function blockLines(block, charsPerLine) {
  if (block.kind === "image") {
    return 8;
  }
  if (block.kind === "table") {
    return (block.rows?.length ?? 1) + 1;
  }
  const len = spansText(block.spans ?? []).length;
  const wrapped = Math.max(1, Math.ceil(len / Math.max(charsPerLine, 1)));
  return wrapped + (block.kind === "heading" ? 1 : 0) + 1; // +1 for block spacing
}

function resolveTokens(text, page, pages, dateLabel) {
  return String(text ?? "")
    .replace(/\{page\}/g, String(page))
    .replace(/\{pages\}/g, String(pages))
    .replace(/\{date\}/g, dateLabel ?? "");
}

/**
 * Flow a document into fixed-size pages. Each page carries its blocks, the
 * footnotes whose markers fall on it, the resolved header/footer (with
 * {page}/{pages}/{date} tokens), and its number/total. Blocks may declare
 * `footnoteRefs: number[]`; `opts.footnotes` maps a ref id to its text.
 */
export function paginate(doc, geometry, opts = {}) {
  const cpl = geometry.charsPerLine;
  const cap = geometry.linesPerPage;
  const header = opts.header ?? "";
  const footer = opts.footer ?? "";
  const reserved = (header ? 2 : 0) + (footer ? 2 : 0);
  const footnotes = opts.footnotes ?? {};

  const blank = () => ({ blocks: [], footnotes: [], usedLines: reserved });
  const raw = [];
  let cur = blank();

  for (const block of doc.blocks) {
    const refs = block.footnoteRefs ?? [];
    const fnLines = refs.reduce(
      (sum, id) => sum + Math.max(1, Math.ceil(String(footnotes[id] ?? "").length / cpl)),
      0,
    );
    const need = blockLines(block, cpl) + fnLines;
    if (cur.blocks.length > 0 && cur.usedLines + need > cap) {
      raw.push(cur);
      cur = blank();
    }
    cur.blocks.push(block);
    for (const id of refs) {
      cur.footnotes.push({ id, text: String(footnotes[id] ?? "") });
    }
    cur.usedLines += need;
  }
  if (cur.blocks.length > 0 || raw.length === 0) {
    raw.push(cur);
  }

  const total = raw.length;
  return raw.map((p, i) => ({
    blocks: p.blocks,
    footnotes: p.footnotes,
    pageNumber: i + 1,
    totalPages: total,
    header: resolveTokens(header, i + 1, total, opts.dateLabel),
    footer: resolveTokens(footer, i + 1, total, opts.dateLabel),
  }));
}

/**
 * The full set of inline marks Writer round-trips through ODF. Boolean marks
 * are normalised to `false` when absent; the valued marks (colour/font/size/
 * link) are only present when set, so the export model stays compact.
 */
const BOOL_MARKS = ["bold", "italic", "underline", "strike", "sup", "sub"];
const VALUE_MARKS = ["color", "font", "size", "href"];

function normalizeSpan(s) {
  const out = { text: s.text ?? "" };
  for (const m of BOOL_MARKS) {
    out[m] = s[m] ?? false;
  }
  for (const m of VALUE_MARKS) {
    if (s[m] != null && s[m] !== "") {
      out[m] = s[m];
    }
  }
  return out;
}

function normalizeSpans(spans) {
  return spans.map(normalizeSpan);
}

// ---- Rich inline serialisation (deep ODF round-trip) -----------------------
//
// Writer's contenteditable surface is HTML, and the canonical document model is
// a list of {text, …marks} spans. These two pure functions are the lossless
// bridge between them: `spansToHtml` renders a span list to a small, canonical
// HTML subset, and `spansFromHtml` parses HTML (our own canonical output *and*
// the messier markup `execCommand` emits, `<strong>`, `<em>`, `<font>`, inline
// `style=…`) back into spans. Round-tripping a paragraph therefore preserves
// bold/italic/underline/strike/superscript/subscript/colour/font/size/links,
// which `toOdfModel` then carries into the exported ODF text:span tree.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** Serialise one span to canonical HTML, nesting marks link→style→b→i→u→s→sup/sub. */
function spanToHtml(s) {
  let html = escapeHtml(s.text ?? "");
  if (html === "") {
    return "";
  }
  if (s.sub) html = `<sub>${html}</sub>`;
  if (s.sup) html = `<sup>${html}</sup>`;
  if (s.strike) html = `<s>${html}</s>`;
  if (s.underline) html = `<u>${html}</u>`;
  if (s.italic) html = `<i>${html}</i>`;
  if (s.bold) html = `<b>${html}</b>`;
  const styles = [];
  if (s.color) styles.push(`color:${s.color}`);
  if (s.font) styles.push(`font-family:${s.font}`);
  if (s.size) styles.push(`font-size:${s.size}`);
  if (styles.length) html = `<span style="${escapeAttr(styles.join(";"))}">${html}</span>`;
  if (s.href) html = `<a href="${escapeAttr(s.href)}">${html}</a>`;
  return html;
}

export function spansToHtml(spans) {
  return (spans ?? []).map(spanToHtml).join("");
}

function attr(attrs, name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `name` is a literal attribute name from this module
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

function styleProp(style, name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `name` is a literal CSS property name from this module
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m ? m[1].trim() : undefined;
}

const HTML_PT = { 1: "8pt", 2: "10pt", 3: "12pt", 4: "14pt", 5: "18pt", 6: "24pt", 7: "36pt" };
const VOID_TAGS = new Set(["br", "img", "hr", "wbr"]);

/** The mark contributed by an opening tag, or `null` for a structural/unknown tag. */
function markForTag(tag, attrs) {
  switch (tag) {
    case "b":
    case "strong":
      return { bold: true };
    case "i":
    case "em":
      return { italic: true };
    case "u":
    case "ins":
      return { underline: true };
    case "s":
    case "strike":
    case "del":
      return { strike: true };
    case "sup":
      return { sup: true };
    case "sub":
      return { sub: true };
    case "a": {
      const href = attr(attrs, "href");
      return href ? { href } : {};
    }
    case "font": {
      const f = {};
      const color = attr(attrs, "color");
      const face = attr(attrs, "face");
      const size = attr(attrs, "size");
      if (color) f.color = color;
      if (face) f.font = face;
      if (size && HTML_PT[size]) f.size = HTML_PT[size];
      return f;
    }
    case "span": {
      const style = attr(attrs, "style") ?? "";
      const f = {};
      const color = styleProp(style, "color");
      const font = styleProp(style, "font-family");
      const size = styleProp(style, "font-size");
      const weight = styleProp(style, "font-weight");
      const fStyle = styleProp(style, "font-style");
      const decoration = styleProp(style, "text-decoration");
      const valign = styleProp(style, "vertical-align");
      if (color) f.color = color;
      if (font) f.font = font;
      if (size) f.size = size;
      if (weight && (weight === "bold" || Number(weight) >= 600)) f.bold = true;
      if (fStyle === "italic" || fStyle === "oblique") f.italic = true;
      if (decoration && decoration.includes("underline")) f.underline = true;
      if (decoration && decoration.includes("line-through")) f.strike = true;
      if (valign === "super") f.sup = true;
      if (valign === "sub") f.sub = true;
      return f;
    }
    default:
      return {};
  }
}

/** Coalesce consecutive spans that carry identical marks. */
function mergeAdjacentSpans(spans) {
  const out = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, span)) {
      prev.text += span.text;
    } else {
      out.push(span);
    }
  }
  return out;
}

function sameMarks(a, b) {
  for (const m of BOOL_MARKS) {
    if (!!a[m] !== !!b[m]) return false;
  }
  for (const m of VALUE_MARKS) {
    if ((a[m] ?? null) !== (b[m] ?? null)) return false;
  }
  return true;
}

/**
 * Parse an inline-HTML fragment into a normalised span list. Tolerant of the
 * markup browsers actually produce: nested tags, tag synonyms, `style=` marks,
 * `<font>`, void tags, and HTML entities. Unknown tags are transparent, their
 * text is kept under whatever marks are currently active.
 */
export function spansFromHtml(html) {
  const spans = [];
  const stack = [];
  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?\s*>|([^<]+)/g;
  let m;
  const current = () => Object.assign({}, ...stack);
  while ((m = re.exec(html)) !== null) {
    if (m[4] != null) {
      const text = decodeEntities(m[4]);
      if (text !== "") {
        spans.push(Object.assign({ text }, current()));
      }
      continue;
    }
    const tag = m[2].toLowerCase();
    const closing = m[1] === "/";
    if (VOID_TAGS.has(tag)) {
      continue;
    }
    if (closing) {
      stack.pop();
    } else {
      stack.push(markForTag(tag, m[3] ?? ""));
    }
  }
  return mergeAdjacentSpans(spans).map(normalizeSpan);
}
